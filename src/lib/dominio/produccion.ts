import { d, fmtNumero, type Dinero } from "@/lib/money";
import { ErrorDeNegocio } from "@/lib/acciones";
import { configNumero } from "@/lib/receta";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import {
  calcularAjusteDeStock,
  consumoDeRecetaEnStock,
  marcaDeLinea,
  motivoDeAjusteProduccion,
  validarCarga,
  type ComponenteReceta,
  type ConsumoMaterial,
  type TiempoMaquina,
} from "@/lib/produccion";
import { ajustarStockEnTx } from "./stock";
import type { Tx } from "./tx";

const MAX_NOTAS = 500;
const MAX_MOTIVO = 200;

export type TrabajoNuevo = {
  ventaItemId: string;
  /** Dia en que se hizo el trabajo (fecha de negocio, sin hora). */
  fecha: Date;
  minutosManoObra: Dinero;
  tiempos: TiempoMaquina[];
  consumos: ConsumoMaterial[];
  notas: string | null;
  /** Quien lo carga; ausente = sin usuario (se muestra "—"). */
  usuarioId?: string | null;
};

/**
 * Carga el trabajo de una linea de venta. Valida todo en el servidor y CONGELA los
 * costos vigentes (costo/hora de cada maquina y de la mano de obra, costo unitario de
 * cada material): un cambio de precio posterior no reescribe lo ya producido. Esos
 * snapshots los pone esta funcion; el cliente nunca los manda ni los recibe.
 *
 * Bloquea la venta (`FOR UPDATE`): dos cargas simultaneas de la misma linea, o una
 * carga y la anulacion de la venta, se serializan. La segunda ve el trabajo vigente y
 * recibe un error claro (nunca el del indice unico). NO mueve stock.
 */
export async function cargarTrabajoEnTx(tx: Tx, negocioId: string, t: TrabajoNuevo): Promise<{ id: string }> {
  const filas = await tx.$queryRaw<{ ventaId: string; estado: string; numero: number; anio: number }[]>`
    SELECT v.id::text AS "ventaId", v.estado::text AS estado, v.numero, v.anio
    FROM "venta_items" vi JOIN "ventas" v ON v.id = vi."ventaId"
    WHERE vi.id = ${t.ventaItemId}::uuid AND vi."negocioId" = ${negocioId}::uuid FOR UPDATE OF v`;
  const venta = filas[0];
  if (!venta) throw new ErrorDeNegocio("La línea de la venta no existe.");
  if (venta.estado === "ANULADA") {
    throw new ErrorDeNegocio(`La venta #${venta.numero}/${venta.anio} está anulada: no se carga producción.`);
  }

  const vigente = await tx.trabajoProduccion.findFirst({
    where: { negocioId, ventaItemId: t.ventaItemId, anuladoEn: null },
    select: { id: true },
  });
  if (vigente) {
    throw new ErrorDeNegocio("Esta línea ya tiene un trabajo cargado. Para corregirlo, anulalo y cargalo de nuevo.");
  }

  const notas = t.notas?.trim() || null;
  if (notas && notas.length > MAX_NOTAS) throw new ErrorDeNegocio(`Las notas admiten hasta ${MAX_NOTAS} caracteres.`);

  const problema = validarCarga({ minutosManoObra: t.minutosManoObra, tiempos: t.tiempos, consumos: t.consumos });
  if (problema) throw new ErrorDeNegocio(problema);

  const maquinas = await tx.maquina.findMany({
    where: { negocioId, id: { in: t.tiempos.map((x) => x.maquinaId) }, activo: true },
    select: { id: true, costoHora: true },
  });
  if (maquinas.length !== t.tiempos.length) throw new ErrorDeNegocio("Alguna máquina ya no existe o está dada de baja.");
  const materiales = await tx.material.findMany({
    where: { negocioId, id: { in: t.consumos.map((x) => x.materialId) }, activo: true },
    select: { id: true, costoUnitario: true },
  });
  if (materiales.length !== t.consumos.length) throw new ErrorDeNegocio("Algún material ya no existe o está dado de baja.");
  const costoHoraMaquina = new Map(maquinas.map((m) => [m.id, m.costoHora]));
  const costoMaterial = new Map(materiales.map((m) => [m.id, m.costoUnitario]));

  const config = await tx.configuracion.findMany({ where: { negocioId } });
  const costoHoraManoObra = configNumero(Object.fromEntries(config.map((c) => [c.clave, c.valor])), "costoHoraManoObra", "0");

  const creado = await tx.trabajoProduccion.create({
    data: {
      negocioId,
      ventaItemId: t.ventaItemId,
      fecha: t.fecha,
      minutosManoObra: t.minutosManoObra,
      costoHoraManoObraSnapshot: costoHoraManoObra,
      notas,
      usuarioId: t.usuarioId ?? null,
      tiempos: {
        create: t.tiempos.map((x) => ({
          negocioId,
          maquinaId: x.maquinaId,
          minutos: x.minutos,
          costoHoraSnapshot: costoHoraMaquina.get(x.maquinaId)!,
        })),
      },
      consumos: {
        create: t.consumos.map((x) => ({
          negocioId,
          materialId: x.materialId,
          cantidad: x.cantidad,
          costoUnitarioSnapshot: costoMaterial.get(x.materialId)!,
        })),
      },
    },
    select: { id: true },
  });
  return creado;
}

