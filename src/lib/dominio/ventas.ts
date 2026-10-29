import { aCosto, CERO, d, fmtNumero, type Dinero } from "@/lib/money";
import { ErrorDeNegocio } from "@/lib/acciones";
import { costearLineaVenta, totalizarVenta } from "@/lib/costing";
import { configNumero, recetaResuelta } from "@/lib/receta";
import { resolverPrecio } from "@/lib/precios";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { cargarListaDeCliente } from "./listas-precios";
import type { Tx } from "./tx";

export type MetodoPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "OTRO";

export type VentaNueva = {
  clienteId: string;
  fecha: Date;
  observaciones: string | null;
  entregada: boolean;
  items: {
    articuloId: string;
    cantidad: Dinero;
    /**
     * Override del precio unitario: SOLO lo pasa el servidor (por ejemplo al
     * convertir un presupuesto con el precio acordado), nunca un formulario.
     * Sin override, el precio sale de `resolverPrecio` segun la lista del cliente.
     */
    precioUnitario?: Dinero;
  }[];
  pago: { monto: Dinero; metodo: MetodoPago } | null;
  /** Momento de los movimientos de stock. Por defecto, ahora (el seed lo fija). */
  momento?: Date;
};

export type VentaRegistrada = {
  id: string;
  numero: number;
  anio: number;
  totalBruto: Dinero;
  advertencias: string[];
};

/**
 * Confirma una venta. Todo se recalcula a partir de la base: precio (catalogo o
 * lista del cliente, ver `resolverPrecio`), IVA y costo de receta del momento.
 * Lo que llega de afuera es solo que se vendio, cuanto y a quien.
 *
 * Numera la venta, congela los costos, descuenta el stock de los materiales de
 * cada receta (con un movimiento por material) y registra el pago inicial.
 *
 * Nunca se frena una venta por falta de stock: el sistema puede estar
 * desactualizado y el pedido ya esta hecho. Se descuenta lo que hay, se deja
 * constancia en el movimiento y se devuelve una advertencia.
 */
