import { getConfig } from "@/lib/queries/catalogo";
import { getIvaPorDefecto } from "@/lib/queries/configuracion";
import { getCatalogoCostos } from "@/lib/queries/recetas";
import { estadoDemo } from "@/lib/respaldo";
import { Boton, Seccion } from "@/components/ui";
import { ArticuloForm } from "../_componentes/articulo-form";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/** Alta de articulo con su receta. */
export default async function NuevoArticuloPage() {
  await requierePermisoPagina("editarCatalogo", "verCostos", "verMargenes");
  const [config, catalogo, ivaPorDefecto] = await Promise.all([getConfig(), getCatalogoCostos(), getIvaPorDefecto()]);

  return (
    <>
      <Seccion
        epigrafe="Lo que vendés"
        titulo="Nuevo artículo"
        descripcion="Precio, IVA y receta: el costo y el margen se calculan solos"
        accion={
          <Boton href="/catalogo" variante="secundario">
            Volver
          </Boton>
        }
      />
      <ArticuloForm
        catalogo={catalogo}
        costoHoraManoObra={config.costoHoraManoObra ?? "0"}
        margenObjetivo={config.margenObjetivo ?? "40"}
        ivaDefault={ivaPorDefecto.toString()}
        esModoDemo={estadoDemo().activo}
      />
    </>
  );
}
