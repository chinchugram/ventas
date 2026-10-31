import Link from "next/link";
import { fmtFecha, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPorcentaje, type Dinero } from "@/lib/money";
import { getMargenReal } from "@/lib/queries/margen-real";
import { hayDesvio, mayoresDesvios, textoPct, type Comparacion } from "@/lib/margen-real";
import { conRango, parseRangoFechas, rangoDeMes, type ParamsFecha, type RangoFechas } from "@/lib/rango-fechas";
import { Seccion, Tarjeta, Vacio } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";
import { TablaMargen, type EstadoDesvio, type FilaMargen } from "./_componentes/tabla-margen";

export const dynamic = "force-dynamic";

/**
 * Margen real: lo que de verdad costo cada trabajo contra el costo de la receta
 * de la misma linea de venta. Solo presentacion: toda la cuenta esta en
 * `lib/margen-real.ts` y la lectura en `lib/queries/margen-real.ts`.
 *
 * Es un reporte POR PERIODO: se filtra por la fecha del TRABAJO de produccion
 * (no por la de la venta), con trabajos vigentes de ventas no anuladas.
 * Solo el dueño: trae costos y margenes.
 *
 * Filtros en la URL (`?mes=AAAA-MM` o `?desde=..&hasta=..`), como /reportes y
 * /reportes/stock: los formularios son GET y el link sirve tal cual.
 */

const MAX_TRABAJOS = 20;
const RUTA = "/reportes/margen-real";
const RUTA_CSV = "/reportes/margen-real/export";

const CLASE_INPUT = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const CLASE_BOTON = "min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700";
const CLASE_BOTON_SECUNDARIO =
  "inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50";

const COLUMNAS_COMPARACION = ["Precio neto", "Costo receta", "Costo real", "Desvío $", "Desvío %", "Margen estimado", "Margen real"];

