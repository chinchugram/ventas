import { dbDisponible } from "@/lib/prisma";
import { Aviso, Boton, Seccion } from "@/components/ui";
import { MaquinaForm } from "../../_componentes/maquina-form";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

export default async function NuevaMaquinaPage() {
  await requierePermisoPagina("configuracion");
  // Esta pantalla no consulta nada: el modo demo se decide mirando la base.
  const esModoDemo = !(await dbDisponible());
  return (
    <>
      <Seccion
        epigrafe="Configuración"
        titulo="Nueva máquina"
        descripcion="Un recurso de producción con su costo por hora"
        accion={
          <Boton href="/configuracion" variante="secundario">
            Volver
          </Boton>
        }
      />
      <MaquinaForm esModoDemo={esModoDemo} />
    </>
  );
}
