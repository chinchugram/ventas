"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { esquemaConfiguracion, esquemaMaquina, type DatosConfiguracion, type DatosMaquina } from "@/lib/configuracion";
import {
  cambiarActivoMaquinaEnTx,
  crearMaquinaEnTx,
  editarMaquinaEnTx,
  guardarConfiguracionEnTx,
} from "@/lib/dominio/configuracion";

/**
 * Guarda nombre, costo/hora de mano de obra, IVA y margen objetivo.
 *
 * Revalida todo el sitio: el nombre va en el encabezado de cada pantalla y el
 * costo/hora cambia costos y margenes del catalogo, el tablero y los reportes.
 * Las ventas ya hechas no cambian: guardan su costo congelado.
 */
export async function guardarConfiguracion(datos: DatosConfiguracion): Promise<Resultado> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  const parsed = esquemaConfiguracion.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => guardarConfiguracionEnTx(tx, parsed.data));
  } catch (error) {
    console.error("[guardarConfiguracion]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la configuración.") };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// ─── Maquinas ─────────────────────────────────────────────────────────────────
// Cambiar una maquina cambia el costo de las recetas que la usan: tambien se
// revalida todo el sitio.

export async function crearMaquina(datos: DatosMaquina): Promise<Resultado> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  const parsed = esquemaMaquina.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => crearMaquinaEnTx(tx, parsed.data));
  } catch (error) {
    console.error("[crearMaquina]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la máquina.") };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

const idMaquina = z.uuid("Máquina inválida");

export async function editarMaquina(datos: DatosMaquina & { id: string }): Promise<Resultado> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  const id = idMaquina.safeParse(datos.id);
  if (!id.success) return { ok: false, error: primerError(id.error) };
  const parsed = esquemaMaquina.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => editarMaquinaEnTx(tx, id.data, parsed.data));
  } catch (error) {
    console.error("[editarMaquina]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la máquina.") };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export type ResultadoActivo = { ok: true; recetas: number } | { ok: false; error: string };

/**
 * Baja logica (`activo = false`) o reactivacion. Una maquina de baja que sigue
 * en recetas no se impide: esas recetas la siguen costeando con su costo/hora,
 * y se devuelve cuantas son para avisar.
 */
export async function cambiarActivoMaquina(datos: { id: string; activo: boolean }): Promise<ResultadoActivo> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ id: idMaquina, activo: z.boolean() }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  let recetas: number;
  try {
    ({ recetas } = await prisma.$transaction((tx) =>
      cambiarActivoMaquinaEnTx(tx, parsed.data.id, parsed.data.activo),
    ));
  } catch (error) {
    console.error("[cambiarActivoMaquina]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo actualizar la máquina.") };
  }

  revalidatePath("/", "layout");
  return { ok: true, recetas };
}
