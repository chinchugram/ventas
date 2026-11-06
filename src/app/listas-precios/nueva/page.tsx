import Link from "next/link";
import { dbDisponible } from "@/lib/prisma";
import { requierePermisoPagina } from "@/lib/permisos";
import { Seccion } from "@/components/ui";
import { ListaForm } from "../_componentes/lista-form";

export const dynamic = "force-dynamic";

export default async function NuevaListaPage() {
  await requierePermisoPagina("gestionarListasPrecios");
  const esModoDemo = !(await dbDisponible());

  return (
    <>
      <Seccion
        titulo="Nueva lista de precios"
        descripcion="Primero el nombre y el descuento; los precios específicos se cargan después"
        accion={
          <Link
            href="/listas-precios"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <ListaForm esModoDemo={esModoDemo} />
    </>
  );
}
