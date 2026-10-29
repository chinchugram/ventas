import { ErrorDeNegocio } from "@/lib/acciones";
import { d, type Dinero } from "@/lib/money";
import { resolverPrecio } from "@/lib/precios";
import {
  consolidarLineas,
  decidirPrecio,
  motivoNoAbierto,
  numeroPresupuesto,
  problemaDeCantidad,
  totalizarPresupuesto,
  VALIDEZ_MAXIMA,
  type EstadoGuardado,
  type LineaPrevia,
} from "@/lib/presupuestos";
import { cargarListaDeCliente } from "./listas-precios";
import type { Tx } from "./tx";
import { registrarVentaEnTx } from "./ventas";

// Un presupuesto no toca stock ni costos: solo congela precios. La unica
// operacion con efectos es `convertirPresupuestoEnTx`, que delega la venta en
// `registrarVentaEnTx` con los precios congelados.

/**
 * Clave del advisory lock que numera los presupuestos de un anio. Distinta de la
 * de las ventas (que usa el anio a secas): un presupuesto nuevo no espera a una
 * venta ni al reves. Se suma el anio a este offset.
 */
export const CLAVE_LOCK_PRESUPUESTOS = 7_200_000_000;

export type DatosPresupuesto = {
  clienteId: string;
  validezDias: number;
  observaciones: string | null;
  /** Solo se informa que articulo y cuanto: el precio lo decide el servidor. */
  items: { articuloId: string; cantidad: Dinero }[];
};

type LineaNueva = {
  articuloId: string;
  descripcion: string;
  cantidad: Dinero;
  precioUnitario: Dinero;
  ivaPct: Dinero;
};

function verificarValidez(validezDias: number) {
  if (!Number.isInteger(validezDias) || validezDias < 1 || validezDias > VALIDEZ_MAXIMA) {
    throw new ErrorDeNegocio(`La validez tiene que ser de 1 a ${VALIDEZ_MAXIMA} días.`);
  }
}

async function verificarCliente(tx: Tx, clienteId: string) {
  const cliente = await tx.cliente.findFirst({ where: { id: clienteId, activo: true }, select: { id: true } });
  if (!cliente) throw new ErrorDeNegocio("El cliente no existe o está dado de baja.");
}

/**
 * Arma las lineas a guardar. Los precios SIEMPRE los pone el servidor:
 *  - lineas nuevas (o todas, si cambio el cliente): `resolverPrecio` con la
 *    lista del cliente, e IVA/descripcion actuales del articulo;
 *  - al editar, las que ya estaban conservan precio, IVA y descripcion
 *    congelados (ver `decidirPrecio`).
 */
async function armarLineas(
  tx: Tx,
  clienteId: string,
  items: DatosPresupuesto["items"],
  previas: ReadonlyMap<string, LineaPrevia> = new Map(),
  clienteCambio = true,
): Promise<LineaNueva[]> {
  if (items.length === 0) throw new ErrorDeNegocio("Agregá al menos un artículo.");
  const lineas = consolidarLineas(items);
  for (const l of lineas) {
    const problema = problemaDeCantidad(l.cantidad);
    if (problema) throw new ErrorDeNegocio(problema);
  }

  const ids = lineas.map((l) => l.articuloId);
  const articulos = await tx.articulo.findMany({
    where: { id: { in: ids }, activo: true },
    select: { id: true, nombre: true, precioVenta: true, ivaPct: true },
  });
  const porId = new Map(articulos.map((a) => [a.id, a]));
  const faltantes = ids.filter((id) => !porId.has(id));
  if (faltantes.length > 0) {
    const nombres = faltantes.map((id) => previas.get(id)?.descripcion).filter((n): n is string => Boolean(n));
    throw new ErrorDeNegocio(
      nombres.length > 0
        ? `Estos artículos ya no existen o están dados de baja: ${nombres.join(", ")}. Quitalos del presupuesto.`
        : "Algún artículo ya no existe o está dado de baja.",
    );
  }

  const decisiones = lineas.map((l) => ({ l, decision: decidirPrecio({ articuloId: l.articuloId, previas, clienteCambio }) }));
  const aResolver = decisiones.filter((x) => x.decision.tipo === "RESOLVER").map((x) => x.l.articuloId);
  const lista = aResolver.length > 0 ? await cargarListaDeCliente(tx, clienteId, aResolver) : null;

  return decisiones.map(({ l, decision }) => {
    if (decision.tipo === "CONGELADO") {
      const p = decision.previa;
      return { articuloId: l.articuloId, descripcion: p.descripcion, cantidad: l.cantidad, precioUnitario: p.precioUnitario, ivaPct: p.ivaPct };
    }
    const articulo = porId.get(l.articuloId)!;
    const { precio } = resolverPrecio({ articuloId: articulo.id, precioCatalogo: articulo.precioVenta, lista });
    return { articuloId: articulo.id, descripcion: articulo.nombre, cantidad: l.cantidad, precioUnitario: precio, ivaPct: articulo.ivaPct };
  });
}

