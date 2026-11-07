import { dbDisponible } from "@/lib/prisma";
import { requierePermisoPagina } from "@/lib/permisos";
import { Boton, Seccion } from "@/components/ui";
import { ListaForm } from "../_componentes/lista-form";

export const dynamic = "force-dynamic";

export default async function NuevaListaPage() {
  await requierePermisoPagina("gestionarListasPrecios");
  const esModoDemo = !(await dbDisponible());

  return (
    <>
      <Seccion
        epigrafe="Precios por cliente"
        titulo="Nueva lista de precios"
        descripcion="Primero el nombre y el descuento; los precios específicos se cargan después"
        accion={
          <Boton href="/listas-precios" variante="secundario">
            Volver
          </Boton>
        }
      />
      <ListaForm esModoDemo={esModoDemo} />
    </>
  );
}
