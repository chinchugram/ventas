import { ErrorDeNegocio } from "@/lib/acciones";
import type { Rol, UsuarioSesion } from "@/lib/auth-pura";
import { puede } from "@/lib/permisos-pura";
import { SIN_PERMISO_USUARIOS } from "@/lib/dominio/usuarios";
import { dbDisponible, prisma } from "@/lib/prisma";

// Lecturas de la administracion de usuarios. Solo para quien puede
// `gestionarUsuarios` (se verifica aca tambien, no solo en la pagina). Se eligen
// los campos a mano: `hashClave` y los datos de sesion no se leen nunca, asi que
// no pueden viajar al navegador ni por error.

export type UsuarioListado = {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  creadoEn: Date;
  /** Esta en pausa por intentos fallidos de entrada (no puede entrar hasta que pase o se le cambie la clave). */
  enPausa: boolean;
};

export type ListaDeUsuarios = {
  /** Sin base: la pantalla esta en modo demostracion y no hay usuarios que mostrar. */
  esDemo: boolean;
  usuarios: UsuarioListado[];
  /** Cantidad de duenos activos: para avisar que el ultimo no se puede dar de baja. */
  duenosActivos: number;
};

const SELECCION = {
  id: true,
  usuario: true,
  nombre: true,
  rol: true,
  activo: true,
  creadoEn: true,
  bloqueadoHasta: true,
} as const;

function aListado(u: {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  creadoEn: Date;
  bloqueadoHasta: Date | null;
}): UsuarioListado {
  return {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    activo: u.activo,
    creadoEn: u.creadoEn,
    enPausa: u.bloqueadoHasta !== null && u.bloqueadoHasta.getTime() > Date.now(),
  };
}

function exigirPermiso(actor: UsuarioSesion | null | undefined): asserts actor is UsuarioSesion {
  if (!puede(actor, "gestionarUsuarios")) throw new ErrorDeNegocio(SIN_PERMISO_USUARIOS);
}

/** Activos primero, duenos antes que empleados, y por nombre. */
export async function getUsuarios(actor: UsuarioSesion | null | undefined): Promise<ListaDeUsuarios> {
  exigirPermiso(actor);
  if (!(await dbDisponible())) return { esDemo: true, usuarios: [], duenosActivos: 0 };

  const filas = await prisma.usuario.findMany({
    select: SELECCION,
    orderBy: [{ activo: "desc" }, { rol: "asc" }, { nombre: "asc" }],
  });
  const usuarios = filas.map(aListado);
  return { esDemo: false, usuarios, duenosActivos: usuarios.filter((u) => u.rol === "DUENO" && u.activo).length };
}

export type DetalleUsuario = UsuarioListado & {
  /** No hay otro dueno activo ademas de este: no se lo puede dar de baja ni degradar. */
  esUltimoDuenoActivo: boolean;
};

/** Un usuario por id (que el llamador ya valido como UUID), o `null` si no existe o no hay base. */
export async function getUsuario(actor: UsuarioSesion | null | undefined, id: string): Promise<DetalleUsuario | null> {
  exigirPermiso(actor);
  if (!(await dbDisponible())) return null;

  const fila = await prisma.usuario.findUnique({ where: { id }, select: SELECCION });
  if (!fila) return null;
  const otros =
    fila.rol === "DUENO" && fila.activo
      ? await prisma.usuario.count({ where: { rol: "DUENO", activo: true, id: { not: id } } })
      : 1;
  return { ...aListado(fila), esUltimoDuenoActivo: otros === 0 };
}
