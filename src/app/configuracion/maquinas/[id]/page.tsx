import Link from "next/link";
import { notFound } from "next/navigation";
import { estadoDemo } from "@/lib/respaldo";
import { getMaquina } from "@/lib/queries/configuracion";
import { Seccion } from "@/components/ui";
import { MaquinaForm } from "../../_componentes/maquina-form";
import { EstadoMaquinaBoton } from "../../_componentes/estado-maquina-boton";

export const dynamic = "force-dynamic";

export default async function MaquinaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const maquina = await getMaquina(id);
  if (!maquina) notFound();

  return (
    <>
      <Seccion
        titulo={maquina.nombre}
        descripcion={maquina.activo ? "Editar máquina" : "Máquina dada de baja"}
        accion={
          <Link
            href="/configuracion"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />

      {maquina.activo ? null : (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Esta máquina está dada de baja.
          {maquina.recetas > 0
            ? ` Sigue en ${maquina.recetas} ${maquina.recetas === 1 ? "receta" : "recetas"}, que la siguen costeando con su costo/hora: revisalas o reactivala.`
            : " No la usa ninguna receta."}
        </p>
      )}

      <div className="mb-4">
        <MaquinaForm
          id={maquina.id}
          inicial={{ nombre: maquina.nombre, costoHora: maquina.costoHora.toString(), notas: maquina.notas ?? "" }}
          recetas={maquina.recetas}
          esModoDemo={estadoDemo().activo}
        />
      </div>

      <EstadoMaquinaBoton id={maquina.id} activo={maquina.activo} recetas={maquina.recetas} />
    </>
  );
}