export default async function MargenRealPage({ searchParams }: { searchParams: Promise<ParamsFecha> }) {
  await requierePermisoPagina("verReportes", "verCostos", "verMargenes", "verMargenReal");
  const rango = parseRangoFechas(await searchParams);
  const reporte = await getMargenReal(rango);
  const { total } = reporte;
  const hayTrabajos = total.trabajos > 0;

  return (
    <>
      <Seccion
        titulo="Margen real"
        descripcion={`Período: ${rango.etiqueta} · por fecha del trabajo`}
        accion={
          <Link href="/reportes" className={CLASE_BOTON_SECUNDARIO}>
            Reportes
          </Link>
        }
      />

      <FiltroFechas rango={rango} />

      {rango.avisos.length > 0 ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <ul className="space-y-1">
            {rango.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!hayTrabajos ? (
        <Vacio
          mensaje="Sin trabajos de producción cargados en el período"
          hint="El margen real se calcula con lo que realmente se usó en cada trabajo (materiales y minutos). Cuando haya trabajos cargados en estas fechas, acá se compara su costo real contra la receta. Probá con otro período."
        />
      ) : (
        <>
          <Reporte titulo="Resumen" descripcion="Todos los trabajos del período. El margen es sobre el precio de venta sin IVA de cada línea.">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Tarjeta
                titulo="Venta neta"
                valor={fmtMonedaCorta(total.precioNeto)}
                detalle={`${fmtNumero(total.trabajos)} ${total.trabajos === 1 ? "trabajo" : "trabajos"} · ${fmtNumero(total.unidades)} unidades`}
              />
              <Tarjeta titulo="Costo de receta" valor={fmtMonedaCorta(total.costoReceta)} detalle="estimado al vender" />
              <Tarjeta titulo="Costo real" valor={fmtMonedaCorta(total.costoReal)} detalle="lo que se usó de verdad" />
              <Tarjeta
                titulo="Desvío"
                valor={conSigno(fmtMonedaCorta(total.desvio), total.desvio)}
                tono={tonoDesvio(total)}
                detalle={`real − receta · ${textoPct(total.desvioPct, fmtPorcentaje, true)}`}
              />
              <Tarjeta
                titulo="Margen estimado"
                valor={textoPct(total.margenEstimadoPct, fmtPorcentaje)}
                detalle={`ganancia ${fmtMonedaCorta(total.gananciaEstimada)}`}
              />
              <Tarjeta
                titulo="Margen real"
                valor={textoPct(total.margenRealPct, fmtPorcentaje)}
                tono={tonoMargen(total)}
                detalle={`ganancia ${fmtMonedaCorta(total.gananciaReal)} · ${textoPuntos(total.margenDifPuntos)}`}
              />
            </div>
          </Reporte>

          <Reporte
            titulo="Por artículo"
            descripcion="Primero los que más se pasaron de la receta."
            exportar={conRango(`${RUTA_CSV}?detalle=articulos`, rango)}
            etiquetaExportar="Exportar CSV: margen real por artículo"
          >
            <TablaMargen
              columnas={["Artículo", "Trabajos", ...COLUMNAS_COMPARACION]}
              filas={reporte.porArticulo.map((f) => fila(f.articuloId, [f.nombre, fmtNumero(f.trabajos)], f))}
            />
          </Reporte>

          <Reporte
            titulo="Por período"
            descripcion="Un mes por fila, según la fecha del trabajo."
            exportar={conRango(`${RUTA_CSV}?detalle=periodos`, rango)}
            etiquetaExportar="Exportar CSV: margen real por período"
          >
            <TablaMargen
              columnas={["Mes", "Trabajos", ...COLUMNAS_COMPARACION]}
              filas={reporte.porPeriodo.map((f) => fila(f.mes, [f.etiqueta, fmtNumero(f.trabajos)], f))}
            />
          </Reporte>

          <Reporte
            titulo="Trabajos con mayor desvío"
            descripcion={
              reporte.lineas.length > MAX_TRABAJOS
                ? `Los ${MAX_TRABAJOS} con más sobrecosto, de ${fmtNumero(reporte.lineas.length)} trabajos. El CSV trae todos, con el desglose de materiales, máquinas y mano de obra.`
                : "Con el desglose de materiales, máquinas y mano de obra en el CSV."
            }
            exportar={conRango(`${RUTA_CSV}?detalle=trabajos`, rango)}
            etiquetaExportar="Exportar CSV: margen real por trabajo"
          >
            <TablaMargen
              columnas={["Trabajo", "Fecha", ...COLUMNAS_COMPARACION]}
              filas={mayoresDesvios(reporte.lineas, MAX_TRABAJOS).map((l) =>
                fila(l.id, [`#${l.ventaNumero}/${l.ventaAnio} · ${l.articuloNombre}`, fmtFecha(l.fecha)], l),
              )}
            />
          </Reporte>
        </>
      )}
    </>
  );
}

function estadoDe(c: Pick<Comparacion, "desvio">): EstadoDesvio {
  if (!hayDesvio(c)) return "igual";
  return c.desvio.cmp(0) > 0 ? "sobrecosto" : "ahorro";
}

/** Una fila de comparacion: celdas de identificacion + las columnas comunes. */
function fila(clave: string, inicio: string[], c: Comparacion): FilaMargen {
  return {
    clave,
    estado: estadoDe(c),
    celdas: [
      ...inicio,
      fmtMoneda(c.precioNeto),
      fmtMoneda(c.costoReceta),
      fmtMoneda(c.costoReal),
      conSigno(fmtMoneda(c.desvio), c.desvio),
      textoPct(c.desvioPct, fmtPorcentaje, true),
      textoPct(c.margenEstimadoPct, fmtPorcentaje),
      textoPct(c.margenRealPct, fmtPorcentaje),
    ],
  };
}

/** Solo da signo visual a un valor ya calculado: no altera la cuenta. */
function conSigno(texto: string, valor: Dinero): string {
  return valor.cmp(0) > 0 ? `+${texto}` : texto;
}

function textoPuntos(p: Dinero | null): string {
  return p === null ? "— vs. estimado" : `${p.cmp(0) > 0 ? "+" : ""}${fmtNumero(p)} pp vs. estimado`;
}

function tonoDesvio(c: Comparacion): "ok" | "aviso" {
  return c.desvio.cmp(0) > 0 ? "aviso" : "ok";
}

function tonoMargen(c: Comparacion): "neutro" | "critico" {
  return c.margenRealPct !== null && c.margenRealPct.cmp(0) < 0 ? "critico" : "neutro";
}

function Reporte({
  titulo,
  descripcion,
  exportar,
  etiquetaExportar,
  children,
}: {
  titulo: string;
  descripcion?: string;
  /** Ruta del CSV de este reporte, ya con el filtro activo. */
  exportar?: string;
  etiquetaExportar?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Por período</span>
        {exportar ? (
          <a href={exportar} aria-label={etiquetaExportar ?? `Exportar CSV: ${titulo}`} className={`ml-auto px-4 ${CLASE_BOTON_SECUNDARIO}`}>
            Exportar CSV
          </a>
        ) : null}
      </div>
      {descripcion ? <p className="mb-3 text-sm text-slate-600">{descripcion}</p> : null}
      {children}
    </section>
  );
}

/** Mes anterior y siguiente del filtro, si el periodo es un mes. */
function mesesVecinos(rango: RangoFechas) {
  if (rango.anio === undefined || rango.mes === undefined) return null;
  const { anio, mes } = rango;
  return {
    anterior: mes === 1 ? rangoDeMes(anio - 1, 12) : rangoDeMes(anio, mes - 1),
    siguiente: mes === 12 ? rangoDeMes(anio + 1, 1) : rangoDeMes(anio, mes + 1),
  };
}

/**
 * Filtros: dos formularios GET independientes (mes; desde/hasta). El parser da
 * prioridad al rango, por eso van separados. Sin JavaScript: el navegador arma la URL.
 */
function FiltroFechas({ rango }: { rango: RangoFechas }) {
  const mes = rango.desdeISO.slice(0, 7);
  const vecinos = mesesVecinos(rango);

  return (
    <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <form method="get" action={RUTA} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-40 text-xs font-medium text-slate-600">
          Mes
          <input type="month" name="mes" defaultValue={mes} min="2000-01" max="2100-12" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <button type="submit" className={CLASE_BOTON}>
          Ver mes
        </button>
        {vecinos ? (
          <span className="flex items-center gap-1">
            <a href={`${RUTA}?${vecinos.anterior.query}`} aria-label={`Mes anterior: ${vecinos.anterior.etiqueta}`} className={CLASE_BOTON_SECUNDARIO}>
              &larr;
            </a>
            <a href={`${RUTA}?${vecinos.siguiente.query}`} aria-label={`Mes siguiente: ${vecinos.siguiente.etiqueta}`} className={CLASE_BOTON_SECUNDARIO}>
              &rarr;
            </a>
          </span>
        ) : null}
      </form>

      <form method="get" action={RUTA} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className="min-w-0 flex-1 basis-36 text-xs font-medium text-slate-600">
          Desde
          <input type="date" name="desde" defaultValue={rango.desdeISO} min="2000-01-01" max="2100-12-31" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <label className="min-w-0 flex-1 basis-36 text-xs font-medium text-slate-600">
          Hasta (incluido)
          <input type="date" name="hasta" defaultValue={rango.hastaISO} min="2000-01-01" max="2100-12-31" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <button type="submit" className={CLASE_BOTON}>
          Ver rango
        </button>
      </form>

      {rango.tipo === "rango" || !rango.porDefecto ? (
        <Link href={RUTA} className="inline-block min-h-11 py-2 text-sm font-medium text-slate-600 underline">
          Volver al mes actual
        </Link>
      ) : null}
    </div>
  );
}
