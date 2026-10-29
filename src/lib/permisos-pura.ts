import type { Rol } from "@/lib/auth-pura";

// Tabla de permisos por rol, pura: la puede importar un componente cliente (por
// ejemplo, para filtrar entradas del navbar) sin arrastrar codigo de servidor.
// La API de servidor (`requierePermiso`) esta en `src/lib/permisos.ts`.

/**
 * Lo que no todos pueden hacer. Lo que cualquier usuario con sesion puede hacer
 * (cargar ventas, registrar cobros, marcar entregada, ver y editar clientes, ver
 * cantidades de stock y la lista de reposicion sin costos) no es una `Accion`:
 * alcanza con `requiereUsuario()` / `usuarioParaAccion()`.
 */
export type Accion =
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

const SOLO_DUENO: readonly Rol[] = ["DUENO"];

/** Quien puede cada accion. Tabla inicial del contrato de la ola 4: la ajusta la tarea 4.3. */
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
};

export const ACCIONES = Object.keys(PERMISOS) as Accion[];

/** `DUENO` puede todo. Sin usuario, nada. Una accion desconocida, nada. */
export function puede(usuario: { rol: Rol } | null | undefined, accion: Accion): boolean {
  if (!usuario) return false;
  if (usuario.rol === "DUENO") return true;
  return Object.hasOwn(PERMISOS, accion) && PERMISOS[accion].includes(usuario.rol);
}
