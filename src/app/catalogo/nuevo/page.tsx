import Link from "next/link";
import { getConfig } from "@/lib/queries/catalogo";
import { getIvaPorDefecto } from "@/lib/queries/configuracion";
import { getCatalogoCostos } from "@/lib/queries/recetas";
import { estadoDemo } from "@/lib/respaldo";
import { Seccion } from "@/components/ui";
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
        titulo="Nuevo artículo"
        descripcion="Precio, IVA y receta: el costo y el margen se calculan solos"
        accion={
          <Link
            href="/catalogo"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
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
