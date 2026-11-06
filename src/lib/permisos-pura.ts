import type { Rol, RolConSuperadmin } from "@/lib/auth-pura";

// Tabla de permisos por rol, pura: la puede importar un componente cliente (por
// ejemplo, para filtrar entradas del navbar) sin arrastrar codigo de servidor.
// La API de servidor (`requierePermiso`) esta en `src/lib/permisos.ts`.
//
// Regla de oro: lo que no esta en la tabla, no se puede. `DUENO` puede todo lo
// que esta en la tabla; `EMPLEADO` solo lo que la tabla le nombra de forma explicita.

/**
 * Las doce acciones del contrato de la ola 4 (todas solo para `DUENO`)... y
 * `gestionarListasPrecios` (ola 7): fijar el precio al que se le vende a cada
 * cliente es una decision del dueno (y esas pantallas avisan cuando un precio
 * queda por debajo del costo).
 */
export type AccionDelDueno =
  | "verCostos"
  | "verMargenes"
  | "anularVenta"
  | "anularPago"
  | "ajustarStock"
  | "registrarCompra"
  | "editarCatalogo"
  | "editarMateriales"
  | "verReportes"
  | "exportarCsv"
  | "configuracion"
  | "gestionarUsuarios"
  | "gestionarListasPrecios" // listas de precios y asignarlas a un cliente
  // Ola 6: el margen real (costo real contra costo de receta) son costos y margenes: solo el dueno.
  | "verMargenReal"
  // Ola 5: una nota de credito deshace una factura emitida (impacto fiscal): decision del dueno.
  | "emitirNotaCredito";

/**
 * ...y las que 4.3, la ola 5 y la ola 7 agregan para lo que `EMPLEADO` si puede hacer: tener un nombre
 * propio permite exigirlas en cada accion y pagina (y quitarselas a un rol
 * futuro) sin tocar el resto.
 */
export type AccionDelMostrador =
  | "verVentas" // listado y detalle de ventas, sin costo ni margen
  | "cargarVenta"
  | "registrarCobro"
  | "marcarEntregada"
  | "verCobranzas"
  | "verClientes"
  | "editarClientes" // alta, edicion y baja logica de clientes
  | "verStock" // materiales: solo cantidades
  | "verReposicion" // lista de reposicion, sin costo estimado
  | "cambiarClavePropia" // cada usuario cambia la suya (pide la actual)
  // Ola 7: presupuestos (solo precios, nunca costos) y recordatorios de cobranza.
  | "verPresupuestos"
  | "cargarPresupuesto" // alta, edicion, duplicado y anulacion de un presupuesto
  | "convertirPresupuesto" // lo convierte en una venta con los precios congelados
  | "verRecordatorios" // /cobranzas/hoy: a quien llamar hoy
  | "registrarContactoCobranza" // deja constancia de un llamado o mensaje
  // Ola 5: facturacion electronica (los comprobantes no llevan costos ni margenes).
  | "verComprobantes" // listado, detalle e impresion de comprobantes
  | "emitirComprobante" // emite la factura de una venta
  // Ola 6: produccion. Cargar lo realmente usado (minutos y materiales, sin costos) lo hace quien esta en el taller.
  | "cargarProduccion"; // cargar, ver y anular trabajos de produccion y estimar tiempos

export type Accion = AccionDelDueno | AccionDelMostrador;

/**
 * Acciones del SUPERADMIN (F4.3). Aparte de `Accion` a proposito: `Accion` son las de un negocio
 * (`PERMISOS`, `ACCIONES`: el dueno puede todas) y el SUPERADMIN no puede ninguna. Esta es la unica
 * del SUPERADMIN y ningun rol de un negocio la tiene.
 */
export type AccionDeSuperadmin = "administrarNegocios"; // /admin/negocios: alta, baja logica y primer dueno de cada negocio

const SOLO_DUENO: readonly Rol[] = ["DUENO"];
const TODOS: readonly Rol[] = ["DUENO", "EMPLEADO"];

