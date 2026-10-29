"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { d } from "@/lib/money";
import { decimalNoNegativo, mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { idParaGuardar, usuarioParaAccion } from "@/lib/auth";
import { ajustarStockEnTx } from "@/lib/dominio/stock";

const esquema = z.object({
  materialId: z.uuid("Material inválido"),
  stockContado: decimalNoNegativo,
  motivo: z.string().trim().min(1, "Contá por qué ajustás (rotura, merma, conteo…)").max(200),
});

/** Ajuste por conteo fisico: registra la diferencia como un movimiento. */
export async function ajustarStock(datos: z.input<typeof esquema>): Promise<Resultado> {
  const parsed = esquema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const { materialId, motivo } = parsed.data;
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const usuarioId = idParaGuardar(sesion.usuario);
  try {
    await prisma.$transaction((tx) =>
      ajustarStockEnTx(tx, { materialId, motivo, usuarioId, stockContado: d(parsed.data.stockContado) }),
    );
  } catch (error) {
    console.error("[ajustarStock]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo ajustar el stock.") };
  }

  revalidatePath("/");
  revalidatePath("/materiales");
  revalidatePath(`/materiales/${materialId}`);
  return { ok: true };
}
