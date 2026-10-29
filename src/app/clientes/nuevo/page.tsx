import Link from "next/link";
import { dbDisponible } from "@/lib/prisma";
import { Seccion } from "@/components/ui";
import { ClienteForm } from "../_componentes/cliente-form";

export const dynamic = "force-dynamic";

export default async function NuevoClientePage() {
  const esModoDemo = !(await dbDisponible());

  return (
    <>
      <Seccion
        titulo="Nuevo cliente"
        descripcion="Solo el nombre es obligatorio"
        accion={
          <Link
            href="/clientes"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <ClienteForm esModoDemo={esModoDemo} />
    </>
  );
}
