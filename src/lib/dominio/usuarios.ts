import type { PrismaClient } from "@/generated/prisma/client";
import { ErrorDeNegocio } from "@/lib/acciones";
import { hashearClave, problemaDeClave, type Rol, type UsuarioSesion } from "@/lib/auth-pura";
import { puede } from "@/lib/permisos-pura";
import {
  cerrarSesionesDeUsuario,
  crearSesion,
  crearUsuarioEnTx,
  verificarCredenciales,
  type Db,
  type SesionNueva,
} from "./auth";
import type { Tx } from "./tx";

// Administracion de usuarios (ola 4.4). Toda la logica con base vive aca y
// recibe un `tx` (o el cliente), sin Next ni cookies: la usan las server actions
// de `src/app/usuarios/` y `npm run test:usuarios`. Ver docs/seguridad-ola-4-auth.md.
//
// Reglas que se hacen cumplir aca (no en la pantalla):
// - Solo quien puede `gestionarUsuarios` (hoy, el DUENO). Cada funcion de
//   administracion lo verifica primero con el `actor` y, ya dentro de la
//   transaccion, lo vuelve a leer de la base: si lo dieron de baja o le
//   cambiaron el rol mientras tanto, no se ejecuta.
// - Nunca se queda el sistema sin un dueno activo. La baja y el cambio de rol
//   toman un lock de transaccion (`pg_advisory_xact_lock`) y cuentan los duenos
//   activos dentro de el: dos operaciones simultaneas se hacen en fila.
// - Nadie se da de baja ni se cambia el rol a si mismo: lo hace otro dueno. Y
//   nadie cambia su propia clave por esta via (la propia pide la actual).
// - Baja, cambio de rol y cambio de clave cierran las sesiones del usuario.

export const ROLES: readonly Rol[] = ["DUENO", "EMPLEADO"];

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
}

export const ETIQUETA_ROL: Record<Rol, string> = { DUENO: "Dueño", EMPLEADO: "Empleado" };

export const SIN_PERMISO_USUARIOS = "No tenés permiso para administrar usuarios.";
const SIN_PERMISO_AHORA = "Tu usuario ya no tiene permiso para administrar usuarios. Volvé a entrar.";

// ─── Piezas internas ──────────────────────────────────────────────────────────

function exigirPermiso(actor: UsuarioSesion | null | undefined): asserts actor is UsuarioSesion {
  if (!puede(actor, "gestionarUsuarios")) throw new ErrorDeNegocio(SIN_PERMISO_USUARIOS);
}

/** Toda baja o cambio de rol pasa por aca: una a la vez, asi el conteo de duenos activos no se pisa. */
async function bloquearAdministracion(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ventas:usuarios'))`;
}

/** Vuelve a leer al actor de la base: la sesion que llego puede ser de un usuario al que recien dieron de baja. */
async function reconfirmarActor(tx: Tx, actor: UsuarioSesion): Promise<void> {
  const fila = await tx.usuario.findUnique({ where: { id: actor.id }, select: { rol: true, activo: true } });
  if (!fila || !fila.activo || !puede({ rol: fila.rol }, "gestionarUsuarios")) {
    throw new ErrorDeNegocio(SIN_PERMISO_AHORA);
  }
}

const CAMPOS_OBJETIVO = { id: true, usuario: true, nombre: true, rol: true, activo: true } as const;
type Objetivo = { id: string; usuario: string; nombre: string; rol: Rol; activo: boolean };

async function cargarObjetivo(tx: Tx, id: string): Promise<Objetivo> {
  const fila = await tx.usuario.findUnique({ where: { id }, select: CAMPOS_OBJETIVO });
  if (!fila) throw new ErrorDeNegocio("Ese usuario no existe.");
  return fila;
}

/** Hay al menos otro dueno activo ademas de `objetivo`. Se llama con el lock tomado. */
async function exigirOtroDuenoActivo(tx: Tx, objetivo: Objetivo, queSeIntenta: string): Promise<void> {
  const otros = await tx.usuario.count({ where: { rol: "DUENO", activo: true, id: { not: objetivo.id } } });
  if (otros === 0) {
    throw new ErrorDeNegocio(
      `No se puede ${queSeIntenta} a ${objetivo.nombre}: es el último dueño activo y sin un dueño nadie podría administrar el sistema. ` +
        "Primero dejá a otra persona como dueño.",
    );
  }
}

