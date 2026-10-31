"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { dbDisponible, prisma } from "@/lib/prisma";
import { SIN_BASE } from "@/lib/acciones";
import { CLAVE_MAX, destinoSeguro, ERROR_LOGIN, inicioDeRol } from "@/lib/auth-pura";
import { cerrarSesion, iniciarSesion } from "@/lib/dominio/auth";
import { COOKIE_SESION, opcionesCookieSesion } from "@/lib/auth";

// Entrada y salida. Las dos son server actions: Next solo las acepta por POST y
// compara el Origin con el Host, asi que otro sitio no puede dispararlas (CSRF);
// ademas la cookie es sameSite=lax. Ver docs/seguridad-ola-4-auth.md.

export type EstadoLogin = { error: string | null; negocio: string; usuario: string };

// Topes de largo antes de tocar la base o scrypt. Lo que no pasa recibe el mismo
// mensaje generico que una clave incorrecta (tampoco dice si el negocio existe).
const esquemaLogin = z.object({
  negocio: z.string().trim().min(1).max(60),
  usuario: z.string().trim().min(1).max(100),
  clave: z.string().min(1).max(CLAVE_MAX * 2),
  siguiente: z.string().max(1000).optional(),
});

export async function entrar(_previo: EstadoLogin, formData: FormData): Promise<EstadoLogin> {
  const datos = esquemaLogin.safeParse({
    negocio: formData.get("negocio"),
    usuario: formData.get("usuario"),
    clave: formData.get("clave"),
    siguiente: formData.get("siguiente") ?? undefined,
  });
  const usuarioTipeado = typeof formData.get("usuario") === "string" ? String(formData.get("usuario")).slice(0, 100) : "";
  const negocioTipeado = typeof formData.get("negocio") === "string" ? String(formData.get("negocio")).slice(0, 60) : "";
  const previo = { negocio: negocioTipeado, usuario: usuarioTipeado };
  if (!datos.success) return { error: ERROR_LOGIN, ...previo };
  if (!(await dbDisponible())) return { error: SIN_BASE, ...previo };

  const almacen = await cookies();
  let destino: string;
  try {
    // El negocio (slug) solo elige DONDE se busca el usuario; la sesion queda atada al
    // negocio que resolvio el servidor y de ahi en adelante sale de la sesion.
    const resultado = await iniciarSesion(prisma, datos.data.negocio, datos.data.usuario, datos.data.clave);
    if (!resultado.ok) return { error: ERROR_LOGIN, ...previo };

    // Si el navegador traia otra sesion, se cierra: cada login estrena token.
    await cerrarSesion(prisma, almacen.get(COOKIE_SESION)?.value);
    almacen.set(COOKIE_SESION, resultado.valorCookie, opcionesCookieSesion(resultado.expiraEn));
    destino = destinoSeguro(datos.data.siguiente) ?? inicioDeRol(resultado.usuario.rol);
  } catch (error) {
    console.error("[entrar]", error);
    return { error: "No se pudo iniciar sesión. Probá de nuevo en un momento.", ...previo };
  }
  redirect(destino);
}

/** Cierra la sesion: borra la fila en la base y la cookie. Siempre termina en /login. */
export async function salir(): Promise<void> {
  const almacen = await cookies();
  const valorCookie = almacen.get(COOKIE_SESION)?.value;
  try {
    if (valorCookie && (await dbDisponible())) await cerrarSesion(prisma, valorCookie);
  } catch (error) {
    console.error("[salir]", error);
  }
  almacen.set(COOKIE_SESION, "", { ...opcionesCookieSesion(new Date()), maxAge: 0 });
  redirect("/login");
}
