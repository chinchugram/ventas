"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { d } from "@/lib/money";
import {
  decimalNoNegativo,
  mensajeDeError,
  primerError,
  SIN_BASE,
  textoOpcional,
  type Resultado,
} from "@/lib/acciones";
import { UNIDADES } from "@/lib/materiales";
import { cambiarEstadoMaterialEnTx, crearMaterialEnTx, editarMaterialEnTx } from "@/lib/dominio/materiales";

// Alta, edicion y baja logica de materiales. El stock no se edita aca: solo
// cambia por compras, ventas y ajustes (el alta deja su "Stock inicial").

// decimal(14,3) deja 11 digitos enteros: mil millones sobra para un comercio.
const TOPE = "1000000000";

/** 0 o mas, y que entre en las columnas decimal(14, x) de la base. */
const montoValido = decimalNoNegativo.refine((v) => d(v).lt(TOPE), "El número es demasiado grande");

/** Nombre de cada campo, para que el error diga cual esta mal. */
const ETIQUETAS: Record<string, string> = {
  stockInicial: "Stock inicial",
  stockMinimo: "Stock mínimo",
  costoUnitario: "Costo unitario",
  precioVenta: "Precio de venta",
};

function errorDeCampo(error: z.ZodError): string {
  const campo = ETIQUETAS[String(error.issues[0]?.path[0])];
  return campo ? `${campo}: ${primerError(error)}` : primerError(error);
}

/** Precio de venta opcional: vacio = solo insumo. */
const precioOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(montoValido.nullable());

const camposComunes = {
  nombre: z.string().trim().min(1, "Falta el nombre").max(120, "Máximo 120 caracteres"),
  unidad: z.string().pipe(z.enum(UNIDADES, "Elegí una unidad")),
  stockMinimo: montoValido,
  costoUnitario: montoValido,
  precioVenta: precioOpcional,
  notas: textoOpcional(500),
};

const esquemaAlta = z.object({ ...camposComunes, stockInicial: montoValido });

const esquemaEdicion = z.object({
  ...camposComunes,
  id: z.uuid("Material inválido"),
  costoOriginal: decimalNoNegativo,
});

const esquemaEstado = z.object({ id: z.uuid("Material inválido"), activo: z.boolean() });

export type DatosMaterialNuevo = z.input<typeof esquemaAlta>;
export type DatosMaterialEditado = z.input<typeof esquemaEdicion>;

function revalidarMateriales(id?: string) {
  // Inicio (alertas), compras (selector), catalogo (costos de receta) y reportes.
  for (const ruta of ["/", "/materiales", "/compras/nueva", "/catalogo", "/reportes"]) revalidatePath(ruta);
  if (id) {
    revalidatePath(`/materiales/${id}`);
    revalidatePath(`/materiales/${id}/editar`);
  }
}

export async function crearMaterial(
  datos: DatosMaterialNuevo,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = esquemaAlta.safeParse(datos);
  if (!parsed.success) return { ok: false, error: errorDeCampo(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const m = parsed.data;
  let id: string;
  try {
    ({ id } = await prisma.$transaction((tx) =>
      crearMaterialEnTx(tx, {
        nombre: m.nombre,
        unidad: m.unidad,
        stockInicial: d(m.stockInicial),
        stockMinimo: d(m.stockMinimo),
        costoUnitario: d(m.costoUnitario),
        precioVenta: m.precioVenta === null ? null : d(m.precioVenta),
        notas: m.notas,
      }),
    ));
  } catch (error) {
    console.error("[crearMaterial]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el material.") };
  }

  revalidarMateriales();
  return { ok: true, id };
}

export async function editarMaterial(datos: DatosMaterialEditado): Promise<Resultado> {
  const parsed = esquemaEdicion.safeParse(datos);
  if (!parsed.success) return { ok: false, error: errorDeCampo(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const m = parsed.data;
  try {
    await prisma.$transaction((tx) =>
      editarMaterialEnTx(tx, {
        id: m.id,
        nombre: m.nombre,
        unidad: m.unidad,
        stockMinimo: d(m.stockMinimo),
        costoUnitario: d(m.costoUnitario),
        costoOriginal: d(m.costoOriginal),
        precioVenta: m.precioVenta === null ? null : d(m.precioVenta),
        notas: m.notas,
      }),
    );
  } catch (error) {
    console.error("[editarMaterial]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el material.") };
  }

  revalidarMateriales(m.id);
  return { ok: true };
}

/** Baja logica (`activo = false`) o reactivacion. */
export async function cambiarEstadoMaterial(datos: z.input<typeof esquemaEstado>): Promise<Resultado> {
  const parsed = esquemaEstado.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const { id, activo } = parsed.data;
  try {
    await prisma.$transaction((tx) => cambiarEstadoMaterialEnTx(tx, id, activo));
  } catch (error) {
    console.error("[cambiarEstadoMaterial]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo cambiar el estado del material.") };
  }

  revalidarMateriales(id);
  return { ok: true };
}