/**
 * Anula un trabajo (baja logica con motivo, a nombre de quien lo anula). No borra nada:
 * el trabajo queda de historial y la linea vuelve a poder cargarse. NO toca el stock: si
 * se habia ajustado, ese ajuste queda en el libro y el proximo ajuste de la linea lo
 * descuenta de la cuenta (ver `calcularAjusteDeStock`).
 */
export async function anularTrabajoEnTx(
  tx: Tx,
  negocioId: string,
  anulacion: { trabajoId: string; motivo: string; usuarioId?: string | null },
): Promise<{ ventaItemId: string }> {
  const motivo = anulacion.motivo.trim();
  if (!motivo) throw new ErrorDeNegocio("Escribí el motivo de la anulación.");
  if (motivo.length > MAX_MOTIVO) throw new ErrorDeNegocio(`El motivo admite hasta ${MAX_MOTIVO} caracteres.`);

  const filas = await tx.$queryRaw<{ ventaItemId: string; anuladoEn: Date | null }[]>`
    SELECT "ventaItemId"::text AS "ventaItemId", "anuladoEn" FROM "trabajos_produccion"
    WHERE id = ${anulacion.trabajoId}::uuid AND "negocioId" = ${negocioId}::uuid FOR UPDATE`;
  const trabajo = filas[0];
  if (!trabajo) throw new ErrorDeNegocio("El trabajo no existe.");
  if (trabajo.anuladoEn) throw new ErrorDeNegocio("El trabajo ya estaba anulado.");

  // El modelo guarda un solo `usuarioId` (quien CARGO el trabajo, que no se pisa): quien anula
  // queda en el propio motivo, que es lo que se muestra en el historial.
  const quien = anulacion.usuarioId
    ? (await tx.usuario.findFirst({ where: { id: anulacion.usuarioId, OR: [{ negocioId }, { negocioId: null }] }, select: { nombre: true } }))?.nombre
    : null;
  await tx.trabajoProduccion.update({
    where: { id: anulacion.trabajoId },
    data: { anuladoEn: new Date(), motivoAnulacion: quien ? `${motivo} (anulado por ${quien})` : motivo },
  });
  return { ventaItemId: trabajo.ventaItemId };
}

/** Lo ya ajustado por una linea: suma (con signo de stock) de sus movimientos AJUSTE de produccion, por material. */
export async function ajustadoPorLinea(tx: Tx, negocioId: string, ventaItemId: string): Promise<ConsumoMaterial[]> {
  const movimientos = await tx.movimientoStock.findMany({
    where: { negocioId, tipo: "AJUSTE", motivo: { contains: marcaDeLinea(ventaItemId) } },
    select: { materialId: true, cantidad: true },
  });
  return movimientos.map((m) => ({ materialId: m.materialId, cantidad: m.cantidad }));
}

/** Componentes de la receta (sin costos) del articulo de una linea, mas lo que hace falta para el calculo. */
export async function recetaDeLinea(tx: Tx, negocioId: string, ventaItemId: string) {
  const linea = await tx.ventaItem.findFirst({
    where: { id: ventaItemId, negocioId },
    select: {
      cantidad: true,
      venta: { select: { id: true, numero: true, anio: true, estado: true } },
      articulo: {
        select: {
          esServicio: true,
          receta: { select: { componentes: { select: { tipo: true, materialId: true, maquinaId: true, cantidad: true }, orderBy: { id: "asc" } } } },
        },
      },
    },
  });
  if (!linea) return null;
  const componentes: ComponenteReceta[] = (linea.articulo.receta?.componentes ?? []).map((c) => ({
    tipo: c.tipo,
    materialId: c.materialId,
    maquinaId: c.maquinaId,
    cantidad: c.cantidad,
  }));
  return { cantidad: linea.cantidad, venta: linea.venta, esServicio: linea.articulo.esServicio, componentes };
}

/**
 * Ajusta el stock por la diferencia entre el consumo real del trabajo y la receta
 * (lo que la venta ya descontó). Es una decision EXPLICITA de quien llama (la accion
 * exige el permiso `ajustarStock` y la casilla confirmada): cargar el consumo nunca
 * llama a esto por si solo.
 *
 * Idempotente: el objetivo por linea es −(real − receta) en total; se resta lo ya
 * ajustado (libro de movimientos), asi un segundo ajuste sin cambios no hace nada y
 * nunca se descuenta dos veces, tampoco tras anular y recargar. Cada material se mueve
 * con `ajustarStockEnTx` (movimiento `AJUSTE`, con el motivo que referencia la venta).
 * Si el stock no alcanza para descontar, no se ajusta nada (todo o nada).
 */
