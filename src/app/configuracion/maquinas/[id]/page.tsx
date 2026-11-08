import { notFound } from "next/navigation";
import { estadoDemo } from "@/lib/respaldo";
import { getMaquina } from "@/lib/queries/configuracion";
import { Aviso, Boton, Seccion } from "@/components/ui";
import { MaquinaForm } from "../../_componentes/maquina-form";
import { EstadoMaquinaBoton } from "../../_componentes/estado-maquina-boton";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

export default async function MaquinaPage({ params }: { params: Promise<{ id: string }> }) {
  await requierePermisoPagina("configuracion");
  const { id } = await params;
  const maquina = await getMaquina(id);
  if (!maquina) notFound();

  return (
    <>
      <Seccion
        epigrafe="Máquina"
        titulo={maquina.nombre}
        descripcion={maquina.activo ? "Editar máquina" : "Máquina dada de baja"}
        accion={
          <Boton href="/configuracion/maquinas" variante="secundario">
            Volver
          </Boton>
        }
      />

      {maquina.activo ? null : (
        <Aviso tono="aviso" titulo="Esta máquina está dada de baja." className="mb-4">
          {maquina.recetas > 0
            ? `Sigue en ${maquina.recetas} ${maquina.recetas === 1 ? "receta" : "recetas"}, que la siguen costeando con su costo/hora: revisalas o reactivala.`
            : "No la usa ninguna receta."}
        </Aviso>
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
