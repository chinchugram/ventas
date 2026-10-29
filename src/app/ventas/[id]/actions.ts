"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { anularVentaEnTx } from "@/lib/dominio/ventas";
import { revalidarVentas } from "@/lib/revalidar";

const esquema = z.object({ ventaId: z.uuid("Venta inválida") });

/** Anula una venta (queda ANULADA, no se borra) y devuelve el stock que salio. */
export async function anularVenta(datos: z.input<typeof esquema>): Promise<Resultado> {
  const parsed = esquema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const { ventaId } = parsed.data;

  try {
    await prisma.$transaction((tx) => anularVentaEnTx(tx, ventaId));
  } catch (error) {
    console.error("[anularVenta]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo anular la venta.") };
  }

  revalidarVentas();
  revalidatePath(`/ventas/${ventaId}`);
  return { ok: true };
}
