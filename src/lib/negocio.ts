import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Contexto de negocio (multi-tenant F2.1).
 *
 * El aislamiento entre negocios lo fuerza Postgres con Row Level Security: cada
 * tabla con `negocioId` solo muestra y acepta filas del negocio que la transaccion
 * declara en la variable `app.negocio_id`. Esta variable se fija con `set_config(..., true)`
 * (equivale a `SET LOCAL`): vive SOLO dentro de la transaccion, asi que no se
 * filtra a otra conexion del pool (ni siquiera en Neon con pooler) ni a la
 * siguiente transaccion de la misma conexion. Sin variable, las politicas no dejan
 * ver ni escribir nada (falla cerrado).
 *
 * Regla: TODA lectura y escritura de datos de un negocio pasa por `conNegocio`.
 * Usar `prisma` suelto sobre tablas de datos devuelve vacio / rechaza las escrituras
 * (solo `negocios`, la tabla global, se lee sin contexto).
 *
 *   const clientes = await conNegocio(negocioId, (tx) => tx.cliente.findMany());
 *
 * Importante: la app tiene que conectarse con el rol `ventas_app` (sin SUPERUSER ni
 * BYPASSRLS). Un superusuario se salta las politicas y el aislamiento desaparece sin
 * avisar; ver `verificarRolDeLaApp`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opciones de la transaccion interactiva (las de Prisma; el default de timeout es 5 s). */
export type OpcionesConNegocio = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

export type TxNegocio = Prisma.TransactionClient;

/**
 * Abre una transaccion, declara el negocio (`app.negocio_id`) y ejecuta `fn` con el
 * cliente de esa transaccion. Si `fn` lanza, se deshace todo. Anidar `conNegocio` no
 * esta soportado: dentro de `fn` hay que usar el `tx` recibido.
 */
export async function conNegocio<T>(
  negocioId: string,
  fn: (tx: TxNegocio) => Promise<T>,
  opciones?: OpcionesConNegocio,
): Promise<T> {
  if (typeof negocioId !== "string" || !UUID.test(negocioId)) {
    throw new Error("conNegocio: negocioId invalido (se espera un UUID).");
  }
  return prisma.$transaction(async (tx) => {
    // is_local = true: solo dura hasta el fin de ESTA transaccion.
    await tx.$queryRaw`SELECT set_config('app.negocio_id', ${negocioId}, true)`;
    await verificarRolDeLaApp(tx);
    return fn(tx);
  }, opciones);
}

// ─── Rol de la app ───────────────────────────────────────────────────────────
// Si DATABASE_URL apunta a un rol con SUPERUSER o BYPASSRLS, RLS no rige y los
// negocios quedan mezclados sin ningun error. Se comprueba una vez por proceso.
// En produccion es un error; en desarrollo, un aviso (la base local del docker-compose
// arranca con un superusuario: correr scripts/crear-roles-db.sql y usar ventas_app).
let rolVerificado = false;

/** Falla (produccion) o avisa (otros entornos) si el rol de la conexion se salta RLS. */
export async function verificarRolDeLaApp(tx: Pick<TxNegocio, "$queryRaw">): Promise<void> {
  if (rolVerificado) return;
  const filas = await tx.$queryRaw<{ rolname: string; omite: boolean }[]>`
    SELECT rolname, (rolsuper OR rolbypassrls) AS omite
      FROM pg_roles WHERE rolname = current_user`;
  const rol = filas[0];
  if (rol?.omite) {
    const mensaje =
      `El rol de base "${rol.rolname}" es superusuario o tiene BYPASSRLS: RLS no aisla los negocios. ` +
      "DATABASE_URL debe usar el rol ventas_app (ver docs/03-stack-y-decisiones.md).";
    if (process.env.NODE_ENV === "production" && process.env.PERMITIR_ROL_CON_BYPASS_RLS !== "1") {
      throw new Error(mensaje);
    }
    console.warn(`[negocio] ${mensaje}`);
  }
  rolVerificado = true;
}
