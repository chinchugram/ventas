import Link from "next/link";
import { dbDisponible } from "@/lib/prisma";
import { getListasParaElegir } from "@/lib/queries/listas-precios";
import { Seccion } from "@/components/ui";
import { ClienteForm } from "../_componentes/cliente-form";

export const dynamic = "force-dynamic";

export default async function NuevoClientePage() {
  const [esModoDemo, listas] = await Promise.all([dbDisponible().then((ok) => !ok), getListasParaElegir(null)]);

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
      <ClienteForm esModoDemo={esModoDemo} listas={listas.map((l) => ({ valor: l.id, etiqueta: l.nombre }))} />
    </>
  );
}
