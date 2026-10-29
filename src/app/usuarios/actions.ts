"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { dbDisponible, prisma } from "@/lib/prisma";
import { ErrorDeNegocio, mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { CLAVE_MAX } from "@/lib/auth-pura";
import { COOKIE_SESION, opcionesCookieSesion, usuarioParaAccion } from "@/lib/auth";
import { verificarPermiso } from "@/lib/permisos";
import {
  cambiarActivoUsuarioEnTx,
  cambiarClavePropia,
  cambiarRolUsuarioEnTx,
  crearUsuarioComoDuenoEnTx,
  resetearClaveUsuarioEnTx,
} from "@/lib/dominio/usuarios";

export type { Resultado } from "@/lib/acciones";

// Administracion de usuarios. Todas, salvo `cambiarMiClave`, son solo del dueno:
// la primera linea es `verificarPermiso("gestionarUsuarios")` y la logica (con su
// propio chequeo de permiso) vive en `src/lib/dominio/usuarios.ts`. El rol y el
// id se validan aca antes de tocar la base: roles fuera del enum e ids que no
// son UUID no pasan. Ver docs/seguridad-ola-4-auth.md.

const idUsuario = z.uuid("Usuario inválido");
const rol = z.enum(["DUENO", "EMPLEADO"], "Elegí un rol válido: dueño o empleado.");
// Topes de largo antes de tocar la base o scrypt (la validacion fina esta en el dominio).
const claveTipeada = z.string().max(CLAVE_MAX * 2, "La clave es demasiado larga.");

const esquemaAlta = z.object({
  usuario: z.string().trim().min(1, "Falta el usuario").max(60, "El usuario es demasiado largo"),
  nombre: z.string().trim().min(1, "Falta el nombre").max(80, "Máximo 80 caracteres"),
  rol,
  clave: claveTipeada,
});

/** `rol` llega como texto: el servidor lo valida contra el enum. */
export type DatosAltaUsuario = { usuario: string; nombre: string; rol: string; clave: string };

/** Loguea lo inesperado; un `ErrorDeNegocio` (clave actual mal, ultimo dueno...) es una respuesta normal y no ensucia el log. */
function fallo(etiqueta: string, error: unknown, generico: string): { ok: false; error: string } {
  if (!(error instanceof ErrorDeNegocio)) console.error(`[${etiqueta}]`, error);
  return { ok: false, error: mensajeDeError(error, generico) };
}

function esDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidarUsuarios(id?: string) {
  revalidatePath("/usuarios");
  if (id) revalidatePath(`/usuarios/${id}`);
}

export async function crearUsuario(datos: DatosAltaUsuario): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("gestionarUsuarios");
  if (!permiso.ok) return permiso;
  const parsed = esquemaAlta.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  let id: string;
  try {
    ({ id } = await prisma.$transaction((tx) => crearUsuarioComoDuenoEnTx(tx, permiso.usuario, parsed.data)));
  } catch (error) {
    if (esDuplicado(error)) return { ok: false, error: "Ya existe un usuario con ese nombre de usuario." };
    return fallo("crearUsuario", error, "No se pudo crear el usuario.");
  }

  revalidarUsuarios(id);
  return { ok: true, id };
}

/** Baja logica (`activo: false`: cierra sus sesiones) o reactivacion (`activo: true`). */
export async function cambiarActivoUsuario(datos: { id: string; activo: boolean }): Promise<Resultado> {
  const permiso = await verificarPermiso("gestionarUsuarios");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ id: idUsuario, activo: z.boolean() }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => cambiarActivoUsuarioEnTx(tx, permiso.usuario, parsed.data.id, parsed.data.activo));
  } catch (error) {
    return fallo("cambiarActivoUsuario", error, "No se pudo actualizar el usuario.");
  }

  revalidarUsuarios(parsed.data.id);
  return { ok: true };
}

/** Cambia el rol y cierra las sesiones de ese usuario. */
export async function cambiarRolUsuario(datos: { id: string; rol: string }): Promise<Resultado> {
  const permiso = await verificarPermiso("gestionarUsuarios");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ id: idUsuario, rol }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => cambiarRolUsuarioEnTx(tx, permiso.usuario, parsed.data.id, parsed.data.rol));
  } catch (error) {
    return fallo("cambiarRolUsuario", error, "No se pudo cambiar el rol.");
  }

  revalidarUsuarios(parsed.data.id);
  return { ok: true };
}

/** El dueno le pone una clave nueva a otro usuario (cierra sus sesiones y limpia su pausa). */
export async function resetearClaveUsuario(datos: { id: string; clave: string }): Promise<Resultado> {
  const permiso = await verificarPermiso("gestionarUsuarios");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ id: idUsuario, clave: claveTipeada }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => resetearClaveUsuarioEnTx(tx, permiso.usuario, parsed.data.id, parsed.data.clave));
  } catch (error) {
    return fallo("resetearClaveUsuario", error, "No se pudo cambiar la clave.");
  }

  revalidarUsuarios(parsed.data.id);
  return { ok: true };
}

/**
 * Cambia la clave de quien tiene la sesion abierta (cualquier rol, por eso solo
 * exige sesion y no `gestionarUsuarios`). Pide la actual, con la misma pausa
 * por intentos fallidos que el login. Cierra todas las sesiones del usuario y
 * deja abierta una nueva en este navegador (token nuevo, cookie repuesta).
 */
export async function cambiarMiClave(datos: { actual: string; nueva: string; repetir: string }): Promise<Resultado> {
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const parsed = z.object({ actual: claveTipeada, nueva: claveTipeada, repetir: claveTipeada }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    // `prisma` y no una transaccion: la verificacion de la clave actual tiene que
    // dejar anotado el intento fallido aunque la operacion termine en error.
    const nueva = await cambiarClavePropia(prisma, sesion.usuario, parsed.data);
    (await cookies()).set(COOKIE_SESION, nueva.token, opcionesCookieSesion(nueva.expiraEn));
  } catch (error) {
    return fallo("cambiarMiClave", error, "No se pudo cambiar la clave.");
  }
  return { ok: true };
}
