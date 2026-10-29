import { fmtMoneda, fmtNumero } from "@/lib/money";
import { configNumero, getArticulosConMargen, getConfig } from "@/lib/queries/catalogo";
import { precioParaMargen } from "@/lib/costing";
import { Seccion, SemaforoMargen, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Catalogo con costo y margen.
 */
export default async function CatalogoPage() {
  const [articulos, config] = await Promise.all([getArticulosConMargen(), getConfig()]);

  const metaMargenPct = configNumero(config, "margenObjetivo", "40");

  if (articulos.length === 0) {
    return (
      <>
        <Seccion titulo="Articulos" />
        <Vacio
          mensaje="No hay articulos cargados"
          hint="Empeza por los materiales: un sticker o un cartel se costean a partir de ellos."
        />
      </>
    );
  }

  return (
    <>
      <Seccion
        titulo="Articulos"
        descripcion="Costo por receta, precio de venta y margen real"
      />

      <ul className="space-y-2">
        {articulos.map((a) => {
          const sugerido = precioParaMargen(a.receta.costoTotal, metaMargenPct);
          const bajoMeta = a.margen.margenPct.cmp(metaMargenPct) < 0;

          return (
            <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{a.nombre}</p>
                  {a.descripcion ? (
                    <p className="text-sm text-slate-500">{a.descripcion}</p>
                  ) : null}
                </div>
                {a.receta.confiable ? (
                  <SemaforoMargen margenPct={a.margen.margenPct} metaPct={metaMargenPct} />
                ) : (
                  <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    sin receta
                  </span>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Dato etiqueta="Costo" valor={fmtMoneda(a.receta.costoTotal)} />
                <Dato etiqueta="Vende" valor={fmtMoneda(a.margen.precioBruto)} />
                <Dato
                  etiqueta="Ganancia"
                  valor={fmtMoneda(a.margen.ganancia)}
                  destacado={a.margen.ganancia.cmp(0) >= 0}
                />
                <Dato
                  etiqueta="Para meta"
                  valor={a.receta.confiable ? fmtMoneda(sugerido) : "-"}
                  sugerencia={a.receta.confiable && bajoMeta}
                />
              </dl>

              {a.receta.confiable ? (
                <details className="mt-3 group">
                  <summary className="cursor-pointer text-sm font-medium text-marca">
                    Ver receta ({a.receta.componentes.length}{" "}
                    {a.receta.componentes.length === 1 ? "componente" : "componentes"})
                  </summary>
                  <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
                    {a.receta.componentes.map((c) => (
                      <li key={c.id} className="text-sm text-slate-600">
                        <span className="text-slate-900">{c.etiqueta}</span>:{" "}
                        {fmtNumero(c.cantidad)} × {fmtMoneda(c.costoUnitario)}
                        {c.costoUnitarioOverride ? " (fijado)" : ""} ={" "}
                        <span className="font-medium text-slate-900">
                          {fmtMoneda(c.costoTotal)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Sin receta: el costo real es desconocido y el margen que se muestra es
                  optimista. <span className="font-medium">No tomes decisiones con este numero.</span>
                </p>
              )}

              {a.receta.advertencias.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {a.receta.advertencias.map((adv) => (
                    <li key={adv} className="text-sm text-amber-700">
                      {adv}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Dato({
  etiqueta,
  valor,
  destacado,
  sugerencia,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
  sugerencia?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{etiqueta}</dt>
      <dd
        className={`text-sm font-semibold tabular-nums ${
          destacado ? "text-emerald-700" : sugerencia ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {valor}
      </dd>
    </div>
  );
}
