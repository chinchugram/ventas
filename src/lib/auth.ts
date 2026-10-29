import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dbDisponible, prisma } from "@/lib/prisma";
import { resolverSesion } from "@/lib/dominio/auth";
import { nombreCookie, opcionesCookie, type UsuarioSesion } from "@/lib/auth-pura";

// Capa de Next sobre el nucleo de `src/lib/dominio/auth.ts`: cookie, cache por
// pedido y redirecciones. Solo se importa desde codigo de servidor (paginas,
// layouts, server actions, route handlers). Ver docs/seguridad-ola-4-auth.md.

export type { Rol, UsuarioSesion } from "@/lib/auth-pura";

const PRODUCCION = process.env.NODE_ENV === "production";

export const COOKIE_SESION = nombreCookie(PRODUCCION);

export function opcionesCookieSesion(expiraEn: Date) {
  return opcionesCookie(expiraEn, PRODUCCION);
}

const ID_DEMO = "00000000-0000-0000-0000-000000000000";

/** Usuario simulado del modo demo: solo en desarrollo y solo si no hay base. */
const DEMO: UsuarioSesion = { id: ID_DEMO, usuario: "demo", nombre: "Demo", rol: "DUENO" };

/**
 * El id para guardar en `usuarioId` (ventas, pagos, compras, movimientos): el del
 * usuario, o `null` si es el demo, que no existe en la tabla `usuarios`.
 */
export function idParaGuardar(usuario: UsuarioSesion): string | null {
  return usuario.id === ID_DEMO ? null : usuario.id;
}

async function demoSiNoHayBase(): Promise<UsuarioSesion | null> {
  if (PRODUCCION) return null;
  return (await dbDisponible()) ? null : DEMO;
}

/**
 * El usuario de este pedido, o `null`. Lee la cookie y consulta la base cada vez
 * (la cookie sola no prueba nada): la sesion tiene que existir, no estar vencida
 * y su usuario tiene que estar activo. Cacheado por pedido con `cache` de React.
 *
 * Sin base: en desarrollo devuelve un DUENO simulado ("Demo"); en produccion
 * devuelve `null` (y el proxy ya respondio 503).
 *
 * Devuelve solo `{ id, usuario, nombre, rol }`: nunca el hash ni datos de la sesion.
 */
export const usuarioActual = cache(async (): Promise<UsuarioSesion | null> => {
  const token = (await cookies()).get(COOKIE_SESION)?.value;
  if (!token) return demoSiNoHayBase();
  try {
    // Sin renovar: un Server Component no puede reenviar la cookie. Renueva el proxy.
    return (await resolverSesion(prisma, token))?.usuario ?? null;
  } catch (error) {
    const demo = await demoSiNoHayBase();
    if (!demo) console.error("[auth] No se pudo verificar la sesion:", error);
    return demo;
  }
});

/**
 * Para paginas y layouts: el usuario, o redirige a /login. Cada pagina con datos
 * lo llama (o llama a `requierePermiso`): el layout raiz no alcanza porque no se
 * vuelve a ejecutar en las navegaciones del cliente.
 */
export async function requiereUsuario(): Promise<UsuarioSesion> {
  const usuario = await usuarioActual();
  if (!usuario) redirect("/login");
  return usuario;
}

export const SIN_SESION = "Tu sesión terminó. Volvé a entrar para seguir.";

/**
 * Para server actions, que devuelven `{ ok, error }` en vez de redirigir:
 *
 *   const sesion = await usuarioParaAccion();
 *   if (!sesion.ok) return sesion;
 *   const { usuario } = sesion;
 */
export async function usuarioParaAccion(): Promise<{ ok: true; usuario: UsuarioSesion } | { ok: false; error: string }> {
  const usuario = await usuarioActual();
  return usuario ? { ok: true, usuario } : { ok: false, error: SIN_SESION };
}
