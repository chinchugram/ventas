import { fmtFecha, fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPorcentaje, type Dinero } from "@/lib/money";
import { getMargenReal } from "@/lib/queries/margen-real";
import { hayDesvio, mayoresDesvios, textoPct, type Comparacion } from "@/lib/margen-real";
import { conRango, parseRangoFechas, type ParamsFecha } from "@/lib/rango-fechas";
import { Boton, Seccion, Tarjeta, Vacio } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";
import { AvisosFiltro, FiltroFechas, Reporte } from "../_componentes/comunes";
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
        epigrafe="Lo que costó de verdad"
        titulo="Margen real"
        descripcion={`Período: ${rango.etiqueta} · por fecha del trabajo`}
        accion={
          <Boton href="/reportes" variante="secundario">
            Reportes
          </Boton>
        }
      />

      <FiltroFechas rango={rango} ruta={RUTA} />

      <AvisosFiltro avisos={rango.avisos} />

      {!hayTrabajos ? (
        <Vacio
          mensaje="Ningún trabajo de producción cargado en el período."
          hint="El margen real se calcula con lo que realmente se usó en cada trabajo (materiales y minutos). Cuando haya trabajos cargados en estas fechas, acá se compara su costo real contra la receta. Probá con otro período."
        />
      ) : (
        <>
          <Reporte badge="Por período" titulo="Resumen" descripcion="Todos los trabajos del período. El margen es sobre el precio de venta sin IVA de cada línea.">
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
            badge="Por período"
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
            badge="Por período"
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
            badge="Por período"
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
