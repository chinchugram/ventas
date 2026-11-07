import { notFound } from "next/navigation";
import { getConfig } from "@/lib/queries/catalogo";
import { getIvaPorDefecto } from "@/lib/queries/configuracion";
import { getEditorArticulo } from "@/lib/queries/recetas";
import { estadoDemo } from "@/lib/respaldo";
import { Aviso, Boton, Seccion } from "@/components/ui";
import { ArticuloForm } from "../_componentes/articulo-form";
import { BotonActivoArticulo } from "../_componentes/boton-activo";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

/** Edicion de un articulo y su receta, con baja y reactivacion. */
export default async function EditarArticuloPage({ params }: { params: Promise<{ id: string }> }) {
  await requierePermisoPagina("editarCatalogo", "verCostos", "verMargenes");
  const { id } = await params;
  const [config, editor, ivaPorDefecto] = await Promise.all([getConfig(), getEditorArticulo(id), getIvaPorDefecto()]);
  if (!editor) notFound();

  const { articulo, catalogo } = editor;
  const esModoDemo = estadoDemo().activo;

  return (
    <>
      <Seccion
        epigrafe="Artículo"
        titulo={articulo.nombre}
        descripcion="Datos, receta, costo y margen"
        accion={
          <Boton href="/catalogo" variante="secundario">
            Volver
          </Boton>
        }
      />

      {!articulo.activo ? (
        <Aviso tono="aviso" titulo="Este artículo está dado de baja." className="mb-4">
          No aparece en el catálogo ni en las ventas nuevas.
          <div className="mt-3">
            <BotonActivoArticulo id={articulo.id} activo={false} />
          </div>
        </Aviso>
      ) : null}

      <ArticuloForm
        // Al reactivar o guardar, la pagina se vuelve a renderizar: la clave
        // reinicia el formulario con lo que quedo en la base.
        key={`${articulo.id}-${articulo.activo}`}
        inicial={articulo}
        catalogo={catalogo}
        costoHoraManoObra={config.costoHoraManoObra ?? "0"}
        margenObjetivo={config.margenObjetivo ?? "40"}
        ivaDefault={ivaPorDefecto.toString()}
        esModoDemo={esModoDemo}
      />

      {articulo.activo && !esModoDemo ? (
        <div className="mt-6">
          <BotonActivoArticulo id={articulo.id} activo />
        </div>
      ) : null}
    </>
  );
}
