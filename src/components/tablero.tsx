import { fmtMonedaCorta, fmtPorcentaje, type Dinero } from "@/lib/money";
import { LogroMeta } from "@/components/momentos";
import { Etiqueta, Sticker } from "@/components/ui";

function acotar(valor: number, min: number, max: number): number {
  return Math.min(Math.max(valor, min), max);
}

/**
 * Lo primero que mira el dueño: cuanto gano este mes y si va bien contra su
 * meta. El resto de los numeros del tablero explican este.
 */
export function GananciaDelMes({
  ganancia,
  margenPct,
  metaPct,
}: {
  ganancia: Dinero;
  margenPct: Dinero;
  metaPct: Dinero;
}) {
  const margen = Number(margenPct.toString());
  const meta = Number(metaPct.toString());
  const sobreMeta = margen >= meta;
  const valor = fmtMonedaCorta(ganancia);

  return (
    <section className="tarjeta p-5 sm:p-6" aria-labelledby="ganancia-del-mes">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="ganancia-del-mes" className="eyebrow">
          Ganancia del mes
        </h2>
        {/* El acento de ventas (cielo) es el color fuerte de esta pantalla: marca el margen. */}
        <Sticker acento="cielo" className="tabular-nums">
          Margen {fmtPorcentaje(margenPct)}
        </Sticker>
      </div>
      <p
        className={`monto mt-2 whitespace-nowrap text-ink ${valor.length > 13 ? "" : "sm:text-display-lg"}`}
      >
        {valor}
      </p>

      <div className="mt-5">
        <div
          className="borde relative h-3 rounded-full border-line-strong bg-surface-sunken"
          role="img"
          aria-label={`Margen ${fmtPorcentaje(margenPct)} sobre una meta de ${fmtPorcentaje(metaPct)}`}
        >
          <div className="h-full rounded-full bg-cielo" style={{ width: `${acotar(margen, 0, 100)}%` }} />
          {/* Marca de la meta. */}
          <div
            className="absolute -top-1.5 h-5 w-1 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: `${acotar(meta, 0, 100)}%` }}
          />
        </div>
        <p className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-body-sm text-ink-muted">
          <span>
            Meta de margen <span className="font-bold tabular-nums text-ink">{fmtPorcentaje(metaPct)}</span>
          </span>
          {/* Momento "logro" (momentos.md): la primera vez del mes arriba de la meta, estallido (sin sonido: es al cargar). */}
          <LogroMeta activo={sobreMeta}>
            <Etiqueta tono={sobreMeta ? "ok" : "aviso"}>{sobreMeta ? "Arriba de la meta" : "Debajo de la meta"}</Etiqueta>
          </LogroMeta>
        </p>
      </div>
    </section>
  );
}

export type DiaVentas = { clave: string; dia: string; total: number; hoy: boolean };

/** "2026-10-29" -> "29 de octubre" para el lector de pantalla (la barra solo muestra el numero del dia). */
function diaCompleto(d: DiaVentas): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.clave);
  if (!m) return d.dia;
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return fecha.toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** Facturado por dia en las ultimas semanas: barras simples, sin librerias. */
export function VentasPorDia({ dias }: { dias: DiaVentas[] }) {
  const total = dias.reduce((acc, d) => acc + d.total, 0);
  const maximo = Math.max(...dias.map((d) => d.total), 0);

  return (
    <section className="tarjeta p-4 sm:p-5" aria-labelledby="ventas-por-dia">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ventas-por-dia" className="eyebrow">
          Ventas por día
        </h2>
        <p className="text-body-sm text-ink-muted">últimos {dias.length} días</p>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-body text-ink-muted">
          Ni una venta en estos {dias.length} días. Cuando cargues la próxima, aparece acá.
        </p>
      ) : (
        <>
          <p className="monto mt-1 text-ink">{fmtMonedaCorta(total)}</p>
          {/* Las barras son solo visuales (aria-hidden): los montos los lee el lector de pantalla en la tabla de abajo. */}
          <div className="mt-4 flex h-24 items-end gap-1" aria-hidden="true">
            {dias.map((d) => (
              <div key={d.clave} className="flex h-full flex-1 items-end" title={`${d.dia}: ${fmtMonedaCorta(d.total)}`}>
                <div
                  className={`w-full rounded-t-sm ${d.hoy ? "bg-brand" : d.total > 0 ? "bg-ink-muted" : "bg-line"}`}
                  style={{
                    height: d.total > 0 ? `${Math.max((d.total / maximo) * 100, 6)}%` : "var(--border-width)",
                  }}
                />
              </div>
            ))}
          </div>
          {/* En un contenedor sr-only: los estilos globales de `table` pisarian la utilidad si fuera la propia tabla. */}
          <div className="sr-only">
            <table>
              <caption>Ventas por día, últimos {dias.length} días</caption>
              <thead>
                <tr>
                  <th scope="col">Día</th>
                  <th scope="col">Facturado</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((d) => (
                  <tr key={d.clave}>
                    <th scope="row">{d.hoy ? `${diaCompleto(d)} (hoy)` : diaCompleto(d)}</th>
                    <td>{fmtMonedaCorta(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="eyebrow mt-2 flex justify-between tabular-nums" aria-hidden="true">
            <span>{dias[0]?.dia}</span>
            <span>{dias[Math.floor(dias.length / 2)]?.dia}</span>
            <span className="font-bold text-brand-text">hoy</span>
          </div>
        </>
      )}
    </section>
  );
}
