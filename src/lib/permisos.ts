import { redirect } from "next/navigation";
import { ErrorDeNegocio } from "@/lib/acciones";
import { SIN_SESION, requiereUsuario, sesionActual, type SuperadminSesion, type UsuarioSesion } from "@/lib/auth";
import { puede, puedeTodo, rutaDeInicio, type Accion, type AccionDeSuperadmin } from "@/lib/permisos-pura";

// API unica de autorizacion (contrato de la ola 4). Solo servidor: usa la sesion
// del pedido. Lo puro (la tabla y `puede`) esta en `src/lib/permisos-pura.ts`.

export {
  ACCIONES,
  ACCIONES_SUPERADMIN,
  PERMISOS,
  PERMISOS_SUPERADMIN,
  puede,
  puedeTodo,
  type Accion,
  type AccionDeSuperadmin,
} from "@/lib/permisos-pura";

const QUE: Record<Accion | AccionDeSuperadmin, string> = {
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
  gestionarListasPrecios: "gestionar las listas de precios",
  emitirNotaCredito: "emitir notas de crédito",
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
  verPresupuestos: "ver presupuestos",
  cargarPresupuesto: "cargar presupuestos",
  convertirPresupuesto: "convertir presupuestos en ventas",
  verRecordatorios: "ver los recordatorios de cobranza",
  registrarContactoCobranza: "registrar contactos de cobranza",
  verComprobantes: "ver los comprobantes",
  emitirComprobante: "emitir comprobantes",
  verMargenReal: "ver el margen real",
  cargarProduccion: "cargar la producción",
  administrarNegocios: "administrar los negocios",
};

export function mensajeSinPermiso(accion: Accion | AccionDeSuperadmin): string {
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
export async function requierePermiso(accion: AccionDeSuperadmin): Promise<SuperadminSesion>;
export async function requierePermiso(accion: Accion): Promise<UsuarioSesion>;
export async function requierePermiso(accion: Accion | AccionDeSuperadmin): Promise<UsuarioSesion | SuperadminSesion> {
  // `sesionActual` (no `usuarioActual`): un SUPERADMIN en una accion de un negocio, o un dueno en una del
  // SUPERADMIN, tienen sesion pero no permiso, y eso es lo que se les dice. `puede` garantiza el tipo devuelto.
  const usuario = await sesionActual();
  if (!usuario) throw new ErrorDeNegocio(SIN_SESION);
  if (!puede(usuario, accion)) throw new ErrorDeNegocio(mensajeSinPermiso(accion));
  return usuario as UsuarioSesion | SuperadminSesion;
}

const esDeSuperadmin = (accion: string): accion is AccionDeSuperadmin => accion === "administrarNegocios";

/** Igual que `requierePermiso` pero sin lanzar: `{ ok: false, error }` listo para devolver desde una accion. */
export async function verificarPermiso(
  accion: AccionDeSuperadmin,
): Promise<{ ok: true; usuario: SuperadminSesion } | { ok: false; error: string }>;
export async function verificarPermiso(accion: Accion): Promise<{ ok: true; usuario: UsuarioSesion } | { ok: false; error: string }>;
export async function verificarPermiso(
  accion: Accion | AccionDeSuperadmin,
): Promise<{ ok: true; usuario: UsuarioSesion | SuperadminSesion } | { ok: false; error: string }> {
  const usuario = await sesionActual();
  if (!usuario) return { ok: false, error: SIN_SESION };
  if (!puede(usuario, accion)) return { ok: false, error: mensajeSinPermiso(accion) };
  return { ok: true, usuario: usuario as UsuarioSesion | SuperadminSesion };
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
export async function requierePermisoPagina(accion: AccionDeSuperadmin): Promise<SuperadminSesion>;
export async function requierePermisoPagina(...acciones: Accion[]): Promise<UsuarioSesion>;
export async function requierePermisoPagina(...acciones: (Accion | AccionDeSuperadmin)[]): Promise<UsuarioSesion | SuperadminSesion> {
  if (acciones.some(esDeSuperadmin)) {
    // Pagina del SUPERADMIN. Un usuario de un negocio va a su inicio (el proxy ya le contesta 403 antes de llegar).
    const sesion = await sesionActual();
    if (!sesion) redirect("/login");
    if (!puedeTodo(sesion, acciones) || sesion.rol !== "SUPERADMIN") redirect(rutaDeInicio(sesion.rol));
    return sesion;
  }
  const usuario = await requiereUsuario();
  if (!puedeTodo(usuario, acciones)) redirect(rutaDeInicio(usuario.rol));
  return usuario;
}