/** Fila del presupuesto bloqueada hasta el fin de la transaccion (`SELECT … FOR UPDATE`). */
async function bloquearPresupuesto(tx: Tx, id: string) {
  const filas = await tx.$queryRaw<
    {
      id: string;
      numero: number;
      anio: number;
      clienteId: string;
      fecha: Date;
      validezDias: number;
      observaciones: string | null;
      estado: EstadoGuardado;
      ventaId: string | null;
    }[]
  >`SELECT id, numero, anio, "clienteId", fecha, "validezDias", observaciones, estado::text AS estado, "ventaId"
    FROM "presupuestos" WHERE id = ${id}::uuid FOR UPDATE`;
  const fila = filas[0];
  if (!fila) throw new ErrorDeNegocio("El presupuesto no existe.");
  return fila;
}

/** "#12/2026" de la venta en la que se convirtio, para el mensaje de error. */
async function numeroDeVenta(tx: Tx, ventaId: string | null): Promise<string | null> {
  if (!ventaId) return null;
  const v = await tx.venta.findUnique({ where: { id: ventaId }, select: { numero: true, anio: true } });
  return v ? numeroPresupuesto(v.numero, v.anio) : null;
}

async function crearConLineas(
  tx: Tx,
  datos: {
    clienteId: string;
    validezDias: number;
    observaciones: string | null;
    duplicadoDeId: string | null;
    usuarioId: string | null;
  },
  lineas: LineaNueva[],
  hoy: Date,
): Promise<{ id: string; numero: number; anio: number }> {
  const anio = hoy.getUTCFullYear();
  // Un solo escritor numera por anio a la vez (lock distinto al de las ventas).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAVE_LOCK_PRESUPUESTOS}::bigint + ${anio}::bigint)`;
  const ultimo = await tx.presupuesto.aggregate({ where: { anio }, _max: { numero: true } });
  const numero = (ultimo._max.numero ?? 0) + 1;

  const creado = await tx.presupuesto.create({
    data: {
      numero,
      anio,
      clienteId: datos.clienteId,
      fecha: hoy,
      validezDias: datos.validezDias,
      observaciones: datos.observaciones,
      duplicadoDeId: datos.duplicadoDeId,
      usuarioId: datos.usuarioId,
      items: { create: lineas },
    },
    select: { id: true },
  });
  return { id: creado.id, numero, anio };
}

/**
 * Alta. `hoy` es la fecha de Argentina (`hoyArgentina()`); el numero es
 * correlativo por anio. Los precios se congelan ahora con `resolverPrecio`.
 * `usuarioId` es quien lo crea (null = sin usuario): queda fijo, editar no lo cambia.
 */
export async function crearPresupuestoEnTx(
  tx: Tx,
  datos: DatosPresupuesto,
  hoy: Date,
  usuarioId?: string | null,
): Promise<{ id: string; numero: number; anio: number }> {
  verificarValidez(datos.validezDias);
  await verificarCliente(tx, datos.clienteId);
  const lineas = await armarLineas(tx, datos.clienteId, datos.items);
  return crearConLineas(tx, { ...datos, duplicadoDeId: null, usuarioId: usuarioId ?? null }, lineas, hoy);
}

