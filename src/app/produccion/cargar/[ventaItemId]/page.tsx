import { notFound } from "next/navigation";
import { Aviso, Boton, Panel, Seccion } from "@/components/ui";
import { hoyArgentinaISO } from "@/lib/acciones";
import { fmtNumero } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { getLineaParaCarga } from "@/lib/queries/produccion";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { CargarTrabajoForm } from "../../_componentes/cargar-trabajo-form";

export const dynamic = "force-dynamic";

export default async function CargarTrabajoPage({ params }: { params: Promise<{ ventaItemId: string }> }) {
  const usuario = await requierePermisoPagina("cargarProduccion");
  const { ventaItemId } = await params;
  const linea = await getLineaParaCarga(ventaItemId);
  if (!linea) notFound();

  const volver = (
    <Boton href="/produccion" variante="secundario">
      Volver
    </Boton>
  );

  return (
    <>
      <Seccion
        epigrafe="Producción"
        titulo="Cargar trabajo"
        descripcion={`${linea.descripcion} · ${fmtNumero(linea.cantidad)} u · venta #${linea.numero}/${linea.anio} · ${linea.cliente}`}
        accion={volver}
      />

      {linea.ventaAnulada ? (
        <Aviso tono="aviso" titulo="La venta está anulada.">
          No se carga producción de una venta anulada.
        </Aviso>
      ) : linea.trabajoVigenteId ? (
        <Panel className="space-y-3">
          <p className="text-body text-ink">Esta línea ya tiene un trabajo cargado. Para corregirlo, anulalo y cargalo de nuevo.</p>
          <Boton href={`/produccion/trabajo/${linea.trabajoVigenteId}`} variante="secundario">
            Ver el trabajo cargado
          </Boton>
        </Panel>
      ) : (
        <CargarTrabajoForm
          ventaItemId={linea.ventaItemId}
          hoyISO={hoyArgentinaISO()}
          maquinas={linea.maquinas}
          materiales={linea.materiales.map((m) => ({ ...m, unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad }))}
          sugerencia={linea.sugerencia}
          recetaEnStock={linea.recetaEnStock}
          yaAjustado={linea.yaAjustado}
          puedeAjustarStock={puede(usuario, "ajustarStock")}
        />
      )}
    </>
  );
}
