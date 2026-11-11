import Link from "next/link";
import { notFound } from "next/navigation";
import { Aviso, Boton, Etiqueta, Panel, Seccion, TituloBloque } from "@/components/ui";
import { fmtFecha, fmtNumero } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { fmtMinutos } from "@/lib/produccion";
import { getTrabajoDetalle } from "@/lib/queries/produccion";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { AjustarStockForm } from "../../_componentes/ajustar-stock-form";
import { AnularTrabajoForm } from "../../_componentes/anular-trabajo-form";

export const dynamic = "force-dynamic";

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
        epigrafe="Trabajo cargado"
        titulo="Trabajo de producción"
        descripcion={`${t.descripcion} · ${fmtNumero(t.cantidad)} u · venta #${t.numero}/${t.anio} · ${t.cliente}`}
        accion={
          <Boton href="/produccion" variante="secundario">
            Volver
          </Boton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {vigente ? <Etiqueta tono="ok">Cargado</Etiqueta> : <Etiqueta tono="critico">Anulado</Etiqueta>}
        <Link href={`/ventas/${t.ventaId}`} className="enlace inline-flex min-h-11 items-center">
          Ver venta
        </Link>
      </div>

      {!vigente ? (
        <Aviso tono="critico" role="status" titulo={`Anulado el ${fechaHoraAR(t.anuladoEn!)}`} className="mb-4">
          <p>{t.motivoAnulacion}</p>
          {t.ventaAnulada ? (
            <p className="mt-1">La venta está anulada: no se vuelve a cargar.</p>
          ) : t.lineaTieneVigente ? (
            <p className="mt-1">La línea ya tiene otro trabajo cargado.</p>
          ) : (
            <Link href={`/produccion/cargar/${t.ventaItemId}`} className="enlace mt-1 inline-flex min-h-11 items-center">
              Cargar de nuevo
            </Link>
          )}
        </Aviso>
      ) : null}

      <p className="mb-4 text-body-sm text-ink-muted">
        Trabajo del {fmtFecha(t.fecha)} · cargado por {t.cargadoPor ?? "—"} el {fechaHoraAR(t.creadoEn)}
      </p>

      <Panel como="section" className="mb-4" aria-label="Tiempos">
        <TituloBloque>Tiempos</TituloBloque>
        <ul className="divide-y-(length:--border-width) divide-line">
          {t.tiempos.map((x) => (
            <li key={x.maquina} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 break-words text-ink">{x.maquina}</span>
              <span className="shrink-0 font-mono text-mono tabular-nums text-ink">{fmtMinutos(x.minutos)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 py-2">
            <span className="text-ink">Mano de obra</span>
            <span className="shrink-0 font-mono text-mono tabular-nums text-ink">{fmtMinutos(t.minutosManoObra)}</span>
          </li>
        </ul>
      </Panel>

      <Panel como="section" className="mb-4" aria-label="Materiales">
        <TituloBloque>Materiales usados</TituloBloque>
        {t.consumos.length === 0 ? (
          <p className="text-body-sm text-ink-muted">No se cargaron materiales.</p>
        ) : (
          <ul className="divide-y-(length:--border-width) divide-line">
            {t.consumos.map((c) => (
              <li key={c.materialId} className="py-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 break-words text-ink">{c.material}</span>
                  <span className="shrink-0 font-mono text-mono tabular-nums text-ink">
                    {fmtNumero(c.real)} {unidad(c.unidad)}
                  </span>
                </div>
                <p className="text-body-sm text-ink-muted">
                  {c.receta === null ? "No está en la receta" : `Receta: ${fmtNumero(c.receta)} ${unidad(c.unidad)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {t.notas ? <Panel className="mb-4 text-body break-words whitespace-pre-line text-ink-muted">{t.notas}</Panel> : null}

      {vigente && conDiferencia.length + pendientes.length > 0 ? (
        <Panel como="section" className="mb-4" aria-label="Stock">
          <TituloBloque className="mb-1">Stock contra la receta</TituloBloque>
          <p className="mb-3 text-body-sm text-ink-muted">
            Cargar el consumo no mueve el stock: la venta ya descontó lo de la receta. Estas son las diferencias de lo realmente usado.
          </p>
          <ul className="mb-3 divide-y-(length:--border-width) divide-line">
            {t.ajuste.map((f) => (
              <li key={f.materialId} className="py-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0 break-words text-ink">{f.material}</span>
                  <span className="shrink-0 font-mono text-mono tabular-nums text-ink">
                    {f.diferencia.isZero() ? "Sin diferencia" : `${f.diferencia.gt(0) ? "+" : "−"}${fmtNumero(f.diferencia.abs())} ${unidad(f.unidad)}`}
                  </span>
                </div>
                {!f.yaAjustado.isZero() ? (
                  <p className="text-body-sm text-ink-muted">
                    Ya ajustado en el stock: {f.yaAjustado.gt(0) ? "+" : "−"}
                    {fmtNumero(f.yaAjustado.abs())} {unidad(f.unidad)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {pendientes.length === 0 ? (
            <p className="text-body-sm font-semibold text-ok-text">El stock ya está ajustado a lo realmente usado.</p>
          ) : puedeAjustar && !t.ventaAnulada ? (
            <>
              <Aviso tono="aviso" titulo="Ajuste pendiente" className="mb-3">
                <ul aria-label="Ajuste pendiente">
                  {pendientes.map((f) => (
                    <li key={f.materialId}>
                      {f.material}: el stock {f.movimiento.lt(0) ? "baja" : "sube"} {fmtNumero(f.movimiento.abs())} {unidad(f.unidad)}
                    </li>
                  ))}
                </ul>
              </Aviso>
              <AjustarStockForm trabajoId={t.id} />
            </>
          ) : (
            <p className="text-body-sm text-ink-muted">El ajuste del stock lo hace el dueño.</p>
          )}
        </Panel>
      ) : null}

      {vigente ? <AnularTrabajoForm trabajoId={t.id} /> : null}

      {t.anulados.length > 0 ? (
        <Panel como="section" className="mt-4" aria-label="Historial">
          <TituloBloque>Trabajos anulados de esta línea</TituloBloque>
          <ul className="divide-y-(length:--border-width) divide-line">
            {t.anulados.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/produccion/trabajo/${a.id}`} className="enlace inline-flex min-h-11 items-center">
                  Trabajo del {fmtFecha(a.fecha)}
                </Link>
                <p className="break-words text-body-sm text-critico-text">
                  Anulado el {fechaHoraAR(a.anuladoEn)}: {a.motivoAnulacion}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
