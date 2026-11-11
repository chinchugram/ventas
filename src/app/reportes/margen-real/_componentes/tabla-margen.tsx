/**
 * Tabla de comparacion de margen (desktop: tabla; mobile: tarjetas apiladas).
 * Igual que `Tabla` de `components/ui`, pero con el desvio resaltado: `Tabla` no puede
 * pintar filas. El estado no se dice solo con color: lleva una etiqueta de texto.
 */

import { Etiqueta, type Tono } from "@/components/ui";

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

const TONO: Record<EstadoDesvio, Tono> = {
  sobrecosto: "aviso",
  ahorro: "ok",
  igual: "neutro",
};

const CLASE_FILA: Record<EstadoDesvio, string> = {
  sobrecosto: "bg-aviso-soft",
  ahorro: "bg-ok-soft",
  igual: "",
};

const CLASE_TARJETA: Record<EstadoDesvio, string> = {
  sobrecosto: "border-aviso-line bg-aviso-soft",
  ahorro: "border-ok-line bg-ok-soft",
  igual: "",
};

function Badge({ estado }: { estado: EstadoDesvio }) {
  const texto = ETIQUETA[estado];
  if (!texto) return null;
  return (
    <Etiqueta tono={TONO[estado]} className="ml-2 align-middle">
      {texto}
    </Etiqueta>
  );
}

export function TablaMargen({ columnas, filas }: { columnas: string[]; filas: FilaMargen[] }) {
  return (
    <>
      <div className="tarjeta hidden overflow-x-auto sm:block">
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
                  <td key={j} className={j === 0 ? "font-semibold text-ink" : "tabular-nums"}>
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
          <div key={f.clave} className={`tarjeta p-3 ${CLASE_TARJETA[f.estado]}`}>
            <p className="font-semibold text-ink">
              {f.celdas[0]}
              <Badge estado={f.estado} />
            </p>
            <dl className="mt-2 space-y-1">
              {f.celdas.slice(1).map((celda, j) => (
                <div key={j} className="flex items-baseline justify-between gap-3">
                  <dt className="eyebrow">{columnas[j + 1]}</dt>
                  <dd className="text-body-sm font-semibold tabular-nums text-ink">{celda}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
