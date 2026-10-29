"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { idParaGuardar } from "@/lib/auth";
import { d } from "@/lib/money";
import { esDecimal, mensajeDeError, normalizarDecimal, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import {
  cambiarActivoListaEnTx,
  crearListaEnTx,
  editarListaEnTx,
  guardarPrecioListaEnTx,
  quitarPrecioListaEnTx,
} from "@/lib/dominio/listas-precios";

export type { Resultado } from "@/lib/acciones";

/** Numero con a lo sumo 2 decimales (la coma vale), entre 0 y `max`. Devuelve texto normalizado con punto. */
const numeroAcotado = (max: number, mensaje: string) =>
  z
    .string()
    .trim()
    .refine((v) => esDecimal(v) && /^\d+([.,]\d{1,2})?$/.test(v) && d(normalizarDecimal(v)).lte(max), mensaje)
    .transform(normalizarDecimal);

const esquemaLista = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre de la lista").max(80, "Máximo 80 caracteres"),
  descuentoPct: numeroAcotado(100, "El descuento tiene que ser un número entre 0 y 100 (hasta 2 decimales)"),
});

export type DatosLista = z.input<typeof esquemaLista>;

const idLista = z.uuid("Lista inválida");
const idArticulo = z.uuid("Artículo inválido");

const esquemaPrecio = z.object({
  listaId: idLista,
  articuloId: idArticulo,
  precio: numeroAcotado(999_999_999, "El precio tiene que ser un número de 0 en adelante (hasta 2 decimales)"),
});

export type DatosPrecioLista = z.input<typeof esquemaPrecio>;

/** Choque con el indice unico del nombre (dos altas a la vez con el mismo nombre). */
function esNombreDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidarListas(id?: string) {
  revalidatePath("/listas-precios");
  if (id) revalidatePath(`/listas-precios/${id}`);
  // Los precios de lista se usan al cargar una venta y se muestran en la ficha del cliente.
  for (const ruta of ["/ventas/nueva", "/clientes"]) revalidatePath(ruta);
}

export async function crearLista(datos: DatosLista): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("gestionarListasPrecios");
  if (!permiso.ok) return permiso;
  const parsed = esquemaLista.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const usuarioId = idParaGuardar(permiso.usuario);

  let id: string;
  try {
    ({ id } = await prisma.$transaction((tx) =>
      crearListaEnTx(tx, { nombre: parsed.data.nombre, descuentoPct: d(parsed.data.descuentoPct) }, usuarioId),
    ));
  } catch (error) {
    if (esNombreDuplicado(error)) return { ok: false, error: "Ya hay una lista con ese nombre." };
    console.error("[crearLista]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la lista.") };
  }

  revalidarListas(id);
  return { ok: true, id };
}

export async function editarLista(datos: DatosLista & { id: string }): Promise<Resultado> {
  const permiso = await verificarPermiso("gestionarListasPrecios");
  if (!permiso.ok) return permiso;
  const id = idLista.safeParse(datos.id);
  if (!id.success) return { ok: false, error: primerError(id.error) };
  const parsed = esquemaLista.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) =>
      editarListaEnTx(tx, id.data, { nombre: parsed.data.nombre, descuentoPct: d(parsed.data.descuentoPct) }),
    );
  } catch (error) {
    if (esNombreDuplicado(error)) return { ok: false, error: "Ya hay una lista con ese nombre." };
    console.error("[editarLista]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la lista.") };
  }

  revalidarListas(id.data);
  return { ok: true };
}

/** Baja logica (`activo: false`) o reactivacion. */
export async function cambiarActivoLista(datos: { id: string; activo: boolean }): Promise<Resultado> {
  const permiso = await verificarPermiso("gestionarListasPrecios");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ id: idLista, activo: z.boolean() }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => cambiarActivoListaEnTx(tx, parsed.data.id, parsed.data.activo));
  } catch (error) {
    console.error("[cambiarActivoLista]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo actualizar la lista.") };
  }

  revalidarListas(parsed.data.id);
  return { ok: true };
}

/** Alta o edicion del precio especifico de un articulo en la lista. */
export async function guardarPrecioLista(datos: DatosPrecioLista): Promise<Resultado> {
  const permiso = await verificarPermiso("gestionarListasPrecios");
  if (!permiso.ok) return permiso;
  const parsed = esquemaPrecio.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const { listaId, articuloId, precio } = parsed.data;
  try {
    await prisma.$transaction((tx) => guardarPrecioListaEnTx(tx, listaId, articuloId, d(precio)));
  } catch (error) {
    console.error("[guardarPrecioLista]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el precio.") };
  }

  revalidarListas(listaId);
  return { ok: true };
}

/** Quita el precio especifico: el articulo vuelve al descuento general o al catalogo. */
export async function quitarPrecioLista(datos: { listaId: string; articuloId: string }): Promise<Resultado> {
  const permiso = await verificarPermiso("gestionarListasPrecios");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ listaId: idLista, articuloId: idArticulo }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => quitarPrecioListaEnTx(tx, parsed.data.listaId, parsed.data.articuloId));
  } catch (error) {
    console.error("[quitarPrecioLista]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo quitar el precio.") };
  }

  revalidarListas(parsed.data.listaId);
  return { ok: true };
}
