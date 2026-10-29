import { fmtMoneda, fmtPorcentaje, Dinero } from "@/lib/money";

/**
 * Tarjeta de indicador. En mobile el grid es de una columna: el dueño mira
 * numeros grandes, en vertical, con el celular a la vista.
 */
export function Tarjeta({
  titulo,
  valor,
  detalle,
  tono = "neutro",
}: {
  titulo: string;
  valor: string;
  detalle?: React.ReactNode;
  tono?: "neutro" | "ok" | "critico" | "aviso";
}) {
  const colorValor =
    {
      neutro: "text-slate-900",
      ok: "text-emerald-700",
      critico: "text-red-700",
      aviso: "text-amber-700",
    }[tono];

  // El numero se achica segun su largo para no desbordar la tarjeta en pantallas
  // angostas (dos tarjetas por fila en un celular de 375px).
  const tamano =
    valor.length > 14
      ? "text-base sm:text-xl"
      : valor.length > 11
        ? "text-lg sm:text-2xl"
        : "text-xl sm:text-2xl";

  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <p className="truncate text-xs font-medium tracking-wide text-slate-500 uppercase">{titulo}</p>
      <p className={`mt-1 font-semibold tabular-nums tracking-tight whitespace-nowrap ${tamano} ${colorValor}`}>
        {valor}
      </p>
      {detalle ? <p className="mt-1 text-sm text-slate-500">{detalle}</p> : null}
    </div>
  );
}

/** Encabezado de seccion. */
export function Seccion({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{titulo}</h1>
        {descripcion ? <p className="mt-0.5 text-sm text-slate-500">{descripcion}</p> : null}
      </div>
      {accion}
    </div>
  );
}

/**
 * Semforo de margen. El color no es decorativo: dice si el articulo vale la
 * pena venderlo al precio actual. El detalle (markup) esta en el tooltip del
 * title para quien quiera el otro calculo.
 */
export function SemaforoMargen({ margenPct, metaPct }: { margenPct: Dinero; metaPct: Dinero }) {
  const pct = Number(margenPct.toString());
  const meta = Number(metaPct.toString());

  const clase = pct >= meta ? "bg-emerald-50 text-emerald-700" : pct > 0 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";

  return (
    <span
      title={`Markup sobre costo: ${fmtPorcentaje(margenPct)}`}
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${clase}`}
    >
      {fmtPorcentaje(margenPct)}
    </span>
  );
}

export function Vacio({ mensaje, hint }: { mensaje: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{mensaje}</p>
      {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Tabla que en desktop es tabla y en mobile es una lista de tarjetas.
 *
 * Una tabla de 6 columnas en 360px no se lee: la fila se parte y los numeros
 * dejan de alinearse. En mobile cada celda pasa a ser un par etiqueta/valor.
 */
export function Tabla({ columnas, filas }: { columnas: string[]; filas: string[][] }) {
  return (
    <>
      {/* Desktop: tabla normal. */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
        <table>
          <thead>
            <tr>
              {columnas.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => (
              <tr key={i}>
                {fila.map((celda, j) => (
                  <td key={j} className={j === 0 ? "font-medium text-slate-900" : "tabular-nums"}>
                    {celda}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: tarjetas apiladas. Una tabla de 6 columnas en 360px no se lee. */}
      <div className="space-y-2 sm:hidden">
        {filas.map((fila, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="font-medium text-slate-900">{fila[0]}</p>
            <dl className="mt-2 space-y-1">
              {fila.slice(1).map((celda, j) => (
                <div key={j} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-slate-500">{columnas[j + 1]}</dt>
                  <dd className="text-sm font-medium tabular-nums text-slate-800">{celda}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

export { fmtMoneda };
