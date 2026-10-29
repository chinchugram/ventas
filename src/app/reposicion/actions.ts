"use server";

import { revalidatePath } from "next/cache";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { CLAVE_FACTOR, esquemaFactor } from "@/lib/reposicion";

/**
 * Guarda el factor de reposicion (`minimo × factor` es hasta donde se sugiere
 * comprar). Upsert: la clave no existe hasta la primera vez que se guarda.
 */
export async function guardarFactorReposicion(datos: { factor: string }): Promise<Resultado> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  const parsed = esquemaFactor.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const valor = parsed.data.factor;
  try {
    await prisma.configuracion.upsert({
      where: { clave: CLAVE_FACTOR },
      update: { valor },
      create: { clave: CLAVE_FACTOR, valor },
    });
  } catch (error) {
    console.error("[guardarFactorReposicion]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el factor.") };
  }

  revalidatePath("/reposicion");
  return { ok: true };
}
