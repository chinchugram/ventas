import { fmtHorasMinutos, fmtMinutos, type Estimacion, type LineaEstimada, type Subtotal, type TotalPedido } from "@/lib/estimacion-tiempos";
import { fmtNumero, type Dinero } from "@/lib/money";

/**
 * Resultado de `/produccion/estimar`. Solo tiempos (minutos y h:mm): no recibe ni
 * muestra costos. Cada numero dice cuantas muestras lo respaldan y entre que
 * valores estuvo; sin datos suficientes se dice asi, nunca se muestra un 0 inventado.
 */

type Criterio = { n: number; minMuestras: number };

/** "entre 40 min y 62 min", o "todos iguales" cuando no hay variacion. */
const rango = (min: Dinero, max: Dinero) => (min.eq(max) ? "todos iguales" : `entre ${fmtMinutos(min)} y ${fmtMinutos(max)}`);

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** "Basado en 5 trabajos · entre 40 min y 62 min" */
function Respaldo({ e }: { e: Extract<Estimacion, { suficiente: true }> }) {
  return (
    <p className="text-xs text-slate-500">
      Basado en {plural(e.muestras, "trabajo", "trabajos")} · {rango(e.minutosMin, e.minutosMax)}
    </p>
  );
}

function SinDatos({ e, criterio }: { e: Extract<Estimacion, { suficiente: false }>; criterio: Criterio }) {
  return (
    <p className="text-sm text-amber-800">
      Sin datos suficientes: hay {plural(e.muestras, "trabajo cargado", "trabajos cargados")} y hacen falta al menos {criterio.minMuestras}.
    </p>
  );
}

function Tiempo({ titulo, e, criterio }: { titulo: string; e: Estimacion; criterio: Criterio }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{titulo}</dt>
      <dd className="mt-0.5">
        {e.suficiente ? (
          <>
            <p className="font-semibold tabular-nums text-slate-900">
              {fmtHorasMinutos(e.minutos)} h <span className="font-normal text-slate-500">({fmtMinutos(e.minutos)})</span>
            </p>
            <Respaldo e={e} />
          </>
        ) : (
          <SinDatos e={e} criterio={criterio} />
        )}
      </dd>
    </div>
  );
}

function TarjetaLinea({ linea, criterio }: { linea: LineaEstimada; criterio: Criterio }) {
  const suficiente = linea.maquinaTotal.suficiente && linea.manoObra.suficiente;
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-slate-900">{linea.nombre}</p>
        <p className="shrink-0 text-sm tabular-nums text-slate-600">× {fmtNumero(linea.cantidad)}</p>
      </div>
      {linea.maquinaTotal.suficiente ? (
        <p className="mt-0.5 text-xs text-slate-500">
          {fmtMinutos(linea.maquinaTotal.minutosPorUnidad)} de máquina y{" "}
          {linea.manoObra.suficiente ? fmtMinutos(linea.manoObra.minutosPorUnidad) : "—"} de mano de obra por unidad (mediana)
        </p>
      ) : null}

      <dl className="mt-3 space-y-3">
        <Tiempo titulo="Máquinas (total)" e={linea.maquinaTotal} criterio={criterio} />
        {linea.maquinas.length > 0 ? (
          <div className="space-y-2 border-l-2 border-slate-200 pl-3">
            {linea.maquinas.map((m) => (
              <Tiempo key={m.maquinaId} titulo={m.maquinaNombre} e={m} criterio={criterio} />
            ))}
          </div>
        ) : null}
        <Tiempo titulo="Mano de obra" e={linea.manoObra} criterio={criterio} />
      </dl>
      {!suficiente && linea.trabajos === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Todavía no se cargó ningún trabajo de este artículo.</p>
      ) : null}
    </li>
  );
}

function FilaTotal({ titulo, s, nota }: { titulo: string; s: Subtotal | null; nota?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-slate-700">
        {titulo}
        {nota ? <span className="block text-xs text-amber-800">{nota}</span> : null}
      </dt>
      <dd className="text-right">
        {s ? (
          <>
            <span className="font-semibold tabular-nums text-slate-900">{fmtHorasMinutos(s.minutos)} h</span>
            <span className="block text-xs tabular-nums text-slate-500">
              {fmtMinutos(s.minutos)} · {rango(s.minutosMin, s.minutosMax)}
            </span>
          </>
        ) : (
          <span className="text-sm text-amber-800">Sin datos</span>
        )}
      </dd>
    </div>
  );
}

export function ResultadoEstimacion({ lineas, total, criterio }: { lineas: LineaEstimada[]; total: TotalPedido; criterio: Criterio }) {
  const parcial = total.lineasSinDatos > 0;
  return (
    <section aria-labelledby="titulo-resultado" className="space-y-4">
      <h2 id="titulo-resultado" className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
        Estimación
      </h2>

      <div className="rounded-xl border border-slate-300 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-slate-900">{parcial ? "Total parcial del pedido" : "Total del pedido"}</p>
        {parcial ? (
          <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {total.lineasConDatos === 0
              ? "Ninguna línea tiene datos suficientes: no hay total para mostrar."
              : `${plural(total.lineasSinDatos, "línea no suma", "líneas no suman")} porque no ${total.lineasSinDatos === 1 ? "tiene" : "tienen"} datos suficientes. Este total es solo de ${total.lineasConDatos === 1 ? "la otra línea" : `las otras ${total.lineasConDatos} líneas`}.`}
          </p>
        ) : null}
        <dl className="space-y-3">
          <FilaTotal titulo="Máquinas" s={total.maquinaTotal} />
          {total.porMaquina.length > 0 ? (
            <div className="space-y-2 border-l-2 border-slate-200 pl-3">
              {total.porMaquina.map((m) => (
                <FilaTotal key={m.maquinaId} titulo={m.maquinaNombre} s={m} nota={m.completo ? undefined : parcial ? "Parcial: no incluye las líneas sin datos" : "Parcial: falta algún dato de esta máquina"} />
              ))}
            </div>
          ) : null}
          <FilaTotal titulo="Mano de obra" s={total.manoObra} />
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          Mediana por unidad de los últimos {criterio.n} trabajos de cada artículo (mínimo {criterio.minMuestras}), por la cantidad pedida.
          Tiempos medidos, no una promesa de entrega.
        </p>
      </div>

      <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase">Por línea</h2>
      <ul className="space-y-3">
        {lineas.map((l, i) => (
          <TarjetaLinea key={`${l.articuloId}-${i}`} linea={l} criterio={criterio} />
        ))}
      </ul>
    </section>
  );
}