/**
 * Edicion: solo mientras esta ABIERTO y no vencido (un vencido se duplica, no se
 * edita: sus precios congelados ya no sirven y la fecha no se mueve). Las
 * lineas de articulos que ya estaban conservan su precio; las nuevas se
 * resuelven; si cambia el cliente se reprecia todo. Toma el lock de fila: no
 * puede editarse mientras otro lo convierte.
 */
export async function editarPresupuestoEnTx(tx: Tx, id: string, datos: DatosPresupuesto, hoy: Date): Promise<void> {
  const actual = await bloquearPresupuesto(tx, id);
  const ventaNumero = await numeroDeVenta(tx, actual.ventaId);
  const motivo = motivoNoAbierto({ ...actual, ventaNumero }, hoy, "editar");
  if (motivo) throw new ErrorDeNegocio(motivo);

  verificarValidez(datos.validezDias);
  if (motivoNoAbierto({ ...actual, validezDias: datos.validezDias }, hoy, "editar")) {
    throw new ErrorDeNegocio("Con esa validez el presupuesto quedaría vencido: usá más días.");
  }
  await verificarCliente(tx, datos.clienteId);

  const guardadas = await tx.presupuestoItem.findMany({ where: { presupuestoId: id } });
  const previas = new Map<string, LineaPrevia>(
    guardadas.map((g) => [
      g.articuloId,
      { articuloId: g.articuloId, descripcion: g.descripcion, precioUnitario: g.precioUnitario, ivaPct: g.ivaPct },
    ]),
  );
  const lineas = await armarLineas(tx, datos.clienteId, datos.items, previas, datos.clienteId !== actual.clienteId);

  await tx.presupuestoItem.deleteMany({ where: { presupuestoId: id } });
  await tx.presupuesto.update({
    where: { id },
    data: {
      clienteId: datos.clienteId,
      validezDias: datos.validezDias,
      observaciones: datos.observaciones,
      items: { create: lineas },
    },
  });
}

/** Baja logica: pasa a ANULADO, no se borra. Solo un ABIERTO (vencido o no) se anula. */
export async function anularPresupuestoEnTx(tx: Tx, id: string): Promise<void> {
  const actual = await bloquearPresupuesto(tx, id);
  if (actual.estado === "ANULADO") throw new ErrorDeNegocio("Este presupuesto ya estaba anulado.");
  if (actual.estado === "CONVERTIDO") {
    const v = await numeroDeVenta(tx, actual.ventaId);
    throw new ErrorDeNegocio(
      `Este presupuesto ya se convirtió en la venta${v ? ` #${v}` : ""}: si hay que deshacerlo, anulá la venta.`,
    );
  }
  await tx.presupuesto.update({ where: { id }, data: { estado: "ANULADO" } });
}

/**
 * Copia como presupuesto NUEVO (numero y fecha de hoy) con los precios de hoy
 * del cliente: es lo que se hace con uno vencido. Sirve para cualquier estado.
 * La copia queda a nombre de quien duplica (`usuarioId`), no del original.
 */
export async function duplicarPresupuestoEnTx(
  tx: Tx,
  id: string,
  hoy: Date,
  usuarioId?: string | null,
): Promise<{ id: string; numero: number; anio: number }> {
  const origen = await tx.presupuesto.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" } } } });
  if (!origen) throw new ErrorDeNegocio("El presupuesto no existe.");
  await verificarCliente(tx, origen.clienteId);

  const previas = new Map<string, LineaPrevia>(
    origen.items.map((g) => [
      g.articuloId,
      { articuloId: g.articuloId, descripcion: g.descripcion, precioUnitario: g.precioUnitario, ivaPct: g.ivaPct },
    ]),
  );
  // clienteCambio = true: ninguna linea conserva el precio viejo.
  const lineas = await armarLineas(
    tx,
    origen.clienteId,
    origen.items.map((i) => ({ articuloId: i.articuloId, cantidad: i.cantidad })),
    previas,
    true,
  );
  return crearConLineas(
    tx,
    {
      clienteId: origen.clienteId,
      validezDias: origen.validezDias,
      observaciones: origen.observaciones,
      duplicadoDeId: origen.id,
      usuarioId: usuarioId ?? null,
    },
    lineas,
    hoy,
  );
}

