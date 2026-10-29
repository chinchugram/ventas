import { aCosto, type Dinero } from "@/lib/money";
import { ErrorDeNegocio } from "@/lib/acciones";
import { subtotalCompra, totalizarCompra } from "@/lib/stock";
import type { Tx } from "./tx";

export type CompraNueva = {
  fecha: Date;
  proveedor: string;
  comprobante: string | null;
  notas: string | null;
  /** Si el costo del material pasa a ser el de esta compra. */
  actualizarCosto: boolean;
  items: { materialId: string; cantidad: Dinero; costoUnitario: Dinero }[];
  /** Momento del movimiento de stock. Por defecto, ahora (el seed lo fija). */
  momento?: Date;
};

/**
 * Registra una compra: guarda la cabecera y las lineas, suma el stock de cada
 * material y deja un movimiento por linea.
 *
 * Con `actualizarCosto`, el costo del material pasa a ser el de esta compra (el
 * ultimo precio pagado), que es lo que cuesta reponerlo hoy. Las recetas se
 * recalculan solas; las ventas ya hechas conservan su costo congelado.
 */
export async function registrarCompraEnTx(tx: Tx, compra: CompraNueva): Promise<{ id: string }> {
  const { items, actualizarCosto, momento } = compra;
  if (items.length === 0) throw new ErrorDeNegocio("Agregá al menos un material");

  const ids = [...new Set(items.map((l) => l.materialId))];
  const activos = await tx.material.count({ where: { id: { in: ids }, activo: true } });
  if (activos !== ids.length) throw new ErrorDeNegocio("Algún material ya no existe o está dado de baja.");

  const lineas = items.map((l) => ({ ...l, costoUnitario: aCosto(l.costoUnitario) }));
  const creada = await tx.compra.create({
    data: {
      fecha: compra.fecha,
      proveedor: compra.proveedor,
      comprobante: compra.comprobante,
      notas: compra.notas,
      total: totalizarCompra(lineas),
      items: {
        create: lineas.map((l) => ({
          materialId: l.materialId,
          cantidad: l.cantidad,
          costoUnitario: l.costoUnitario,
          subtotal: subtotalCompra(l.cantidad, l.costoUnitario),
        })),
      },
    },
  });

  for (const l of lineas) {
    const material = await tx.material.update({
      where: { id: l.materialId },
      data: {
        stockActual: { increment: l.cantidad },
        ...(actualizarCosto ? { costoUnitario: l.costoUnitario } : {}),
      },
      select: { stockActual: true },
    });
    await tx.movimientoStock.create({
      data: {
        materialId: l.materialId,
        tipo: "COMPRA",
        cantidad: l.cantidad,
        stockResultante: material.stockActual,
        motivo: `Compra a ${compra.proveedor}`,
        compraId: creada.id,
        ...(momento ? { creadoEn: momento } : {}),
      },
    });
  }

  return { id: creada.id };
}
