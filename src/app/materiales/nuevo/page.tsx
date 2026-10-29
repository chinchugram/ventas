import Link from "next/link";
import { Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { getMateriales } from "@/lib/queries/materiales";
import { MaterialForm } from "../_componentes/material-form";

export const dynamic = "force-dynamic";

export default async function NuevoMaterialPage() {
  // Se consulta la base solo para saber si hay que avisar del modo demostracion.
  await getMateriales();

  return (
    <>
      <Seccion
        titulo="Nuevo material"
        descripcion="Insumo de producción, producto de reventa o las dos cosas"
        accion={
          <Link
            href="/materiales"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />
      <MaterialForm
        iniciales={{ nombre: "", unidad: "", stockMinimo: "", costoUnitario: "", precioVenta: "", notas: "" }}
        esModoDemo={estadoDemo().activo}
      />
    </>
  );
}
