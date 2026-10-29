import Link from "next/link";
import { fmtMoneda, fmtNumero } from "@/lib/money";
import { configNumero, getArticulosConMargen, getConfig } from "@/lib/queries/catalogo";
import { getArticulosDeBaja } from "@/lib/queries/recetas";
import { precioParaMargen } from "@/lib/costing";
import { Seccion, SemaforoMargen, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Catalogo con costo y margen.
 */
export default async function CatalogoPage() {
  const [articulos, config, deBaja] = await Promise.all([
    getArticulosConMargen(),
    getConfig(),
    getArticulosDeBaja(),
  ]);

  const metaMargenPct = configNumero(config, "margenObjetivo", "40");

  if (articulos.length === 0) {
    return (
      <>
        <Seccion titulo="Artículos" accion={<BotonNuevo />} />
        <Vacio
          mensaje="No hay artículos cargados"
          hint="Empezá por los materiales: un sticker o un cartel se costean a partir de ellos."
        />
        <ListaDeBaja articulos={deBaja} />
      </>
    );
  }

  return (
    <>
      <Seccion
        titulo="Artículos"
        descripcion="Costo por receta, precio de venta y margen real"
        accion={<BotonNuevo />}
      />

      <ul className="space-y-2">
        {articulos.map((a) => {
          const sugerido = precioParaMargen(a.receta.costoTotal, metaMargenPct);
          const bajoMeta = a.margen.margenPct.cmp(metaMargenPct) < 0;

          return (
            <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/catalogo/${a.id}`} className="inline-flex min-h-11 items-center font-medium text-slate-900 hover:underline">
                    {a.nombre}
                  </Link>
                  {a.esServicio ? <span className="ml-2 text-xs text-slate-500">servicio</span> : null}
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
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-marca-texto">
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
                  optimista. <span className="font-medium">No tomes decisiones con este número.</span>
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

              <Link
                href={`/catalogo/${a.id}`}
                className="mt-3 block rounded-lg border border-slate-300 py-3 text-center text-sm font-medium text-slate-700"
              >
                {a.receta.confiable ? "Editar artículo y receta" : "Cargar receta"}
              </Link>
            </li>
          );
        })}
      </ul>

      <ListaDeBaja articulos={deBaja} />
    </>
  );
}

function BotonNuevo() {
  return (
    <Link href="/catalogo/nuevo" className="inline-flex min-h-11 items-center rounded-lg bg-tinta px-3 text-sm font-semibold text-white">
      + Nuevo artículo
    </Link>
  );
}

/** Los dados de baja quedan al final, plegados: se abren solo para reactivarlos. */
function ListaDeBaja({ articulos }: { articulos: { id: string; nombre: string }[] }) {
  if (articulos.length === 0) return null;
  return (
    <details className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-700">
        Dados de baja ({articulos.length})
      </summary>
      <ul className="mt-2 divide-y divide-slate-100">
        {articulos.map((a) => (
          <li key={a.id}>
            <Link href={`/catalogo/${a.id}`} className="block py-3 text-sm text-slate-600 hover:underline">
              {a.nombre}
            </Link>
          </li>
        ))}
      </ul>
    </details>
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
