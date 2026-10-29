"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { validarArticulo, type DatosArticulo } from "@/lib/recetas";
import { cambiarActivoArticuloEnTx, guardarArticuloEnTx } from "@/lib/dominio/articulos";

/** Pantallas que muestran costo, precio o margen de los articulos. */
function revalidarCatalogo(id: string) {
  for (const ruta of ["/", "/catalogo", `/catalogo/${id}`, "/ventas/nueva", "/reportes"]) revalidatePath(ruta);
}

/**
 * Alta o edicion de un articulo con su receta. El cliente manda texto; aca se
 * valida todo de nuevo y la transaccion controla materiales y maquinas.
 */
export async function guardarArticulo(
  datos: DatosArticulo,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("editarCatalogo");
  if (!permiso.ok) return permiso;
  // Primero la base: en modo demostracion los ids de ejemplo no son uuid y el
  // usuario veria un error de validacion en vez del aviso de que no se guarda.
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const validado = validarArticulo(datos);
  if (!validado.ok) return validado;

  try {
    const { id } = await prisma.$transaction((tx) => guardarArticuloEnTx(tx, validado.valor));
    revalidarCatalogo(id);
    return { ok: true, id };
  } catch (error) {
    console.error("[guardarArticulo]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el artículo.") };
  }
}

const esquemaActivo = z.object({ id: z.uuid("Artículo inválido"), activo: z.boolean() });

/** Baja logica (`activo = false`) o reactivacion de un articulo. */
export async function cambiarActivoArticulo(datos: z.input<typeof esquemaActivo>): Promise<Resultado> {
  const permiso = await verificarPermiso("editarCatalogo");
  if (!permiso.ok) return permiso;
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const parsed = esquemaActivo.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };

  const { id, activo } = parsed.data;
  try {
    await prisma.$transaction((tx) => cambiarActivoArticuloEnTx(tx, id, activo));
  } catch (error) {
    console.error("[cambiarActivoArticulo]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo cambiar el estado del artículo.") };
  }

  revalidarCatalogo(id);
  return { ok: true };
}
