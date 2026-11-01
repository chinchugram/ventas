"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { dbDisponible } from "@/lib/prisma";
import { conSuperadmin } from "@/lib/negocio";
import { ErrorDeNegocio, mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { verificarPermiso } from "@/lib/permisos";
import {
  cambiarActivoNegocioEnTx,
  crearNegocioEnTx,
  crearPrimerDuenoEnTx,
  esquemaNegocioNuevo,
  esquemaPrimerDueno,
  idNegocio,
  nuevoIdDeNegocio,
} from "@/lib/dominio/negocios";

export type { Resultado } from "@/lib/acciones";

// Administracion de negocios: solo el SUPERADMIN (`administrarNegocios`). La primera linea de cada accion
// es la verificacion del permiso, antes de leer o validar nada. El SUPERADMIN no tiene negocio: el contexto
// de cada accion es `conSuperadmin` (ve solo cuentas sin negocio y puede escribir `negocios`); para el alta de
// un negocio nuevo y de su primer dueno declara ademas ese negocio (recien creado o validado contra
// `negocios`), nunca un id que mande el cliente sin comprobar.

/** Loguea lo inesperado; un `ErrorDeNegocio` es una respuesta normal y no ensucia el log. */
function fallo(etiqueta: string, error: unknown, generico: string): { ok: false; error: string } {
  if (!(error instanceof ErrorDeNegocio)) console.error(`[${etiqueta}]`, error);
  return { ok: false, error: mensajeDeError(error, generico) };
}

function esDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** `slug` llega como texto: el servidor lo normaliza y valida. */
export type DatosNegocioForm = { nombre: string; slug: string };

export async function crearNegocio(datos: DatosNegocioForm): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("administrarNegocios");
  if (!permiso.ok) return permiso;
  const parsed = esquemaNegocioNuevo.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const id = nuevoIdDeNegocio();
  try {
    await conSuperadmin((tx) => crearNegocioEnTx(tx, id, parsed.data), { negocioId: id });
  } catch (error) {
    if (esDuplicado(error)) return { ok: false, error: `Ya existe un negocio con el identificador «${parsed.data.slug}».` };
    return fallo("crearNegocio", error, "No se pudo crear el negocio.");
  }

  revalidatePath("/admin/negocios");
  return { ok: true, id };
}

export type DatosPrimerDuenoForm = { negocioId: string; usuario: string; nombre: string; clave: string };

/** Primer dueno de un negocio (usuario + clave inicial que tiene que cambiar al entrar). */
export async function crearPrimerDueno(datos: DatosPrimerDuenoForm): Promise<Resultado> {
  const permiso = await verificarPermiso("administrarNegocios");
  if (!permiso.ok) return permiso;
  const parsed = esquemaPrimerDueno.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    // El negocio se declara en el contexto recien aca, con el id ya validado como UUID; `crearPrimerDuenoEnTx`
    // comprueba que exista antes de escribir nada (RLS no deja escribir en un negocio que no existe).
    await conSuperadmin((tx) => crearPrimerDuenoEnTx(tx, parsed.data), { negocioId: parsed.data.negocioId });
  } catch (error) {
    if (esDuplicado(error)) return { ok: false, error: "Ya existe un usuario con ese nombre de usuario." };
    return fallo("crearPrimerDueno", error, "No se pudo crear el dueño.");
  }

  revalidatePath("/admin/negocios");
  return { ok: true };
}

/** Baja logica (`activo: false`: nadie del negocio puede entrar) o reactivacion. Nunca se borra. */
export async function cambiarActivoNegocio(datos: { id: string; activo: boolean }): Promise<Resultado> {
  const permiso = await verificarPermiso("administrarNegocios");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ id: idNegocio, activo: z.boolean() }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await conSuperadmin((tx) => cambiarActivoNegocioEnTx(tx, parsed.data.id, parsed.data.activo));
  } catch (error) {
    return fallo("cambiarActivoNegocio", error, "No se pudo actualizar el negocio.");
  }

  revalidatePath("/admin/negocios");
  return { ok: true };
}
