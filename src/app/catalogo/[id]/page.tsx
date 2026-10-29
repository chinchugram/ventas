import Link from "next/link";
import { notFound } from "next/navigation";
import { getConfig } from "@/lib/queries/catalogo";
import { getIvaPorDefecto } from "@/lib/queries/configuracion";
import { getEditorArticulo } from "@/lib/queries/recetas";
import { estadoDemo } from "@/lib/respaldo";
import { Seccion } from "@/components/ui";
import { ArticuloForm } from "../_componentes/articulo-form";
import { BotonActivoArticulo } from "../_componentes/boton-activo";

export const dynamic = "force-dynamic";

/** Edicion de un articulo y su receta, con baja y reactivacion. */
export default async function EditarArticuloPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [config, editor, ivaPorDefecto] = await Promise.all([getConfig(), getEditorArticulo(id), getIvaPorDefecto()]);
  if (!editor) notFound();

  const { articulo, catalogo } = editor;
  const esModoDemo = estadoDemo().activo;

  return (
    <>
      <Seccion
        titulo={articulo.nombre}
        descripcion="Datos, receta, costo y margen"
        accion={
          <Link
            href="/catalogo"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />

      {!articulo.activo ? (
        <div className="mb-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            Este artículo está <span className="font-semibold">dado de baja</span>: no aparece en el catálogo ni en
            las ventas nuevas.
          </p>
          <BotonActivoArticulo id={articulo.id} activo={false} />
        </div>
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
