import { requierePermisoPagina } from "@/lib/permisos";
import { Boton, Seccion } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { getMateriales } from "@/lib/queries/materiales";
import { MaterialForm } from "../_componentes/material-form";

export const dynamic = "force-dynamic";

export default async function NuevoMaterialPage() {
  await requierePermisoPagina("editarMateriales");
  // Se consulta la base solo para saber si hay que avisar del modo demostracion.
  await getMateriales();

  return (
    <>
      <Seccion
        epigrafe="Lo que hay en el taller"
        titulo="Nuevo material"
        descripcion="Insumo de producción, producto de reventa o las dos cosas"
        accion={
          <Boton href="/materiales" variante="secundario">
            Volver
          </Boton>
        }
      />
      <MaterialForm
        iniciales={{ nombre: "", unidad: "", stockMinimo: "", costoUnitario: "", precioVenta: "", notas: "" }}
        esModoDemo={estadoDemo().activo}
      />
    </>
  );
}
