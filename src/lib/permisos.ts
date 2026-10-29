import { redirect } from "next/navigation";
import { ErrorDeNegocio } from "@/lib/acciones";
import { SIN_SESION, requiereUsuario, usuarioActual, type UsuarioSesion } from "@/lib/auth";
import { puede, puedeTodo, rutaDeInicio, type Accion } from "@/lib/permisos-pura";

// API unica de autorizacion (contrato de la ola 4). Solo servidor: usa la sesion
// del pedido. Lo puro (la tabla y `puede`) esta en `src/lib/permisos-pura.ts`.

export { ACCIONES, PERMISOS, puede, puedeTodo, type Accion } from "@/lib/permisos-pura";

const QUE: Record<Accion, string> = {
  verCostos: "ver costos",
  verMargenes: "ver márgenes",
  anularVenta: "anular ventas",
  anularPago: "anular pagos",
  ajustarStock: "ajustar stock",
  registrarCompra: "registrar compras",
  editarCatalogo: "editar el catálogo",
  editarMateriales: "editar materiales",
  verReportes: "ver reportes",
  exportarCsv: "exportar reportes",
  configuracion: "cambiar la configuración",
  gestionarUsuarios: "administrar usuarios",
  verVentas: "ver ventas",
  cargarVenta: "cargar ventas",
  registrarCobro: "registrar cobros",
  marcarEntregada: "marcar ventas como entregadas",
  verCobranzas: "ver cobranzas",
  verClientes: "ver clientes",
  editarClientes: "editar clientes",
  verStock: "ver el stock",
  verReposicion: "ver la reposición",
  cambiarClavePropia: "cambiar la clave",
};

export function mensajeSinPermiso(accion: Accion): string {
  return `No tenés permiso para ${QUE[accion]}.`;
}

/**
 * Usuario del pedido si puede hacer `accion`. Si no hay sesion o no tiene
 * permiso, lanza `ErrorDeNegocio` con un mensaje claro. Pensado como primera
 * linea de una server action o de un route handler:
 *
 *   const usuario = await requierePermiso("anularVenta");
 *
 * En una server action conviene que el `try` lo envuelva (o usar
 * `verificarPermiso`), para devolver el mensaje como `{ ok: false, error }`:
 * Next oculta el texto de los errores lanzados en produccion.
 */
export async function requierePermiso(accion: Accion): Promise<UsuarioSesion> {
  const usuario = await usuarioActual();
  if (!usuario) throw new ErrorDeNegocio(SIN_SESION);
  if (!puede(usuario, accion)) throw new ErrorDeNegocio(mensajeSinPermiso(accion));
  return usuario;
}

/** Igual que `requierePermiso` pero sin lanzar: `{ ok: false, error }` listo para devolver desde una accion. */
export async function verificarPermiso(
  accion: Accion,
): Promise<{ ok: true; usuario: UsuarioSesion } | { ok: false; error: string }> {
  const usuario = await usuarioActual();
  if (!usuario) return { ok: false, error: SIN_SESION };
  if (!puede(usuario, accion)) return { ok: false, error: mensajeSinPermiso(accion) };
  return { ok: true, usuario };
}

/**
 * Primera linea de una PAGINA (`page.tsx`) que exige permisos. Sin sesion
 * redirige a /login; con sesion pero sin alguno de los permisos, a la pantalla
 * de inicio del rol (`/ventas/nueva` para `EMPLEADO`), nunca a /login. Pedir
 * varias acciones exige todas. Devuelve el usuario para decidir que mostrar.
 *
 *   const usuario = await requierePermisoPagina("verCostos", "verMargenes");
 *
 * La pantalla de inicio de cada rol tiene que estar permitida para ese rol, o la
 * redireccion daria vueltas (`scripts/verificar-permisos.ts` lo comprueba).
 */
export async function requierePermisoPagina(...acciones: Accion[]): Promise<UsuarioSesion> {
  const usuario = await requiereUsuario();
  if (!puedeTodo(usuario, acciones)) redirect(rutaDeInicio(usuario.rol));
  return usuario;
}
