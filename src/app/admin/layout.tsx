import { salir } from "@/app/login/actions";
import { LogoKiwitt } from "@/components/logo-kiwitt";
import { InterruptorSonido } from "@/components/sonido";
import { claseBoton } from "@/components/ui";
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
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b-(length:--border-width) border-line pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <LogoKiwitt variante="isotipo" />
          <p className="min-w-0 text-body font-bold text-ink">
            Administración <span className="font-normal text-ink-muted">· {actual.nombre}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sonido (momentos.md): el interruptor va en todas las pantallas; acá no hay navbar. */}
          <InterruptorSonido conTexto={false} className="min-h-11 px-3" />
          <form action={salir}>
            <button type="submit" className={claseBoton({ variante: "secundario" })}>
              Salir
            </button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