export type PresupuestoConvertido = {
  ventaId: string;
  numero: number;
  anio: number;
  totalBruto: Dinero;
  advertencias: string[];
};

/**
 * Convierte el presupuesto en una venta (sin pago inicial y no entregada), en
 * UNA transaccion:
 *  1. `SELECT … FOR UPDATE` sobre el presupuesto: dos conversiones simultaneas
 *     se serializan y la segunda ve CONVERTIDO y falla con un error claro;
 *  2. verifica ABIERTO y no vencido;
 *  3. `registrarVentaEnTx` con los precios CONGELADOS (override), asi el total
 *     de la venta es el del presupuesto aunque el catalogo haya cambiado. La
 *     falta de stock no frena: las advertencias se devuelven. Un cliente dado de
 *     baja lo rechaza `registrarVentaEnTx`;
 *  4. marca CONVERTIDO con el `ventaId`.
 *
 * La venta (con sus movimientos de stock) queda a nombre de quien convierte
 * (`usuarioId`), no de quien creo el presupuesto.
 *
 * Limite conocido: el IVA de la venta lo toma `registrarVentaEnTx` del articulo
 * de hoy. Si cambio desde el presupuesto, el total (con IVA incluido) es el
 * mismo pero el desglose neto/IVA no; se avisa.
 */
export async function convertirPresupuestoEnTx(
  tx: Tx,
  id: string,
  hoy: Date,
  usuarioId?: string | null,
): Promise<PresupuestoConvertido> {
  const actual = await bloquearPresupuesto(tx, id);
  const ventaNumero = await numeroDeVenta(tx, actual.ventaId);
  const motivo = motivoNoAbierto({ ...actual, ventaNumero }, hoy, "convertir");
  if (motivo) throw new ErrorDeNegocio(motivo);

  const items = await tx.presupuestoItem.findMany({ where: { presupuestoId: id }, orderBy: { id: "asc" } });
  if (items.length === 0) throw new ErrorDeNegocio("El presupuesto no tiene artículos.");

  const nro = numeroPresupuesto(actual.numero, actual.anio);
  const venta = await registrarVentaEnTx(tx, {
    clienteId: actual.clienteId,
    fecha: hoy,
    observaciones: `Presupuesto N° ${nro}${actual.observaciones ? ` — ${actual.observaciones}` : ""}`,
    entregada: false,
    usuarioId,
    items: items.map((i) => ({ articuloId: i.articuloId, cantidad: i.cantidad, precioUnitario: i.precioUnitario })),
    pago: null,
  });

  // Red de seguridad: el total de la venta tiene que ser el del presupuesto.
  const esperado = totalizarPresupuesto(
    items.map((i) => ({ cantidad: d(i.cantidad), precioUnitario: d(i.precioUnitario), ivaPct: d(i.ivaPct) })),
  ).totalBruto;
  if (!venta.totalBruto.equals(esperado)) {
    throw new Error(`El total de la venta (${venta.totalBruto}) no coincide con el del presupuesto (${esperado}).`);
  }

  const advertencias = [...venta.advertencias];
  const lineasVenta = await tx.ventaItem.findMany({ where: { ventaId: venta.id }, select: { articuloId: true, ivaPct: true } });
  const ivaHoy = new Map(lineasVenta.map((l) => [l.articuloId, l.ivaPct]));
  for (const i of items) {
    const hoyIva = ivaHoy.get(i.articuloId);
    if (hoyIva && !d(hoyIva).equals(i.ivaPct)) {
      advertencias.push(
        `${i.descripcion}: el IVA cambió de ${i.ivaPct}% a ${hoyIva}% desde el presupuesto. El total es el mismo, pero el desglose de IVA de la venta usa el actual.`,
      );
    }
  }

  await tx.presupuesto.update({ where: { id }, data: { estado: "CONVERTIDO", ventaId: venta.id } });
  return { ventaId: venta.id, numero: venta.numero, anio: venta.anio, totalBruto: venta.totalBruto, advertencias };
}
