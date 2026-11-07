"use client";

import { useMemo } from "react";
import { Aviso, Panel, TituloBloque, Vacio } from "@/components/ui";
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
      <Vacio
        mensaje="Ningún artículo activo usa este material."
        hint="Cambiar el costo no mueve ningún margen."
      />
    );
  }

  const bajanDeMeta = impactos.filter((i) => i.quedaBajoMeta).length;

  return (
    <Panel como="section">
      <TituloBloque className="mb-0.5">{cambio ? "Así cambian los márgenes" : "Artículos que usan este material"}</TituloBloque>
      <p className="text-body-sm text-ink-muted">
        {cambio
          ? `Con el costo nuevo (${fmtMoneda(costoNuevo)}) cambian ${impactos.filter((i) => !i.costoActual.eq(i.costoNuevo)).length} de ${impactos.length}. Meta: ${fmtPorcentaje(margenObjetivoPct)}.`
          : `Cambiá el costo para ver el margen nuevo de cada uno. Meta: ${fmtPorcentaje(margenObjetivoPct)}.`}
      </p>
      {cambio && bajanDeMeta > 0 ? (
        <Aviso tono="aviso" className="mt-2">
          {bajanDeMeta === 1 ? "1 artículo queda" : `${bajanDeMeta} artículos quedan`} por debajo del margen objetivo.
        </Aviso>
      ) : null}

      <ul className="mt-3 divide-y-(length:--border-width) divide-line">
        {impactos.map((i) => {
          const varia = cambio && !i.costoActual.eq(i.costoNuevo);
          const bajoMeta = i.margenNuevoPct.lt(d(margenObjetivoPct));
          return (
            <li key={i.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-body font-semibold break-words text-ink">{i.nombre}</p>
                <p className="shrink-0 text-body tabular-nums">
                  {varia ? (
                    <>
                      <span className="text-ink-muted">{fmtPorcentaje(i.margenActualPct)}</span>
                      <span className="text-ink-muted"> → </span>
                      <span className={`font-semibold ${bajoMeta ? "text-aviso-text" : "text-ok-text"}`}>
                        {fmtPorcentaje(i.margenNuevoPct)}
                      </span>
                    </>
                  ) : (
                    <span className={`font-semibold ${bajoMeta ? "text-aviso-text" : "text-ink"}`}>
                      {fmtPorcentaje(i.margenActualPct)}
                    </span>
                  )}
                </p>
              </div>
              <p className="mt-0.5 text-body-sm text-ink-muted tabular-nums">
                Costo {fmtMoneda(i.costoActual)}
                {varia ? ` → ${fmtMoneda(i.costoNuevo)}` : ""} · vende {fmtMoneda(i.precioVenta)}
                {i.soloOverride ? " · costo fijado en la receta, no cambia" : ""}
              </p>
              {varia && i.quedaBajoMeta ? (
                <p className="mt-0.5 text-body-sm text-aviso-text">
                  Para volver a la meta: vender a {fmtMoneda(i.precioSugerido)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