// ─── Alta ─────────────────────────────────────────────────────────────────────

export type DatosAltaUsuario = { usuario: string; nombre: string; rol: unknown; clave: string };

/** Alta de un usuario (dueno o empleado) por un dueno. Normaliza el usuario y rechaza duplicados y roles invalidos. */
export async function crearUsuarioComoDuenoEnTx(
  tx: Tx,
  actor: UsuarioSesion | null | undefined,
  datos: DatosAltaUsuario,
): Promise<UsuarioSesion> {
  exigirPermiso(actor);
  if (!esRol(datos.rol)) throw new ErrorDeNegocio("Elegí un rol válido: dueño o empleado.");
  await reconfirmarActor(tx, actor);
  return crearUsuarioEnTx(tx, { usuario: datos.usuario, nombre: datos.nombre, rol: datos.rol, clave: datos.clave });
}

// ─── Baja y reactivacion ──────────────────────────────────────────────────────

/**
 * Baja logica (`activo = false`) o reactivacion. La baja cierra todas las
 * sesiones del usuario. No se puede dar de baja al ultimo dueno activo (ni uno
 * mismo: lo hace otro dueno). Devuelve `cambio: false` si ya estaba asi.
 */
export async function cambiarActivoUsuarioEnTx(
  tx: Tx,
  actor: UsuarioSesion | null | undefined,
  id: string,
  activo: boolean,
): Promise<{ cambio: boolean }> {
  exigirPermiso(actor);
  await bloquearAdministracion(tx);
  await reconfirmarActor(tx, actor);
  const objetivo = await cargarObjetivo(tx, id);
  if (objetivo.activo === activo) return { cambio: false };

  if (!activo) {
    if (objetivo.rol === "DUENO") await exigirOtroDuenoActivo(tx, objetivo, "dar de baja");
    if (objetivo.id === actor.id) {
      throw new ErrorDeNegocio("No podés dar de baja tu propio usuario: pedile a otro dueño que lo haga.");
    }
  }

  await tx.usuario.update({ where: { id }, data: { activo } });
  if (!activo) await cerrarSesionesDeUsuario(tx, id);
  return { cambio: true };
}

// ─── Cambio de rol ────────────────────────────────────────────────────────────

/**
 * Cambia el rol. Cierra las sesiones del usuario (tiene que volver a entrar con
 * los permisos nuevos). No se puede quitar el rol de dueno al ultimo dueno
 * activo, ni cambiarse el rol a uno mismo. Devuelve `cambio: false` si ya lo tenia.
 */
export async function cambiarRolUsuarioEnTx(
  tx: Tx,
  actor: UsuarioSesion | null | undefined,
  id: string,
  rol: unknown,
): Promise<{ cambio: boolean }> {
  exigirPermiso(actor);
  if (!esRol(rol)) throw new ErrorDeNegocio("Elegí un rol válido: dueño o empleado.");
  await bloquearAdministracion(tx);
  await reconfirmarActor(tx, actor);
  const objetivo = await cargarObjetivo(tx, id);
  if (objetivo.rol === rol) return { cambio: false };

  if (objetivo.rol === "DUENO" && objetivo.activo) await exigirOtroDuenoActivo(tx, objetivo, "quitarle el rol de dueño");
  if (objetivo.id === actor.id) {
    throw new ErrorDeNegocio("No podés cambiar tu propio rol: pedile a otro dueño que lo haga.");
  }

  await tx.usuario.update({ where: { id }, data: { rol } });
  await cerrarSesionesDeUsuario(tx, id);
  return { cambio: true };
}

// ─── Clave de otro usuario ────────────────────────────────────────────────────

