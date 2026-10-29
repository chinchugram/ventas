import Link from "next/link";
import { dbDisponible } from "@/lib/prisma";
import { Seccion } from "@/components/ui";
import { MaquinaForm } from "../../_componentes/maquina-form";

export const dynamic = "force-dynamic";

export default async function NuevaMaquinaPage() {
  // Esta pantalla no consulta nada: el modo demo se decide mirando la base.
  const esModoDemo = !(await dbDisponible());
  return (
    <>
      <Seccion
        titulo="Nueva máquina"
        descripcion="Un recurso de producción con su costo por hora"
        accion={
          <Link
            href="/configuracion"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <MaquinaForm esModoDemo={esModoDemo} />
    </>
  );
}
