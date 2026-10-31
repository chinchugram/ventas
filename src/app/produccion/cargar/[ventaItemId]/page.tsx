import Link from "next/link";
import { notFound } from "next/navigation";
import { Seccion } from "@/components/ui";
import { hoyArgentinaISO } from "@/lib/acciones";
import { fmtNumero } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { getLineaParaCarga } from "@/lib/queries/produccion";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { CargarTrabajoForm } from "../../_componentes/cargar-trabajo-form";

export const dynamic = "force-dynamic";

const ENLACE = "inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700";

export default async function CargarTrabajoPage({ params }: { params: Promise<{ ventaItemId: string }> }) {
  const usuario = await requierePermisoPagina("cargarProduccion");
  const { ventaItemId } = await params;
  const linea = await getLineaParaCarga(ventaItemId);
  if (!linea) notFound();

  const volver = (
    <Link href="/produccion" className={ENLACE}>
      Volver
    </Link>
  );

  return (
    <>
      <Seccion
        titulo="Cargar trabajo"
        descripcion={`${linea.descripcion} · ${fmtNumero(linea.cantidad)} u · venta #${linea.numero}/${linea.anio} · ${linea.cliente}`}
        accion={volver}
      />

      {linea.ventaAnulada ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">La venta está anulada: no se carga producción.</p>
      ) : linea.trabajoVigenteId ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">Esta línea ya tiene un trabajo cargado. Para corregirlo, anulalo y cargalo de nuevo.</p>
          <Link href={`/produccion/trabajo/${linea.trabajoVigenteId}`} className={ENLACE}>
            Ver el trabajo cargado
          </Link>
        </div>
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