/**
 * El dueno le pone una clave nueva a otro usuario. Cierra las sesiones de ese
 * usuario y limpia sus intentos fallidos y la pausa. Para la clave propia no
 * sirve (`cambiarClavePropia` pide la actual): si alguien se queda con una
 * sesion abierta de un dueno, no puede cambiarle la clave por aca.
 */
export async function resetearClaveUsuarioEnTx(
  tx: Tx,
  actor: UsuarioSesion | null | undefined,
  id: string,
  claveNueva: string,
): Promise<void> {
  exigirPermiso(actor);
  const problema = problemaDeClave(claveNueva);
  if (problema) throw new ErrorDeNegocio(problema);
  await reconfirmarActor(tx, actor);
  const objetivo = await cargarObjetivo(tx, id);
  if (objetivo.id === actor.id) {
    throw new ErrorDeNegocio("Tu propia clave se cambia desde «Cambiar mi clave»: ahí se pide la clave actual.");
  }

  await tx.usuario.update({
    where: { id },
    data: { hashClave: await hashearClave(claveNueva), intentosFallidos: 0, ultimoFalloEn: null, bloqueadoHasta: null },
  });
  await cerrarSesionesDeUsuario(tx, id);
}

// ─── Clave propia (cualquier rol) ─────────────────────────────────────────────

export type DatosClavePropia = { actual: string; nueva: string; repetir: string };

export const ERROR_CLAVE_ACTUAL =
  "La clave actual no es correcta. Si fallaste varias veces seguidas, esperá unos minutos antes de volver a intentar.";

/** Validaciones que no necesitan la base. Lanza `ErrorDeNegocio`. */
export function validarClavePropia(datos: DatosClavePropia): void {
  if (datos.actual.length === 0) throw new ErrorDeNegocio("Escribí tu clave actual.");
  const problema = problemaDeClave(datos.nueva);
  if (problema) throw new ErrorDeNegocio(problema);
  if (datos.nueva.normalize("NFC") !== datos.repetir.normalize("NFC")) {
    throw new ErrorDeNegocio("Las dos claves nuevas no coinciden.");
  }
  if (datos.nueva.normalize("NFC") === datos.actual.normalize("NFC")) {
    throw new ErrorDeNegocio("La clave nueva tiene que ser distinta de la actual.");
  }
}

/**
 * Cambia la clave de quien tiene la sesion abierta. Pide la clave actual y la
 * verifica con `verificarCredenciales`, o sea con el mismo tiempo parejo y la
 * misma pausa por intentos fallidos que el login: una sesion robada no sirve
 * para adivinar la clave.
 *
 * La verificacion corre FUERA de la transaccion de escritura a proposito: un
 * intento fallido tiene que quedar contado aunque la operacion se aborte.
 *
 * Sesiones: se cierran TODAS las del usuario (incluida la de este navegador) y
 * se abre una nueva, cuyo token el llamador debe poner en la cookie. Asi nadie
 * conserva un token viejo y no hace falta saber cual era "la actual".
 */
export async function cambiarClavePropia(
  db: Db,
  usuario: UsuarioSesion,
  datos: DatosClavePropia,
  ahora: Date = new Date(),
): Promise<SesionNueva> {
  validarClavePropia(datos);

  const verificado = await verificarCredenciales(db, usuario.usuario, datos.actual, ahora);
  if (!verificado.ok || verificado.usuario.id !== usuario.id) throw new ErrorDeNegocio(ERROR_CLAVE_ACTUAL);

  const hashClave = await hashearClave(datos.nueva);
  const escribir = async (tx: Tx): Promise<SesionNueva> => {
    const { count } = await tx.usuario.updateMany({
      where: { id: usuario.id, activo: true },
      data: { hashClave, intentosFallidos: 0, ultimoFalloEn: null, bloqueadoHasta: null },
    });
    if (count === 0) throw new ErrorDeNegocio("Tu usuario ya no está activo.");
    await cerrarSesionesDeUsuario(tx, usuario.id);
    return crearSesion(tx, usuario.id, ahora);
  };
  const cliente = db as PrismaClient;
  return typeof cliente.$transaction === "function" ? cliente.$transaction(escribir) : escribir(db as Tx);
}
