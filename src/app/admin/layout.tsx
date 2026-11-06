import { salir } from "@/app/login/actions";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/**
 * Marco de /admin/**: solo el SUPERADMIN. Este layout no protege nada por si solo (no se vuelve a ejecutar
 * en las navegaciones del cliente): protegen el proxy (403 a cualquier otro rol) y cada pagina. El
 * SUPERADMIN no tiene negocio, asi que no hay la navegacion de un negocio: solo este encabezado.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actual = await requierePermisoPagina("administrarNegocios");
  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <p className="text-sm font-semibold text-slate-900">
          Administración <span className="font-normal text-slate-500">· {actual.nombre}</span>
        </p>
        <form action={salir}>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Salir
          </button>
        </form>
      </header>
      {children}
    </>
  );
}
