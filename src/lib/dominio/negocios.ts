import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ErrorDeNegocio } from "@/lib/acciones";
import { CLAVE_MAX, normalizarSlug, SLUG_PATRON, SLUGS_RESERVADOS } from "@/lib/auth-pura";
import { CLAVES, POR_DEFECTO } from "@/lib/configuracion";
import { crearDuenoEnTx } from "@/lib/dominio/auth";
import type { Tx } from "./tx";

// Alta y baja logica de negocios y alta de su primer dueno (F4.3). Solo las usa el SUPERADMIN
// (`administrarNegocios`, ver `src/app/admin/negocios/actions.ts`). Reciben datos ya validados por
// zod y un `tx` abierto en contexto de SUPERADMIN (`conSuperadmin`): asi las llaman las server
// actions y `scripts/test-negocios.ts`. El SUPERADMIN solo toca la fila de `negocios` (nombre,
// slug, estado) y, al crear uno nuevo, su configuracion inicial y su primer dueno: nunca lee ni
// escribe datos de un negocio que ya existe.

// ─── Validacion ───────────────────────────────────────────────────────────────

export const NOMBRE_NEGOCIO_MAX = 80;

const textoSlug = z
  .string()
  .transform(normalizarSlug)
  .pipe(
    z
      .string()
      .regex(SLUG_PATRON, "El identificador usa minúsculas, números y guiones, de 3 a 30 caracteres.")
      .refine((s) => !SLUGS_RESERVADOS.includes(s), "Ese identificador está reservado."),
  );

export const esquemaNegocioNuevo = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre").max(NOMBRE_NEGOCIO_MAX, `Máximo ${NOMBRE_NEGOCIO_MAX} caracteres`),
  slug: textoSlug,
});
export type DatosNegocioNuevo = z.output<typeof esquemaNegocioNuevo>;

export const idNegocio = z.uuid("Negocio inválido");

export const esquemaPrimerDueno = z.object({
  negocioId: idNegocio,
  usuario: z.string().trim().min(1, "Falta el usuario").max(60, "El usuario es demasiado largo"),
  nombre: z.string().trim().min(1, "Falta el nombre").max(80, "Máximo 80 caracteres"),
  // Tope de largo antes de scrypt; la validacion fina esta en `crearUsuarioEnTx`.
  clave: z.string().max(CLAVE_MAX * 2, "La clave es demasiado larga."),
});
export type DatosPrimerDueno = z.output<typeof esquemaPrimerDueno>;

// ─── Alta de un negocio ───────────────────────────────────────────────────────

/**
 * El id se elige ANTES de abrir la transaccion: `conSuperadmin(fn, { negocioId })` tiene que declarar el
 * negocio nuevo (vacio todavia) para poder insertar su configuracion y su dueno bajo RLS.
 */
export function nuevoIdDeNegocio(): string {
  return randomUUID();
}

/** Las claves de `Configuracion` de un negocio recien creado: los defaults, con el nombre propio. */
export function configuracionInicial(nombre: string): { clave: string; valor: string }[] {
  return Object.values(CLAVES).map((clave) => ({
    clave,
    // El unico default que identifica a un negocio es su nombre: el de otro negocio ("HL Laser") no le corresponde.
    valor: clave === CLAVES.nombreNegocio ? nombre : POR_DEFECTO[clave],
  }));
}

/**
 * Crea el negocio (activo) y sus claves de configuracion por defecto. `tx` en contexto de SUPERADMIN con
 * `negocioId = id`. El slug es unico: si ya existe, `ErrorDeNegocio` (y por si dos altas corren a la vez,
 * el indice unico lo rechaza igual con P2002).
 */
export async function crearNegocioEnTx(tx: Tx, id: string, datos: DatosNegocioNuevo): Promise<{ id: string; nombre: string; slug: string }> {
  if (await tx.negocio.findUnique({ where: { slug: datos.slug }, select: { id: true } })) {
    throw new ErrorDeNegocio(`Ya existe un negocio con el identificador «${datos.slug}».`);
  }
  const creado = await tx.negocio.create({ data: { id, nombre: datos.nombre, slug: datos.slug }, select: { id: true, nombre: true, slug: true } });
  await tx.configuracion.createMany({ data: configuracionInicial(datos.nombre).map((c) => ({ negocioId: id, ...c })) });
  return creado;
}

// ─── Primer dueno ─────────────────────────────────────────────────────────────

/**
 * Crea el primer dueno de un negocio ya existente, con una clave inicial que tiene que cambiar al entrar
 * (`debeCambiarClave`). `tx` en contexto de SUPERADMIN con `negocioId` del negocio. Se niega si el negocio
 * no existe o si ya tuvo un dueno (aunque este dado de baja): los demas usuarios los administra el dueno.
 */
export async function crearPrimerDuenoEnTx(tx: Tx, datos: DatosPrimerDueno): Promise<{ usuario: string; nombre: string }> {
  const negocio = await tx.negocio.findUnique({ where: { id: datos.negocioId }, select: { id: true } });
  if (!negocio) throw new ErrorDeNegocio("Ese negocio no existe.");
  const creado = await crearDuenoEnTx(tx, {
    negocioId: negocio.id,
    usuario: datos.usuario,
    nombre: datos.nombre,
    clave: datos.clave,
    debeCambiarClave: true,
  });
  return { usuario: creado.usuario, nombre: creado.nombre };
}

// ─── Baja logica ──────────────────────────────────────────────────────────────

/**
 * Da de baja (`activo: false`: nadie del negocio puede entrar, sus datos quedan intactos) o reactiva un
 * negocio. Nunca se borra. `tx` en contexto de SUPERADMIN.
 */
export async function cambiarActivoNegocioEnTx(tx: Tx, id: string, activo: boolean): Promise<void> {
  const negocio = await tx.negocio.findUnique({ where: { id }, select: { activo: true } });
  if (!negocio) throw new ErrorDeNegocio("Ese negocio no existe.");
  if (negocio.activo !== activo) await tx.negocio.update({ where: { id }, data: { activo } });
}
