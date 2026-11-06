import Link from "next/link";
import { notFound } from "next/navigation";
import { Seccion } from "@/components/ui";
import { fmtFecha, fmtNumero } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { fmtMinutos } from "@/lib/produccion";
import { getTrabajoDetalle } from "@/lib/queries/produccion";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { AjustarStockForm } from "../../_componentes/ajustar-stock-form";
import { AnularTrabajoForm } from "../../_componentes/anular-trabajo-form";

export const dynamic = "force-dynamic";

const ENLACE = "inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700";

function fechaHoraAR(momento: Date): string {
  return momento.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TrabajoPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requierePermisoPagina("cargarProduccion");
  const { id } = await params;
  const t = await getTrabajoDetalle(id);
  if (!t) notFound();

  const vigente = t.anuladoEn === null;
  const puedeAjustar = puede(usuario, "ajustarStock");
  const unidad = (u: string) => ETIQUETA_UNIDAD[u] ?? u;
  const conDiferencia = t.ajuste.filter((f) => !f.diferencia.isZero());
  const pendientes = t.ajuste.filter((f) => !f.movimiento.isZero());

  return (
    <>
      <Seccion
        titulo="Trabajo de producción"
        descripcion={`${t.descripcion} · ${fmtNumero(t.cantidad)} u · venta #${t.numero}/${t.anio} · ${t.cliente}`}
        accion={
          <Link href="/produccion" className={ENLACE}>
            Volver
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {vigente ? (
          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Cargado</span>
        ) : (
          <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">Anulado</span>
        )}
        <Link href={`/ventas/${t.ventaId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline underline-offset-2">
          Ver venta
        </Link>
      </div>

      {!vigente ? (
        <div role="status" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p>
            Anulado el {fechaHoraAR(t.anuladoEn!)}: {t.motivoAnulacion}
          </p>
          {t.ventaAnulada ? (
            <p className="mt-1">La venta está anulada: no se vuelve a cargar.</p>
          ) : t.lineaTieneVigente ? (
            <p className="mt-1">La línea ya tiene otro trabajo cargado.</p>
          ) : (
            <Link href={`/produccion/cargar/${t.ventaItemId}`} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
              Cargar de nuevo
            </Link>
          )}
        </div>
      ) : null}

      <p className="mb-4 text-sm text-slate-500">
        Trabajo del {fmtFecha(t.fecha)} · cargado por {t.cargadoPor ?? "—"} el {fechaHoraAR(t.creadoEn)}
      </p>

      <section aria-label="Tiempos" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Tiempos</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {t.tiempos.map((x) => (
            <li key={x.maquina} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 break-words text-slate-900">{x.maquina}</span>
              <span className="shrink-0 tabular-nums text-slate-900">{fmtMinutos(x.minutos)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 py-2">
            <span className="text-slate-900">Mano de obra</span>
            <span className="shrink-0 tabular-nums text-slate-900">{fmtMinutos(t.minutosManoObra)}</span>
          </li>
        </ul>
      </section>

      <section aria-label="Materiales" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Materiales usados</h2>
        {t.consumos.length === 0 ? (
          <p className="text-sm text-slate-500">No se cargaron materiales.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {t.consumos.map((c) => (
              <li key={c.materialId} className="py-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 break-words text-slate-900">{c.material}</span>
                  <span className="shrink-0 tabular-nums text-slate-900">
                    {fmtNumero(c.real)} {unidad(c.unidad)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{c.receta === null ? "No está en la receta" : `Receta: ${fmtNumero(c.receta)} ${unidad(c.unidad)}`}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {t.notas ? <p className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm break-words whitespace-pre-line text-slate-700">{t.notas}</p> : null}

      {vigente && conDiferencia.length + pendientes.length > 0 ? (
        <section aria-label="Stock" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Stock contra la receta</h2>
          <p className="mb-2 text-sm text-slate-600">
            Cargar el consumo no mueve el stock: la venta ya descontó lo de la receta. Estas son las diferencias de lo realmente usado.
          </p>
          <ul className="mb-3 divide-y divide-slate-100 text-sm">
            {t.ajuste.map((f) => (
              <li key={f.materialId} className="py-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 break-words text-slate-900">{f.material}</span>
                  <span className="shrink-0 tabular-nums text-slate-900">
                    {f.diferencia.isZero() ? "Sin diferencia" : `${f.diferencia.gt(0) ? "+" : "−"}${fmtNumero(f.diferencia.abs())} ${unidad(f.unidad)}`}
                  </span>
                </div>
                {!f.yaAjustado.isZero() ? (
                  <p className="text-xs text-slate-500">
                    Ya ajustado en el stock: {f.yaAjustado.gt(0) ? "+" : "−"}
                    {fmtNumero(f.yaAjustado.abs())} {unidad(f.unidad)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {pendientes.length === 0 ? (
            <p className="text-sm text-emerald-800">El stock ya está ajustado a lo realmente usado.</p>
          ) : puedeAjustar && !t.ventaAnulada ? (
            <>
              <ul aria-label="Ajuste pendiente" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {pendientes.map((f) => (
                  <li key={f.materialId}>
                    {f.material}: el stock {f.movimiento.lt(0) ? "baja" : "sube"} {fmtNumero(f.movimiento.abs())} {unidad(f.unidad)}
                  </li>
                ))}
              </ul>
              <AjustarStockForm trabajoId={t.id} />
            </>
          ) : (
            <p className="text-sm text-slate-600">El ajuste del stock lo hace el dueño.</p>
          )}
        </section>
      ) : null}

      {vigente ? <AnularTrabajoForm trabajoId={t.id} /> : null}

      {t.anulados.length > 0 ? (
        <section aria-label="Historial" className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Trabajos anulados de esta línea</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {t.anulados.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/produccion/trabajo/${a.id}`} className="font-medium text-slate-800 underline underline-offset-2">
                  Trabajo del {fmtFecha(a.fecha)}
                </Link>
                <p className="break-words text-xs text-red-700">
                  Anulado el {fechaHoraAR(a.anuladoEn)}: {a.motivoAnulacion}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
