"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { revalidarVentas } from "@/lib/revalidar";
import type { Resultado } from "@/app/compras/actions";

const esquema = z.object({ ventaId: z.uuid("Venta inválida") });

/**
 * Anula una venta y devuelve al stock exactamente lo que se desconto al
 * confirmarla (se leen sus movimientos, no se recalcula la receta: si la receta
 * cambio desde entonces, igual vuelve lo que realmente salio).
 *
 * La venta no se borra: queda ANULADA y deja de contar en saldos y reportes.
 */
export async function anularVenta(datos: z.input<typeof esquema>): Promise<Resultado> {
  const parsed = esquema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  if (!(await dbDisponible())) {
    return { ok: false, error: "No hay base de datos conectada: esta pantalla está en modo demostración y no guarda." };
  }
  const { ventaId } = parsed.data;

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<{ estado: string; numero: number; anio: number }[]>`
        SELECT estado::text AS estado, numero, anio FROM "ventas" WHERE id = ${ventaId}::uuid FOR UPDATE`;
      const venta = filas[0];
      if (!venta) return "La venta no existe.";
      if (venta.estado === "ANULADA") return "La venta ya estaba anulada.";

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
      return null;
    });
    if (resultado) return { ok: false, error: resultado };
  } catch (error) {
    console.error("[anularVenta]", error);
    return { ok: false, error: "No se pudo anular la venta." };
  }

  revalidarVentas();
  revalidatePath(`/ventas/${ventaId}`);
  return { ok: true };
}
