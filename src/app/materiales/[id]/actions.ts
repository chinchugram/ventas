"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { d } from "@/lib/money";
import { diferenciaDeConteo } from "@/lib/stock";
import type { Resultado } from "@/app/compras/actions";

const esquema = z.object({
  materialId: z.uuid("Material inválido"),
  stockContado: z
    .string()
    .trim()
    .refine((v) => /^\d+([.,]\d+)?$/.test(v), "El stock contado debe ser un número, 0 o más"),
  motivo: z.string().trim().min(1, "Contá por qué ajustás (rotura, merma, conteo…)").max(200),
});

/**
 * Ajuste por conteo fisico: el dueño cuenta lo que hay y el sistema registra la
 * diferencia como un movimiento. Nunca se pisa el stock sin dejar rastro.
 */
export async function ajustarStock(datos: z.input<typeof esquema>): Promise<Resultado> {
  const parsed = esquema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  if (!(await dbDisponible())) {
    return { ok: false, error: "No hay base de datos conectada: esta pantalla está en modo demostración y no guarda." };
  }

  const { materialId, motivo } = parsed.data;
  const contado = d(parsed.data.stockContado.replace(",", "."));

  try {
    const cambio = await prisma.$transaction(async (tx) => {
      // FOR UPDATE: si entra una compra mientras se ajusta, una espera a la otra.
      const filas = await tx.$queryRaw<{ stockActual: string }[]>`
        SELECT "stockActual"::text AS "stockActual" FROM "materiales"
        WHERE id = ${materialId}::uuid AND activo = true FOR UPDATE`;
      if (filas.length === 0) throw new Error("El material no existe.");

      const diferencia = diferenciaDeConteo(d(filas[0]!.stockActual), contado);
      if (diferencia.isZero()) return false;

      await tx.material.update({ where: { id: materialId }, data: { stockActual: contado } });
      await tx.movimientoStock.create({
        data: {
          materialId,
          tipo: "AJUSTE",
          cantidad: diferencia,
          stockResultante: contado,
          motivo,
        },
      });
      return true;
    });
    if (!cambio) return { ok: false, error: "El stock contado coincide con el del sistema: no hay nada que ajustar." };
  } catch (error) {
    console.error("[ajustarStock]", error);
    return { ok: false, error: "No se pudo ajustar el stock." };
  }

  revalidatePath("/");
  revalidatePath("/materiales");
  revalidatePath(`/materiales/${materialId}`);
  return { ok: true };
}
