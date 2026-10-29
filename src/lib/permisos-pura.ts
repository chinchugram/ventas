import type { Rol } from "@/lib/auth-pura";

// Tabla de permisos por rol, pura: la puede importar un componente cliente (por
// ejemplo, para filtrar entradas del navbar) sin arrastrar codigo de servidor.
// La API de servidor (`requierePermiso`) esta en `src/lib/permisos.ts`.
//
// Regla de oro: lo que no esta en la tabla, no se puede. `DUENO` puede todo lo
// que esta en la tabla; `EMPLEADO` solo lo que la tabla le nombra de forma explicita.

/** Las doce acciones del contrato de la ola 4 (todas solo para `DUENO`)... */
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
  | "gestionarUsuarios";

/**
 * ...y las que 4.3 agrega para lo que `EMPLEADO` si puede hacer: tener un nombre
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
  | "cambiarClavePropia"; // cada usuario cambia la suya (pide la actual)

export type Accion = AccionDelDueno | AccionDelMostrador;

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
  gestionarUsuarios: SOLO_DUENO,

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
};

export const ACCIONES = Object.keys(PERMISOS) as Accion[];

/**
 * `DUENO` puede todo lo que esta en la tabla. Sin usuario, nada. Una accion
 * desconocida, nada (tampoco para el dueno: ante la duda, cerrado).
 */
export function puede(usuario: { rol: Rol } | null | undefined, accion: Accion): boolean {
  if (!usuario) return false;
  if (!Object.hasOwn(PERMISOS, accion)) return false;
  if (usuario.rol === "DUENO") return true;
  return PERMISOS[accion].includes(usuario.rol);
}

/**
 * Pantalla de inicio de cada rol. Es la misma que `inicioDeRol` de `auth-pura.ts`
 * (a donde lleva el login); esa importa `node:crypto` y no se puede usar en un
 * componente cliente, esta si. `scripts/verificar-permisos.ts` comprueba que coinciden.
 */
export function rutaDeInicio(rol: Rol): string {
  return rol === "DUENO" ? "/" : "/ventas/nueva";
}

/** Puede con todas las acciones de la lista (una lista vacia no exige nada). */
export function puedeTodo(usuario: { rol: Rol } | null | undefined, acciones: readonly Accion[]): boolean {
  return acciones.every((a) => puede(usuario, a));
}
