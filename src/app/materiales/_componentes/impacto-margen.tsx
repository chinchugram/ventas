"use client";

import { useMemo } from "react";
import { esDecimal, normalizarDecimal } from "@/lib/acciones";
import { d, fmtMoneda, fmtPorcentaje } from "@/lib/money";
import { deserializarArticulos, impactoDeCambioDeCosto, type ArticuloSerial } from "@/lib/materiales";

/**
 * Lista en vivo de los articulos cuya receta usa el material: costo y margen
 * hoy contra los que quedarian con el costo tipeado. Es solo informativa; el
 * servidor vuelve a calcular todo al guardar.
 */
export function ImpactoMargen({
  materialId,
  articulos,
  costoOriginal,
  costoTipeado,
  costoHoraManoObra,
  margenObjetivoPct,
}: {
  materialId: string;
  articulos: ArticuloSerial[];
  costoOriginal: string;
  costoTipeado: string;
  costoHoraManoObra: string;
  margenObjetivoPct: string;
}) {
  const recetas = useMemo(() => deserializarArticulos(articulos), [articulos]);
  // Mientras lo tipeado no sea un numero, se muestra el costo de hoy.
  const valido = esDecimal(costoTipeado);
  const textoNuevo = valido ? normalizarDecimal(costoTipeado) : costoOriginal;
  const costoNuevo = d(textoNuevo);
  const cambio = valido && !costoNuevo.eq(d(costoOriginal));

  const impactos = useMemo(
    () =>
      impactoDeCambioDeCosto({
        articulos: recetas,
        materialId,
        costoNuevo: d(textoNuevo),
        costoHoraManoObra: d(costoHoraManoObra),
        margenObjetivoPct: d(margenObjetivoPct),
      }),
    [recetas, materialId, textoNuevo, costoHoraManoObra, margenObjetivoPct],
  );

  if (articulos.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        Ningún artículo activo usa este material en su receta: cambiar el costo no mueve ningún margen.
      </p>
    );
  }

  const bajanDeMeta = impactos.filter((i) => i.quedaBajoMeta).length;

  return (
    <section aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">
        {cambio ? "Así cambian los márgenes" : "Artículos que usan este material"}
      </h2>
      <p className="mt-0.5 text-sm text-slate-500">
        {cambio
          ? `Con el costo nuevo (${fmtMoneda(costoNuevo)}) cambian ${impactos.filter((i) => !i.costoActual.eq(i.costoNuevo)).length} de ${impactos.length}. Meta: ${fmtPorcentaje(margenObjetivoPct)}.`
          : `Cambiá el costo para ver el margen nuevo de cada uno. Meta: ${fmtPorcentaje(margenObjetivoPct)}.`}
      </p>
      {cambio && bajanDeMeta > 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          {bajanDeMeta === 1 ? "1 artículo queda" : `${bajanDeMeta} artículos quedan`} por debajo del margen objetivo.
        </p>
      ) : null}

      <ul className="mt-3 divide-y divide-slate-100">
        {impactos.map((i) => {
          const varia = cambio && !i.costoActual.eq(i.costoNuevo);
          const bajoMeta = i.margenNuevoPct.lt(d(margenObjetivoPct));
          return (
            <li key={i.id} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-slate-900">{i.nombre}</p>
                <p className="shrink-0 text-sm tabular-nums">
                  {varia ? (
                    <>
                      <span className="text-slate-500">{fmtPorcentaje(i.margenActualPct)}</span>
                      <span className="text-slate-400"> → </span>
                      <span className={`font-semibold ${bajoMeta ? "text-amber-700" : "text-emerald-700"}`}>
                        {fmtPorcentaje(i.margenNuevoPct)}
                      </span>
                    </>
                  ) : (
                    <span className={`font-semibold ${bajoMeta ? "text-amber-700" : "text-slate-700"}`}>
                      {fmtPorcentaje(i.margenActualPct)}
                    </span>
                  )}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                Costo {fmtMoneda(i.costoActual)}
                {varia ? ` → ${fmtMoneda(i.costoNuevo)}` : ""} · vende {fmtMoneda(i.precioVenta)}
                {i.soloOverride ? " · costo fijado en la receta, no cambia" : ""}
              </p>
              {varia && i.quedaBajoMeta ? (
                <p className="mt-0.5 text-xs text-amber-700">
                  Para volver a la meta: vender a {fmtMoneda(i.precioSugerido)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
