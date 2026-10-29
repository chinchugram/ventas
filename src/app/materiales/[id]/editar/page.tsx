import Link from "next/link";
import { notFound } from "next/navigation";
import { Seccion } from "@/components/ui";
import { fmtNumero } from "@/lib/money";
import { estadoDemo } from "@/lib/respaldo";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { serializarArticulos } from "@/lib/materiales";
import { getMaterialParaEditar } from "@/lib/queries/materiales";
import { MaterialForm } from "../../_componentes/material-form";
import { EstadoMaterialBoton } from "../../_componentes/estado-material-boton";

export const dynamic = "force-dynamic";

export default async function EditarMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await getMaterialParaEditar(id);
  if (!material) notFound();

  const unidad = ETIQUETA_UNIDAD[material.unidad] ?? material.unidad;
  const usos = material.articulos.length;
  const textoUsos = usos === 1 ? "1 artículo activo lo usa" : `${usos} artículos activos lo usan`;
  const boton = "inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700";

  return (
    <>
      <Seccion
        titulo={material.activo ? "Editar material" : material.nombre}
        descripcion={material.activo ? material.nombre : "Material dado de baja"}
        accion={
          <div className="flex gap-2">
            {material.activo ? (
              <Link href={`/materiales/${material.id}`} className={boton}>
                Movimientos
              </Link>
            ) : null}
            <Link href={material.activo ? "/materiales" : "/materiales?bajas=1"} className={boton}>
              Volver
            </Link>
          </div>
        }
      />

      {material.activo ? (
        <>
          <MaterialForm
            iniciales={{
              nombre: material.nombre,
              unidad: material.unidad,
              stockMinimo: material.stockMinimo.toString(),
              costoUnitario: material.costoUnitario.toString(),
              precioVenta: material.precioVenta?.toString() ?? "",
              notas: material.notas ?? "",
            }}
            edicion={{
              id: material.id,
              stockActual: `${fmtNumero(material.stockActual)} ${unidad}`,
              unidadBloqueada: material.unidadBloqueada,
              articulos: serializarArticulos(material.articulos),
              costoHoraManoObra: material.costoHoraManoObra.toString(),
              margenObjetivoPct: material.margenObjetivoPct.toString(),
            }}
            esModoDemo={estadoDemo().activo}
          />

          <section className="mt-8 space-y-3 rounded-xl border border-red-100 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Dar de baja</h2>
            <p className="text-sm text-slate-500">
              Deja de ofrecerse en compras nuevas. Conserva su historial y se puede reactivar.
            </p>
            {usos > 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                Ojo: {textoUsos} en la receta. La receta lo sigue costeando y descontando: cambiala si ya no lo usás.
              </p>
            ) : null}
            <EstadoMaterialBoton id={material.id} activo />
          </section>
        </>
      ) : (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">
            Está dado de baja: no aparece en compras nuevas ni en el listado principal. Stock:{" "}
            {fmtNumero(material.stockActual)} {unidad}.
          </p>
          {usos > 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {textoUsos} en la receta: se sigue costeando y descontando aunque esté de baja.
            </p>
          ) : null}
          <EstadoMaterialBoton id={material.id} activo={false} />
        </div>
      )}
    </>
  );
}
