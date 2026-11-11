import { fmtHorasMinutos, fmtMinutos, type Estimacion, type LineaEstimada, type Subtotal, type TotalPedido } from "@/lib/estimacion-tiempos";
import { fmtNumero, type Dinero } from "@/lib/money";
import { Aviso, Panel, TituloBloque } from "@/components/ui";

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
    <p className="text-body-sm text-ink-muted">
      Basado en {plural(e.muestras, "trabajo", "trabajos")} · {rango(e.minutosMin, e.minutosMax)}
    </p>
  );
}

function SinDatos({ e, criterio }: { e: Extract<Estimacion, { suficiente: false }>; criterio: Criterio }) {
  return (
    <p className="text-body-sm font-semibold text-aviso-text">
      Sin datos suficientes: hay {plural(e.muestras, "trabajo cargado", "trabajos cargados")} y hacen falta al menos {criterio.minMuestras}.
    </p>
  );
}

function Tiempo({ titulo, e, criterio }: { titulo: string; e: Estimacion; criterio: Criterio }) {
  return (
    <div>
      <dt className="eyebrow">{titulo}</dt>
      <dd className="mt-0.5">
        {e.suficiente ? (
          <>
            <p className="monto-fila text-ink">
              {fmtHorasMinutos(e.minutos)} h <span className="font-sans text-body-sm font-normal text-ink-muted">({fmtMinutos(e.minutos)})</span>
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
    <li className="tarjeta p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body font-semibold text-ink">{linea.nombre}</p>
        <p className="shrink-0 text-body-sm tabular-nums text-ink-muted">× {fmtNumero(linea.cantidad)}</p>
      </div>
      {linea.maquinaTotal.suficiente ? (
        <p className="mt-0.5 text-body-sm text-ink-muted">
          {fmtMinutos(linea.maquinaTotal.minutosPorUnidad)} de máquina y{" "}
          {linea.manoObra.suficiente ? fmtMinutos(linea.manoObra.minutosPorUnidad) : "—"} de mano de obra por unidad (mediana)
        </p>
      ) : null}

      <dl className="mt-3 space-y-3">
        <Tiempo titulo="Máquinas (total)" e={linea.maquinaTotal} criterio={criterio} />
        {linea.maquinas.length > 0 ? (
          <div className="space-y-2 border-l-(length:--border-width) border-line-strong pl-3">
            {linea.maquinas.map((m) => (
              <Tiempo key={m.maquinaId} titulo={m.maquinaNombre} e={m} criterio={criterio} />
            ))}
          </div>
        ) : null}
        <Tiempo titulo="Mano de obra" e={linea.manoObra} criterio={criterio} />
      </dl>
      {!suficiente && linea.trabajos === 0 ? (
        <p className="mt-3 text-body-sm text-ink-muted">Todavía no se cargó ningún trabajo de este artículo.</p>
      ) : null}
    </li>
  );
}

function FilaTotal({ titulo, s, nota }: { titulo: string; s: Subtotal | null; nota?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-body-sm text-ink">
        {titulo}
        {nota ? <span className="block text-body-sm text-aviso-text">{nota}</span> : null}
      </dt>
      <dd className="text-right">
        {s ? (
          <>
            <span className="monto-fila text-ink">{fmtHorasMinutos(s.minutos)} h</span>
            <span className="block text-body-sm tabular-nums text-ink-muted">
              {fmtMinutos(s.minutos)} · {rango(s.minutosMin, s.minutosMax)}
            </span>
          </>
        ) : (
          <span className="text-body-sm font-semibold text-aviso-text">Sin datos</span>
        )}
      </dd>
    </div>
  );
}

export function ResultadoEstimacion({ lineas, total, criterio }: { lineas: LineaEstimada[]; total: TotalPedido; criterio: Criterio }) {
  const parcial = total.lineasSinDatos > 0;
  return (
    <section aria-labelledby="titulo-resultado" className="space-y-4">
      <TituloBloque id="titulo-resultado" className="mb-0">
        Estimación
      </TituloBloque>

      <Panel compacto>
        <p className="mb-3 font-display text-body-lg font-bold text-ink">{parcial ? "Total parcial del pedido" : "Total del pedido"}</p>
        {parcial ? (
          <Aviso tono="aviso" role="status" className="mb-3">
            {total.lineasConDatos === 0
              ? "Ninguna línea tiene datos suficientes: no hay total para mostrar."
              : `${plural(total.lineasSinDatos, "línea no suma", "líneas no suman")} porque no ${total.lineasSinDatos === 1 ? "tiene" : "tienen"} datos suficientes. Este total es solo de ${total.lineasConDatos === 1 ? "la otra línea" : `las otras ${total.lineasConDatos} líneas`}.`}
          </Aviso>
        ) : null}
        <dl className="space-y-3">
          <FilaTotal titulo="Máquinas" s={total.maquinaTotal} />
          {total.porMaquina.length > 0 ? (
            <div className="space-y-2 border-l-(length:--border-width) border-line-strong pl-3">
              {total.porMaquina.map((m) => (
                <FilaTotal key={m.maquinaId} titulo={m.maquinaNombre} s={m} nota={m.completo ? undefined : parcial ? "Parcial: no incluye las líneas sin datos" : "Parcial: falta algún dato de esta máquina"} />
              ))}
            </div>
          ) : null}
          <FilaTotal titulo="Mano de obra" s={total.manoObra} />
        </dl>
        <p className="mt-3 text-body-sm text-ink-muted">
          Mediana por unidad de los últimos {criterio.n} trabajos de cada artículo (mínimo {criterio.minMuestras}), por la cantidad pedida.
          Tiempos medidos, no una promesa de entrega.
        </p>
      </Panel>

      <TituloBloque className="mb-0">Por línea</TituloBloque>
      <ul className="space-y-3">
        {lineas.map((l, i) => (
          <TarjetaLinea key={`${l.articuloId}-${i}`} linea={l} criterio={criterio} />
        ))}
      </ul>
    </section>
  );
}
