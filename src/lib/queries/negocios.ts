import type { RolConSuperadmin } from "@/lib/auth-pura";
import { ErrorDeNegocio } from "@/lib/acciones";
import { puede } from "@/lib/permisos-pura";
import { conSuperadmin } from "@/lib/negocio";
import { conRespaldo } from "@/lib/respaldo";

// Lectura de /admin/negocios. El SUPERADMIN ve de cada negocio SOLO nombre, identificador, estado y
// cantidad de usuarios: nada de sus datos. Las cuentas y los datos de un negocio estan bajo RLS y este
// contexto (`conSuperadmin` sin negocio) no los ve; la cantidad de usuarios sale de `usuarios_por_negocio()`,
// una funcion de la base que solo devuelve conteos (migracion `superadmin_sesiones_rls`).

export type NegocioListado = {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;
  creadoEn: Date;
  /** Cantidad de usuarios (activos o no). 0 = todavia no tiene dueno: se le puede crear el primero. */
  usuarios: number;
  /** De esos, cuantos estan activos. */
  usuariosActivos: number;
};

export type ListaDeNegocios = {
  /** Sin base: la pantalla esta en modo demostracion y no hay negocios que mostrar. */
  esDemo: boolean;
  negocios: NegocioListado[];
};

/** Todos los negocios (activos primero, por nombre). Solo para quien puede `administrarNegocios`. */
export async function getNegocios(actor: { rol: RolConSuperadmin } | null | undefined): Promise<ListaDeNegocios> {
  if (!puede(actor, "administrarNegocios")) throw new ErrorDeNegocio("No tenés permiso para administrar los negocios.");
  return conRespaldo<ListaDeNegocios>(
    async () => {
      const { negocios, cuentas } = await conSuperadmin(async (tx) => ({
        negocios: await tx.negocio.findMany({
          select: { id: true, nombre: true, slug: true, activo: true, creadoEn: true },
          orderBy: [{ activo: "desc" }, { nombre: "asc" }],
        }),
        cuentas: await tx.$queryRaw<{ negocioId: string; usuarios: number; activos: number }[]>`
          SELECT "negocioId", "usuarios", "activos" FROM usuarios_por_negocio()`,
      }));
      const porNegocio = new Map(cuentas.map((c) => [c.negocioId, c]));
      return {
        esDemo: false,
        negocios: negocios.map((n) => ({
          ...n,
          usuarios: porNegocio.get(n.id)?.usuarios ?? 0,
          usuariosActivos: porNegocio.get(n.id)?.activos ?? 0,
        })),
      };
    },
    () => ({ esDemo: true, negocios: [] }),
  );
}