/** Quien puede cada accion. */
export const PERMISOS: Readonly<Record<Accion, readonly Rol[]>> = {
  verCostos: SOLO_DUENO,
  verMargenes: SOLO_DUENO,
  anularVenta: SOLO_DUENO,
  anularPago: SOLO_DUENO,
  ajustarStock: SOLO_DUENO,
  registrarCompra: SOLO_DUENO,
  editarCatalogo: SOLO_DUENO,
  editarMateriales: SOLO_DUENO,
  verReportes: SOLO_DUENO,
  exportarCsv: SOLO_DUENO,
  configuracion: SOLO_DUENO,
  // El DUENO administra SOLO los usuarios de su negocio: lo hacen cumplir `conNegocio(actor.negocioId)` (RLS)
  // y los filtros por negocio de `dominio/usuarios.ts`, no esta tabla. El SUPERADMIN no esta en ninguna fila.
  gestionarUsuarios: SOLO_DUENO,
  gestionarListasPrecios: SOLO_DUENO,
  emitirNotaCredito: SOLO_DUENO,
  verMargenReal: SOLO_DUENO,

  verVentas: TODOS,
  cargarVenta: TODOS,
  registrarCobro: TODOS,
  marcarEntregada: TODOS,
  verCobranzas: TODOS,
  verClientes: TODOS,
  editarClientes: TODOS,
  verStock: TODOS,
  verReposicion: TODOS,
  cambiarClavePropia: TODOS,
  verPresupuestos: TODOS,
  cargarPresupuesto: TODOS,
  convertirPresupuesto: TODOS,
  verRecordatorios: TODOS,
  registrarContactoCobranza: TODOS,
  verComprobantes: TODOS,
  emitirComprobante: TODOS,
  cargarProduccion: TODOS,
};

export const ACCIONES = Object.keys(PERMISOS) as Accion[];

/** Quien puede cada accion del SUPERADMIN: solo el. */
export const PERMISOS_SUPERADMIN: Readonly<Record<AccionDeSuperadmin, readonly RolConSuperadmin[]>> = {
  administrarNegocios: ["SUPERADMIN"],
};

export const ACCIONES_SUPERADMIN = Object.keys(PERMISOS_SUPERADMIN) as AccionDeSuperadmin[];

/**
 * `DUENO` puede todo lo que esta en la tabla. Sin usuario, nada. Una accion
 * desconocida, nada (tampoco para el dueno: ante la duda, cerrado).
 */
export function puede(usuario: { rol: RolConSuperadmin } | null | undefined, accion: Accion | AccionDeSuperadmin): boolean {
  if (!usuario) return false;
  // Las del SUPERADMIN: solo los roles listados (el DUENO NO "puede todo" aca).
  if (Object.hasOwn(PERMISOS_SUPERADMIN, accion)) return PERMISOS_SUPERADMIN[accion as AccionDeSuperadmin].includes(usuario.rol);
  if (!Object.hasOwn(PERMISOS, accion)) return false;
  // El SUPERADMIN no esta en ninguna fila de la tabla: no puede nada sobre datos de un negocio.
  if (usuario.rol === "SUPERADMIN") return false;
  if (usuario.rol === "DUENO") return true;
  return PERMISOS[accion as Accion].includes(usuario.rol);
}

/**
 * Pantalla de inicio de cada rol. Es la misma que `inicioDeRol` de `auth-pura.ts`
 * (a donde lleva el login); esa importa `node:crypto` y no se puede usar en un
 * componente cliente, esta si. `scripts/verificar-permisos.ts` comprueba que coinciden.
 */
export function rutaDeInicio(rol: RolConSuperadmin): string {
  if (rol === "SUPERADMIN") return "/admin/negocios";
  return rol === "DUENO" ? "/" : "/ventas/nueva";
}

/** `/admin` o cualquier ruta debajo: la zona del SUPERADMIN (F4.3). */
export function esRutaDeAdmin(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Aislamiento por ruta (lo aplica el proxy a toda sesion valida): el SUPERADMIN solo
 * entra a `/admin/**` (y a /login para salir); los roles de un negocio nunca entran a
 * `/admin/**`. Lo que cada rol puede dentro de su zona lo decide la tabla `PERMISOS`.
 */
export function rutaPermitidaParaRol(rol: RolConSuperadmin, pathname: string): boolean {
  if (rol === "SUPERADMIN") return esRutaDeAdmin(pathname) || pathname === "/login";
  return !esRutaDeAdmin(pathname);
}

/** Puede con todas las acciones de la lista (una lista vacia no exige nada). */
export function puedeTodo(
  usuario: { rol: RolConSuperadmin } | null | undefined,
  acciones: readonly (Accion | AccionDeSuperadmin)[],
): boolean {
  return acciones.every((a) => puede(usuario, a));
}
