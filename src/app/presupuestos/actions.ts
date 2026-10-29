"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { d } from "@/lib/money";
import {
  esDecimal,
  hoyArgentina,
  mensajeDeError,
  normalizarDecimal,
  primerError,
  SIN_BASE,
  textoOpcional,
  type Resultado,
} from "@/lib/acciones";
import {
  anularPresupuestoEnTx,
  convertirPresupuestoEnTx,
  crearPresupuestoEnTx,
  duplicarPresupuestoEnTx,
  editarPresupuestoEnTx,
} from "@/lib/dominio/presupuestos";
import { problemaDeCantidad, VALIDEZ_MAXIMA } from "@/lib/presupuestos";
import { revalidarVentas } from "@/lib/revalidar";

// Del formulario solo llega QUE articulo, CUANTO, a QUIEN y la validez: el
// precio, la descripcion y el IVA los pone el servidor (`resolverPrecio`).

const cantidad = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const problema = esDecimal(v)
      ? problemaDeCantidad(d(normalizarDecimal(v)))
      : "La cantidad tiene que ser un número (por ejemplo 2 o 1,5).";
    if (problema) ctx.addIssue({ code: "custom", message: problema });
  })
  .transform(normalizarDecimal);

const validezDias = z
  .string()
  .trim()
  .regex(/^\d+$/, "La validez son días enteros")
  .transform(Number)
  .refine((n) => n >= 1 && n <= VALIDEZ_MAXIMA, `La validez tiene que ser de 1 a ${VALIDEZ_MAXIMA} días`);

const esquemaPresupuesto = z.object({
  clienteId: z.uuid("Elegí un cliente"),
  validezDias,
  observaciones: textoOpcional(500),
  items: z
    .array(z.object({ articuloId: z.uuid("Artículo inválido"), cantidad }))
    .min(1, "Agregá al menos un artículo")
    .max(200, "Demasiados artículos"),
});

export type DatosPresupuesto = z.input<typeof esquemaPresupuesto>;

const esquemaId = z.object({ id: z.uuid("Presupuesto inválido") });

function datosDeDominio(p: z.output<typeof esquemaPresupuesto>) {
  return {
    clienteId: p.clienteId,
    validezDias: p.validezDias,
    observaciones: p.observaciones,
    items: p.items.map((i) => ({ articuloId: i.articuloId, cantidad: d(i.cantidad) })),
  };
}

function revalidarPresupuestos(id?: string) {
  revalidatePath("/presupuestos");
  if (id) {
    revalidatePath(`/presupuestos/${id}`);
    revalidatePath(`/presupuestos/${id}/imprimir`);
  }
}

export type ResultadoAlta = { ok: true; id: string; numero: number; anio: number } | { ok: false; error: string };

export async function crearPresupuesto(datos: DatosPresupuesto): Promise<ResultadoAlta> {
  const permiso = await verificarPermiso("cargarPresupuesto");
  if (!permiso.ok) return permiso;
  const parsed = esquemaPresupuesto.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    const r = await prisma.$transaction((tx) => crearPresupuestoEnTx(tx, datosDeDominio(parsed.data), hoyArgentina()));
    revalidarPresupuestos();
    return { ok: true, ...r };
  } catch (error) {
    console.error("[crearPresupuesto]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el presupuesto.") };
  }
}

const esquemaEdicion = esquemaPresupuesto.extend({ id: z.uuid("Presupuesto inválido") });

/** Solo si esta ABIERTO y no vencido. Conserva los precios de las lineas que ya estaban. */
export async function editarPresupuesto(datos: z.input<typeof esquemaEdicion>): Promise<Resultado> {
  const permiso = await verificarPermiso("cargarPresupuesto");
  if (!permiso.ok) return permiso;
  const parsed = esquemaEdicion.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => editarPresupuestoEnTx(tx, parsed.data.id, datosDeDominio(parsed.data), hoyArgentina()));
  } catch (error) {
    console.error("[editarPresupuesto]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el presupuesto.") };
  }
  revalidarPresupuestos(parsed.data.id);
  return { ok: true };
}

export async function anularPresupuesto(datos: z.input<typeof esquemaId>): Promise<Resultado> {
  const permiso = await verificarPermiso("cargarPresupuesto");
  if (!permiso.ok) return permiso;
  const parsed = esquemaId.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => anularPresupuestoEnTx(tx, parsed.data.id));
  } catch (error) {
    console.error("[anularPresupuesto]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo anular el presupuesto.") };
  }
  revalidarPresupuestos(parsed.data.id);
  return { ok: true };
}

/** Copia como presupuesto nuevo, con los precios de hoy del cliente. */
export async function duplicarPresupuesto(datos: z.input<typeof esquemaId>): Promise<ResultadoAlta> {
  const permiso = await verificarPermiso("cargarPresupuesto");
  if (!permiso.ok) return permiso;
  const parsed = esquemaId.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    const r = await prisma.$transaction((tx) => duplicarPresupuestoEnTx(tx, parsed.data.id, hoyArgentina()));
    revalidarPresupuestos();
    return { ok: true, ...r };
  } catch (error) {
    console.error("[duplicarPresupuesto]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo duplicar el presupuesto.") };
  }
}

export type ResultadoConversion =
  | { ok: true; ventaId: string; numero: number; anio: number; advertencias: string[] }
  | { ok: false; error: string };

/**
 * Convierte en venta con los precios congelados. Todo en una transaccion con el
 * presupuesto bloqueado: no se puede convertir dos veces.
 */
export async function convertirPresupuesto(datos: z.input<typeof esquemaId>): Promise<ResultadoConversion> {
  const permiso = await verificarPermiso("convertirPresupuesto");
  if (!permiso.ok) return permiso;
  const parsed = esquemaId.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    const r = await prisma.$transaction((tx) => convertirPresupuestoEnTx(tx, parsed.data.id, hoyArgentina()), {
      timeout: 15_000,
    });
    revalidarPresupuestos(parsed.data.id);
    revalidarVentas();
    for (const ruta of ["/ventas", "/cobranzas", "/cobranzas/hoy"]) revalidatePath(ruta);
    return { ok: true, ventaId: r.ventaId, numero: r.numero, anio: r.anio, advertencias: r.advertencias };
  } catch (error) {
    console.error("[convertirPresupuesto]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo convertir el presupuesto en venta.") };
  }
}
