"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible } from "@/lib/prisma";
import { conNegocio, negocioActual } from "@/lib/negocio";
import { guardarLogoEnTx, quitarLogoEnTx } from "@/lib/marca";
import { MAX_LOGO_BYTES, validarLogo } from "@/lib/marca-pura";
import { verificarPermiso } from "@/lib/permisos";
import { mensajeDeError, primerError, SIN_BASE, type Resultado } from "@/lib/acciones";
import { esquemaConfiguracion, esquemaMaquina, type DatosConfiguracion, type DatosMaquina } from "@/lib/configuracion";
import {
  cambiarActivoMaquinaEnTx,
  crearMaquinaEnTx,
  editarMaquinaEnTx,
  guardarConfiguracionEnTx,
  guardarDatosFiscalesEnTx,
} from "@/lib/dominio/configuracion";
import { CLAVES_FISCALES, validarDatosFiscales, type CampoFiscal } from "@/lib/datos-fiscales";

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
    const negocioId = await negocioActual();
    await conNegocio(negocioId, (tx) => guardarConfiguracionEnTx(tx, parsed.data, negocioId));
  } catch (error) {
    console.error("[guardarConfiguracion]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la configuración.") };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// ─── Logo del negocio (F4.2) ──────────────────────────────────────────────────
// Lo sube el dueño (permiso `configuracion`). El archivo se vuelve a validar aca, por contenido
// (`validarLogo`): el `type` y el nombre que manda el navegador no cuentan. Va al negocio de la
// SESION, nunca a uno que mande el cliente. Es solo cosmetico: el emisor fiscal de los
// comprobantes sigue siendo la foto de los datos fiscales.

/**
 * Lo que llega en el campo `logo`: un archivo (los campos de texto son `string`). Se reconoce por
 * lo que sabe hacer y no con `instanceof File`: el `File` que arma el servidor de Next al
 * decodificar el formulario no siempre es la misma clase que el global.
 */
type ArchivoSubido = { size: number; arrayBuffer(): Promise<ArrayBuffer> };
const esArchivo = (v: unknown): v is ArchivoSubido =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as ArchivoSubido).arrayBuffer === "function" &&
  typeof (v as ArchivoSubido).size === "number";

const esquemaLogo = z.object({
  logo: z
    .custom<ArchivoSubido>(esArchivo, "Elegí un archivo de imagen.")
    .refine((f) => f.size > 0, "El archivo está vacío.")
    .refine((f) => f.size <= MAX_LOGO_BYTES, "El logo pesa más de 1 MB, que es el máximo. Probá con una imagen más liviana."),
});

/** Sube o reemplaza el logo del negocio. Acepta PNG, JPG o SVG simple, hasta 1 MB. */
export async function subirLogo(datos: FormData): Promise<Resultado> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  const parsed = esquemaLogo.safeParse({ logo: typeof datos?.get === "function" ? datos.get("logo") : null });
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  const validado = validarLogo(new Uint8Array(await parsed.data.logo.arrayBuffer()));
  if (!validado.ok) return { ok: false, error: validado.error };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    const negocioId = await negocioActual();
    await conNegocio(negocioId, (tx) => guardarLogoEnTx(tx, negocioId, validado.logo));
  } catch (error) {
    console.error("[subirLogo]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el logo.") };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Quita el logo subido: el negocio vuelve a su logo por defecto o a las iniciales. */
export async function quitarLogo(): Promise<Resultado> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    const negocioId = await negocioActual();
    await conNegocio(negocioId, (tx) => quitarLogoEnTx(tx, negocioId));
  } catch (error) {
    console.error("[quitarLogo]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo quitar el logo.") };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// ─── Datos fiscales ───────────────────────────────────────────────────────────
// El emisor de los comprobantes. La validacion de fondo es `validarDatosFiscales`
// (src/lib/datos-fiscales.ts), que el servidor vuelve a correr sobre todo lo
// recibido: el formulario solo informa. Los topes de zod son solo para no
// recibir basura de tamaño desmedido.

const esquemaDatosFiscales = z.object({
  razonSocial: z.string().max(500, "Razón social demasiado larga"),
  cuit: z.string().max(40, "CUIT demasiado largo"),
  condicionIva: z.string().max(40, "Condición frente al IVA demasiado larga"),
  domicilio: z.string().max(500, "Domicilio demasiado largo"),
  inicioActividades: z.string().max(40, "Fecha de inicio demasiado larga"),
  iibb: z.string().max(100, "Ingresos brutos demasiado largo"),
  puntoVenta: z.string().max(20, "Punto de venta demasiado largo"),
});

export type DatosFiscalesFormulario = z.input<typeof esquemaDatosFiscales>;

/**
 * Lo que guarda el formulario. El umbral de identificacion del consumidor final
 * no esta en la pantalla: no se toca desde aca.
 */
const CAMPOS_FORMULARIO = [
  "razonSocial",
  "cuit",
  "condicionIva",
  "domicilio",
  "inicioActividades",
  "iibb",
  "puntoVenta",
] as const satisfies readonly CampoFiscal[];

/** Guarda los datos fiscales del negocio. Solo el dueño (permiso `configuracion`). */
export async function guardarDatosFiscales(datos: DatosFiscalesFormulario): Promise<Resultado> {
  const permiso = await verificarPermiso("configuracion");
  if (!permiso.ok) return permiso;
  const parsed = esquemaDatosFiscales.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  const revision = validarDatosFiscales(parsed.data);
  if (!revision.ok) return { ok: false, error: Object.values(revision.errores)[0] ?? "Revisá los datos fiscales." };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const valores = Object.fromEntries(
    CAMPOS_FORMULARIO.map((campo) => [CLAVES_FISCALES[campo], revision.valores[CLAVES_FISCALES[campo]] ?? ""]),
  );
  try {
    const negocioId = await negocioActual();
    await conNegocio(negocioId, (tx) => guardarDatosFiscalesEnTx(tx, valores, negocioId));
  } catch (error) {
    console.error("[guardarDatosFiscales]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudieron guardar los datos fiscales.") };
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
    const negocioId = await negocioActual();
    await conNegocio(negocioId, (tx) => crearMaquinaEnTx(tx, negocioId, parsed.data));
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
    await conNegocio(await negocioActual(), (tx) => editarMaquinaEnTx(tx, id.data, parsed.data));
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
    ({ recetas } = await conNegocio(await negocioActual(), (tx) =>
      cambiarActivoMaquinaEnTx(tx, parsed.data.id, parsed.data.activo),
    ));
  } catch (error) {
    console.error("[cambiarActivoMaquina]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo actualizar la máquina.") };
  }

  revalidatePath("/", "layout");
  return { ok: true, recetas };
}
