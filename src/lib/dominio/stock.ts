import { d, type Dinero } from "@/lib/money";
import { ErrorDeNegocio } from "@/lib/acciones";
import { diferenciaDeConteo } from "@/lib/stock";
import type { Tx } from "./tx";

/**
 * Ajuste por conteo fisico: el dueño cuenta lo que hay y se registra la
 * diferencia como un movimiento. Nunca se pisa el stock sin dejar rastro.
 * Devuelve la diferencia aplicada (positiva = sobraba).
 */
export async function ajustarStockEnTx(
  tx: Tx,
  ajuste: { materialId: string; stockContado: Dinero; motivo: string; usuarioId?: string | null },
): Promise<{ diferencia: Dinero }> {
  const { materialId, stockContado, motivo } = ajuste;

  // FOR UPDATE: si entra una compra mientras se ajusta, una espera a la otra.
  const filas = await tx.$queryRaw<{ stockActual: string }[]>`
    SELECT "stockActual"::text AS "stockActual" FROM "materiales"
    WHERE id = ${materialId}::uuid AND activo = true FOR UPDATE`;
  if (filas.length === 0) throw new ErrorDeNegocio("El material no existe.");

  const diferencia = diferenciaDeConteo(d(filas[0]!.stockActual), stockContado);
  if (diferencia.isZero()) {
    throw new ErrorDeNegocio("El stock contado coincide con el del sistema: no hay nada que ajustar.");
  }

  await tx.material.update({ where: { id: materialId }, data: { stockActual: stockContado } });
  await tx.movimientoStock.create({
    data: {
      materialId,
      tipo: "AJUSTE",
      cantidad: diferencia,
      stockResultante: stockContado,
      motivo,
      usuarioId: ajuste.usuarioId ?? null,
    },
  });
  return { diferencia };
}
