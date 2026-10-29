"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { aCosto, d } from "@/lib/money";
import { subtotalCompra, totalizarCompra } from "@/lib/stock";

export type Resultado = { ok: true } | { ok: false; error: string };

const SIN_BASE = "No hay base de datos conectada: esta pantalla está en modo demostración y no guarda.";

const decimalPositivo = z
  .string()
  .trim()
  .refine((v) => /^\d+([.,]\d+)?$/.test(v) && Number(v.replace(",", ".")) > 0, "Debe ser un número mayor a 0");

const decimalNoNegativo = z
  .string()
  .trim()
  .refine((v) => /^\d+([.,]\d+)?$/.test(v), "Debe ser un número válido");

const esquemaCompra = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  proveedor: z.string().trim().min(1, "Falta el proveedor").max(120),
  comprobante: z.string().trim().max(60).optional(),
  notas: z.string().trim().max(500).optional(),
  actualizarCosto: z.boolean(),
  items: z
    .array(
      z.object({
        materialId: z.uuid("Material inválido"),
        cantidad: decimalPositivo,
        costoUnitario: decimalNoNegativo,
      }),
    )
    .min(1, "Agregá al menos un material"),
});

export type DatosCompra = z.input<typeof esquemaCompra>;

const normalizar = (v: string) => v.replace(",", ".");

/**
 * Registra una compra: guarda la cabecera y las lineas, suma el stock de cada
 * material y deja un movimiento por linea. Todo en una transaccion: o entra la
 * compra completa o no entra nada.
 *
 * Con `actualizarCosto`, el costo del material pasa a ser el de esta compra (el
 * ultimo precio pagado), que es lo que cuesta reponerlo hoy. Las recetas se
 * recalculan solas; las ventas ya hechas conservan su costo congelado.
 */
export async function registrarCompra(datos: DatosCompra): Promise<Resultado> {
  const parsed = esquemaCompra.safeParse(datos);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const { fecha, proveedor, comprobante, notas, actualizarCosto, items } = parsed.data;
  const lineas = items.map((i) => ({
    materialId: i.materialId,
    cantidad: normalizar(i.cantidad),
    costoUnitario: normalizar(i.costoUnitario),
  }));

  try {
    await prisma.$transaction(async (tx) => {
      const ids = [...new Set(lineas.map((l) => l.materialId))];
      const activos = await tx.material.count({ where: { id: { in: ids }, activo: true } });
      if (activos !== ids.length) throw new Error("Algún material ya no existe o está dado de baja.");

      const compra = await tx.compra.create({
        data: {
          fecha: new Date(`${fecha}T00:00:00Z`),
          proveedor,
          comprobante: comprobante || null,
          notas: notas || null,
          total: totalizarCompra(lineas),
          items: {
            create: lineas.map((l) => ({
              materialId: l.materialId,
              cantidad: d(l.cantidad),
              costoUnitario: aCosto(d(l.costoUnitario)),
              subtotal: subtotalCompra(l.cantidad, l.costoUnitario),
            })),
          },
        },
      });

      for (const l of lineas) {
        const material = await tx.material.update({
          where: { id: l.materialId },
          data: {
            stockActual: { increment: d(l.cantidad) },
            ...(actualizarCosto ? { costoUnitario: aCosto(d(l.costoUnitario)) } : {}),
          },
          select: { stockActual: true },
        });
        await tx.movimientoStock.create({
          data: {
            materialId: l.materialId,
            tipo: "COMPRA",
            cantidad: d(l.cantidad),
            stockResultante: material.stockActual,
            motivo: `Compra a ${proveedor}`,
            compraId: compra.id,
          },
        });
      }
    });
  } catch (error) {
    console.error("[registrarCompra]", error);
    return { ok: false, error: error instanceof Error && error.message.startsWith("Algún") ? error.message : "No se pudo guardar la compra." };
  }

  revalidatePath("/");
  revalidatePath("/compras");
  revalidatePath("/materiales");
  return { ok: true };
}
