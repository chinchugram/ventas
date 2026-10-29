import { fmtMonedaCorta, fmtPorcentaje, type Dinero } from "@/lib/money";

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
    <section className="rounded-2xl bg-tinta p-5 text-white shadow-md">
      <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">Ganancia del mes</p>
      <p
        className={`mt-1 font-bold tabular-nums tracking-tight whitespace-nowrap ${
          valor.length > 13 ? "text-3xl" : "text-4xl"
        }`}
      >
        {valor}
      </p>

      <div className="mt-4">
        <div
          className="relative h-2 rounded-full bg-white/15"
          role="img"
          aria-label={`Margen ${fmtPorcentaje(margenPct)} sobre una meta de ${fmtPorcentaje(metaPct)}`}
        >
          <div
            className="h-full rounded-full bg-marca"
            style={{ width: `${acotar(margen, 0, 100)}%` }}
          />
          {/* Marca de la meta. */}
          <div
            className="absolute -top-1 h-4 w-0.5 rounded-full bg-white"
            style={{ left: `${acotar(meta, 0, 100)}%` }}
          />
        </div>
        <p className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="text-slate-300">
            Margen <span className="font-semibold text-white">{fmtPorcentaje(margenPct)}</span>
          </span>
          <span className={sobreMeta ? "text-emerald-400" : "text-amber-300"}>
            {sobreMeta ? "Sobre" : "Bajo"} la meta de {fmtPorcentaje(metaPct)}
          </span>
        </p>
      </div>
    </section>
  );
}

export type DiaVentas = { clave: string; dia: string; total: number; hoy: boolean };

/** Facturado por dia en las ultimas semanas: barras simples, sin librerias. */
export function VentasPorDia({ dias }: { dias: DiaVentas[] }) {
  const total = dias.reduce((acc, d) => acc + d.total, 0);
  const maximo = Math.max(...dias.map((d) => d.total), 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Ventas por día</h2>
        <p className="text-xs text-slate-500">últimos {dias.length} días</p>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Sin ventas en este período.</p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {fmtMonedaCorta(total)}
          </p>
          <div className="mt-4 flex h-24 items-end gap-1" role="img" aria-label="Ventas por día">
            {dias.map((d) => (
              <div
                key={d.clave}
                className="flex h-full flex-1 items-end"
                title={`${d.dia}: ${fmtMonedaCorta(d.total)}`}
              >
                <div
                  className={`w-full rounded-t-sm ${
                    d.hoy ? "bg-tinta" : d.total > 0 ? "bg-marca" : "bg-slate-200"
                  }`}
                  style={{
                    height: d.total > 0 ? `${Math.max((d.total / maximo) * 100, 6)}%` : "2px",
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-slate-500 tabular-nums">
            <span>{dias[0]?.dia}</span>
            <span>{dias[Math.floor(dias.length / 2)]?.dia}</span>
            <span>hoy</span>
          </div>
        </>
      )}
    </section>
  );
}
