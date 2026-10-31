/**
 * Tabla de comparacion de margen (desktop: tabla; mobile: tarjetas apiladas).
 * Igual que `Tabla` de `components/ui`, pero con el desvio resaltado: `Tabla` no puede
 * pintar filas. El estado no se dice solo con color: lleva una etiqueta de texto.
 */

export type EstadoDesvio = "sobrecosto" | "ahorro" | "igual";

export type FilaMargen = {
  clave: string;
  /** La primera celda es el titulo de la fila (en mobile, el encabezado de la tarjeta). */
  celdas: string[];
  estado: EstadoDesvio;
};

const ETIQUETA: Record<EstadoDesvio, string | null> = {
  sobrecosto: "Sobrecosto",
  ahorro: "Ahorro",
  igual: null,
};

const CLASE_BADGE: Record<EstadoDesvio, string> = {
  sobrecosto: "bg-amber-100 text-amber-800",
  ahorro: "bg-emerald-100 text-emerald-800",
  igual: "",
};

const CLASE_FILA: Record<EstadoDesvio, string> = {
  sobrecosto: "bg-amber-50",
  ahorro: "bg-emerald-50",
  igual: "",
};

const CLASE_TARJETA: Record<EstadoDesvio, string> = {
  sobrecosto: "border-amber-300 bg-amber-50",
  ahorro: "border-emerald-300 bg-emerald-50",
  igual: "border-slate-200 bg-white",
};

function Badge({ estado }: { estado: EstadoDesvio }) {
  const texto = ETIQUETA[estado];
  if (!texto) return null;
  return (
    <span className={`ml-2 inline-block rounded-md px-1.5 py-0.5 align-middle text-xs font-semibold ${CLASE_BADGE[estado]}`}>
      {texto}
    </span>
  );
}

export function TablaMargen({ columnas, filas }: { columnas: string[]; filas: FilaMargen[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
        <table>
          <thead>
            <tr>
              {columnas.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave} className={CLASE_FILA[f.estado] || undefined}>
                {f.celdas.map((celda, j) => (
                  <td key={j} className={j === 0 ? "font-medium text-slate-900" : "tabular-nums"}>
                    {celda}
                    {j === 0 ? <Badge estado={f.estado} /> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 sm:hidden">
        {filas.map((f) => (
          <div key={f.clave} className={`rounded-xl border p-3 ${CLASE_TARJETA[f.estado]}`}>
            <p className="font-medium text-slate-900">
              {f.celdas[0]}
              <Badge estado={f.estado} />
            </p>
            <dl className="mt-2 space-y-1">
              {f.celdas.slice(1).map((celda, j) => (
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