export async function ajustarStockDeTrabajoEnTx(
  tx: Tx,
  negocioId: string,
  ajuste: { trabajoId: string; usuarioId?: string | null },
): Promise<{ ajustados: { materialId: string; movimiento: Dinero }[] }> {
  const trabajo = await tx.trabajoProduccion.findFirst({
    where: { id: ajuste.trabajoId, negocioId },
    select: { id: true, ventaItemId: true, anuladoEn: true, consumos: { select: { materialId: true, cantidad: true } } },
  });
  if (!trabajo) throw new ErrorDeNegocio("El trabajo no existe.");
  if (trabajo.anuladoEn) throw new ErrorDeNegocio("El trabajo está anulado: no se ajusta el stock.");
  if (trabajo.consumos.length === 0) throw new ErrorDeNegocio("El trabajo no tiene materiales cargados: no hay nada que ajustar.");

  // Serializa con otras cargas/ajustes de la misma venta.
  const linea = await recetaDeLinea(tx, negocioId, trabajo.ventaItemId);
  if (!linea) throw new ErrorDeNegocio("La línea de la venta no existe.");
  await tx.$executeRaw`SELECT 1 FROM "ventas" WHERE id = ${linea.venta.id}::uuid AND "negocioId" = ${negocioId}::uuid FOR UPDATE`;
  if (linea.venta.estado === "ANULADA") {
    throw new ErrorDeNegocio(`La venta #${linea.venta.numero}/${linea.venta.anio} está anulada: su stock ya volvió, no se ajusta.`);
  }

  const yaAjustado = await ajustadoPorLinea(tx, negocioId, trabajo.ventaItemId);
  const filas = calcularAjusteDeStock({
    receta: consumoDeRecetaEnStock(linea.componentes, linea.cantidad, linea.esServicio),
    real: trabajo.consumos.map((c) => ({ materialId: c.materialId, cantidad: c.cantidad })),
    yaAjustado,
  });
  const pendientes = filas.filter((f) => !f.movimiento.isZero()).sort((a, b) => a.materialId.localeCompare(b.materialId));
  if (pendientes.length === 0) {
    throw new ErrorDeNegocio(
      yaAjustado.length > 0
        ? "El stock de este trabajo ya está ajustado: no hay diferencias nuevas."
        : "El consumo real coincide con la receta: no hay nada que ajustar.",
    );
  }

  const motivo = motivoDeAjusteProduccion(linea.venta, trabajo.ventaItemId);
  const ajustados: { materialId: string; movimiento: Dinero }[] = [];
  // Orden fijo por id: dos ajustes simultaneos bloquean los materiales en el mismo orden.
  for (const fila of pendientes) {
    const [actual] = await tx.$queryRaw<{ stockActual: string; nombre: string; unidad: string }[]>`
      SELECT "stockActual"::text AS "stockActual", nombre, unidad::text AS unidad
      FROM "materiales" WHERE id = ${fila.materialId}::uuid AND "negocioId" = ${negocioId}::uuid AND activo = true FOR UPDATE`;
    if (!actual) throw new ErrorDeNegocio("Algún material ya no existe o está dado de baja.");
    const nuevo = d(actual.stockActual).plus(fila.movimiento);
    if (nuevo.lt(0)) {
      const unidad = ETIQUETA_UNIDAD[actual.unidad] ?? actual.unidad;
      throw new ErrorDeNegocio(
        `${actual.nombre}: el stock (${fmtNumero(actual.stockActual)} ${unidad}) no alcanza para descontar ${fmtNumero(fila.movimiento.abs())} ${unidad}. No se ajustó nada.`,
      );
    }
    await ajustarStockEnTx(tx, negocioId, { materialId: fila.materialId, stockContado: nuevo, motivo, usuarioId: ajuste.usuarioId ?? null });
    ajustados.push({ materialId: fila.materialId, movimiento: fila.movimiento });
  }
  return { ajustados };
}

/**
 * Atajo para el caso comun: carga el trabajo y, si se pidio, ajusta el stock en la
 * MISMA transaccion (todo o nada). `ajustarStock` solo debe llegar en true desde una
 * accion que ya verifico el permiso del dueño.
 */
export async function cargarTrabajoYAjustarEnTx(
  tx: Tx,
  negocioId: string,
  trabajo: TrabajoNuevo,
  ajustarStock: boolean,
): Promise<{ id: string; ajustados: { materialId: string; movimiento: Dinero }[] }> {
  const { id } = await cargarTrabajoEnTx(tx, negocioId, trabajo);
  if (!ajustarStock) return { id, ajustados: [] };
  const { ajustados } = await ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: id, usuarioId: trabajo.usuarioId });
  return { id, ajustados };
}
