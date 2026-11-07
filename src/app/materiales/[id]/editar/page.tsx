import { notFound } from "next/navigation";
import { requierePermisoPagina } from "@/lib/permisos";
import { Aviso, Boton, Panel, Seccion, TituloBloque } from "@/components/ui";
import { fmtNumero } from "@/lib/money";
import { estadoDemo } from "@/lib/respaldo";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { serializarArticulos } from "@/lib/materiales";
import { getMaterialParaEditar } from "@/lib/queries/materiales";
import { MaterialForm } from "../../_componentes/material-form";
import { EstadoMaterialBoton } from "../../_componentes/estado-material-boton";

export const dynamic = "force-dynamic";

export default async function EditarMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  // El formulario muestra costo y el impacto en margen de las recetas: hacen falta los tres permisos.
  await requierePermisoPagina("editarMateriales", "verCostos", "verMargenes");
  const { id } = await params;
  const material = await getMaterialParaEditar(id);
  if (!material) notFound();

  const unidad = ETIQUETA_UNIDAD[material.unidad] ?? material.unidad;
  const usos = material.articulos.length;
  const textoUsos = usos === 1 ? "1 artículo activo lo usa" : `${usos} artículos activos lo usan`;

  return (
    <>
      <Seccion
        epigrafe={material.activo ? "Material" : "Fuera de circulación"}
        titulo={material.activo ? "Editar material" : material.nombre}
        descripcion={material.activo ? material.nombre : "Material dado de baja"}
        accion={
          <div className="flex flex-wrap gap-2">
            {material.activo ? (
              <Boton href={`/materiales/${material.id}`} variante="secundario">
                Movimientos
              </Boton>
            ) : null}
            <Boton href={material.activo ? "/materiales" : "/materiales?bajas=1"} variante="secundario">
              Volver
            </Boton>
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

          <Panel como="section" className="mt-8 space-y-3">
            <TituloBloque className="mb-1">Dar de baja</TituloBloque>
            <p className="text-body-sm text-ink-muted">
              Deja de ofrecerse en compras nuevas. Conserva su historial y se puede reactivar.
            </p>
            {usos > 0 ? (
              <Aviso tono="aviso" titulo="Ojo">
                {textoUsos} en la receta. La receta lo sigue costeando y descontando: cambiala si ya no lo usás.
              </Aviso>
            ) : null}
            <EstadoMaterialBoton id={material.id} activo />
          </Panel>
        </>
      ) : (
        <Panel className="space-y-3">
          <p className="text-body text-ink-muted">
            Está dado de baja: no aparece en compras nuevas ni en el listado principal. Stock: {fmtNumero(material.stockActual)}{" "}
            {unidad}.
          </p>
          {usos > 0 ? (
            <Aviso tono="aviso">{textoUsos} en la receta: se sigue costeando y descontando aunque esté de baja.</Aviso>
          ) : null}
          <EstadoMaterialBoton id={material.id} activo={false} />
        </Panel>
      )}
    </>
  );
}