export async function registrarVentaEnTx(tx: Tx, venta: VentaNueva): Promise<VentaRegistrada> {
  const { clienteId, fecha, entregada, pago, momento } = venta;
  const anio = fecha.getUTCFullYear();
  if (venta.items.length === 0) throw new ErrorDeNegocio("Agregá al menos un artículo");

  for (const l of venta.items) {
    if (l.precioUnitario !== undefined && l.precioUnitario.lt(0)) {
      throw new ErrorDeNegocio("El precio unitario no puede ser negativo.");
    }
  }

  const cliente = await tx.cliente.findFirst({ where: { id: clienteId, activo: true }, select: { id: true } });
  if (!cliente) throw new ErrorDeNegocio("El cliente no existe o está dado de baja.");

  const ids = [...new Set(venta.items.map((l) => l.articuloId))];
  const lista = await cargarListaDeCliente(tx, clienteId, ids);
  const articulos = await tx.articulo.findMany({
    where: { id: { in: ids }, activo: true },
    include: {
      receta: { include: { componentes: { include: { material: true, maquina: true }, orderBy: { id: "asc" } } } },
    },
  });
  if (articulos.length !== ids.length) throw new ErrorDeNegocio("Algún artículo ya no existe o está dado de baja.");
  const porId = new Map(articulos.map((a) => [a.id, a]));

  const config = await tx.configuracion.findMany();
  const costoHora = configNumero(Object.fromEntries(config.map((c) => [c.clave, c.valor])), "costoHoraManoObra", "0");

  const consumos = new Map<string, Dinero>();
  const items = venta.items.map((l) => {
    const articulo = porId.get(l.articuloId)!;
    const componentes = articulo.receta?.componentes ?? [];
    const receta = recetaResuelta(componentes, costoHora);
    const precioUnitario =
      l.precioUnitario !== undefined
        ? aCosto(l.precioUnitario)
        : resolverPrecio({ articuloId: articulo.id, precioCatalogo: articulo.precioVenta, lista }).precio;
    const cal = costearLineaVenta({
      cantidad: l.cantidad,
      precioUnitario,
      ivaPct: articulo.ivaPct,
      costoUnitario: receta.costoTotal,
    });

    if (!articulo.esServicio) {
      for (const c of componentes) {
        if (c.tipo === "MATERIAL" && c.materialId) {
          consumos.set(c.materialId, (consumos.get(c.materialId) ?? CERO).plus(c.cantidad.times(l.cantidad)));
        }
      }
    }

    return {
      articuloId: articulo.id,
      descripcion: articulo.nombre,
      cantidad: l.cantidad,
      precioUnitario,
      ivaPct: articulo.ivaPct,
      subtotalNeto: cal.subtotalNeto,
      subtotalIVA: cal.subtotalIVA,
      subtotalBruto: cal.subtotalBruto,
      costoUnitarioSnapshot: cal.costoUnitarioSnapshot,
      costoTotalSnapshot: cal.costoTotalSnapshot,
    };
  });
  const totales = totalizarVenta(items);

  if (pago && pago.monto.gt(totales.totalBruto.plus("0.01"))) {
    throw new ErrorDeNegocio("El pago no puede superar el total de la venta.");
  }

  // Un solo escritor numera por anio a la vez: el correlativo no se repite ni deja huecos.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${anio})`;
  const ultimo = await tx.venta.aggregate({ where: { anio }, _max: { numero: true } });
  const numero = (ultimo._max.numero ?? 0) + 1;

  const creada = await tx.venta.create({
    data: {
      numero,
      anio,
      clienteId,
      fecha,
      estado: entregada ? "ENTREGADA" : "PENDIENTE",
      observaciones: venta.observaciones,
      totalNeto: totales.totalNeto,
      totalIVA: totales.totalIVA,
      totalBruto: totales.totalBruto,
      costoTotal: totales.costoTotal,
      items: { create: items },
    },
  });

  if (pago) {
    await tx.pago.create({
      data: { ventaId: creada.id, clienteId, fecha, monto: pago.monto, metodo: pago.metodo },
    });
  }

  const advertencias: string[] = [];
  // Orden fijo por id: dos ventas simultaneas bloquean las filas en el mismo orden.
  for (const [materialId, consumo] of [...consumos].sort(([a], [b]) => a.localeCompare(b))) {
    const filas = await tx.$queryRaw<{ stockActual: string; nombre: string; unidad: string }[]>`
      SELECT "stockActual"::text AS "stockActual", nombre, unidad::text AS unidad
      FROM "materiales" WHERE id = ${materialId}::uuid FOR UPDATE`;
    const fila = filas[0];
    if (!fila) continue;

    const disponible = d(fila.stockActual);
    const descontar = consumo.lt(disponible) ? consumo : disponible;
    const faltante = consumo.minus(descontar);
    if (faltante.gt(0)) {
      advertencias.push(
        `${fila.nombre}: faltaron ${fmtNumero(faltante)} ${ETIQUETA_UNIDAD[fila.unidad] ?? fila.unidad} de stock (el sistema quedó en 0).`,
      );
    }
    if (descontar.lte(0)) continue;

    const material = await tx.material.update({
      where: { id: materialId },
      data: { stockActual: { decrement: descontar } },
      select: { stockActual: true },
    });
    await tx.movimientoStock.create({
      data: {
        materialId,
        tipo: "VENTA",
        cantidad: descontar.neg(),
        stockResultante: material.stockActual,
        motivo: `Venta #${numero}/${anio}${faltante.gt(0) ? ` (faltaron ${fmtNumero(faltante)})` : ""}`,
        ventaId: creada.id,
        ...(momento ? { creadoEn: momento } : {}),
      },
    });
  }

  return { id: creada.id, numero, anio, totalBruto: totales.totalBruto, advertencias };
}

/**
 * Anula una venta y devuelve al stock exactamente lo que se desconto al
 * confirmarla (se leen sus movimientos, no se recalcula la receta: si la receta
 * cambio desde entonces, igual vuelve lo que realmente salio).
 *
 * La venta no se borra: queda ANULADA y deja de contar en saldos y reportes.
 */
export async function anularVentaEnTx(tx: Tx, ventaId: string): Promise<void> {
  const filas = await tx.$queryRaw<{ estado: string; numero: number; anio: number }[]>`
    SELECT estado::text AS estado, numero, anio FROM "ventas" WHERE id = ${ventaId}::uuid FOR UPDATE`;
  const venta = filas[0];
  if (!venta) throw new ErrorDeNegocio("La venta no existe.");
  if (venta.estado === "ANULADA") throw new ErrorDeNegocio("La venta ya estaba anulada.");

  await tx.venta.update({ where: { id: ventaId }, data: { estado: "ANULADA" } });

  const salidas = await tx.movimientoStock.findMany({
    where: { ventaId, tipo: "VENTA" },
    orderBy: { materialId: "asc" },
  });
  for (const salida of salidas) {
    const material = await tx.material.update({
      where: { id: salida.materialId },
      data: { stockActual: { increment: salida.cantidad.neg() } },
      select: { stockActual: true },
    });
    await tx.movimientoStock.create({
      data: {
        materialId: salida.materialId,
        tipo: "VENTA",
        cantidad: salida.cantidad.neg(),
        stockResultante: material.stockActual,
        motivo: `Anulación de la venta #${venta.numero}/${venta.anio}`,
        ventaId,
      },
    });
  }
}
