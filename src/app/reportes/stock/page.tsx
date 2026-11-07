import { fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPorcentaje, type Dinero } from "@/lib/money";
import {
  getConsumoRealVsTeorico,
  getRotacionStock,
  getStockSinMovimiento,
  getValorizacionStock,
  type ConsumoRealVsTeorico,
} from "@/lib/queries/stock";
import { parseRangoFechas, type ParamsFecha, type RangoFechas } from "@/lib/rango-fechas";
import { Boton, claseBoton, Etiqueta, Seccion, Tabla, Tarjeta, Vacio } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";
import { AvisosFiltro, FiltroFechas, Reporte } from "../_componentes/comunes";

export const dynamic = "force-dynamic";

/**
 * Reportes de stock. Solo presentacion: todos los importes, participaciones,
 * diferencias y totales vienen de `lib/queries/stock.ts`.
 *
 *   1. Valorizacion          (A HOY: stock actual a costo actual)
 *   2. Sin movimiento        (A HOY, con el umbral `dias`)
 *   3. Consumo real vs teorico (por periodo)
 *   4. Rotacion y cobertura  (por periodo)
 *
 * Filtros en la URL (`?mes=AAAA-MM` o `?desde=..&hasta=..`, y `?dias=N`), como
 * en /reportes: los formularios son GET y el link sirve tal cual.
 */

const DIAS_DEFECTO = 60;
const DIAS_MAX = 365;

const ESTADO_ROTACION = {
  CALCULADA: "Calculada",
  SIN_CONSUMO: "Sin consumo",
  SIN_STOCK: "Sin stock",
  SIN_ACTIVIDAD: "Sin actividad",
} as const;

export default async function ReporteStockPage({ searchParams }: { searchParams: Promise<ParamsFecha> }) {
  await requierePermisoPagina("verReportes", "verCostos");
  const params = await searchParams;
  const rango = parseRangoFechas(params);
  const { dias, aviso: avisoDias } = leerDias(params.dias);
  const avisos = avisoDias ? [...rango.avisos, avisoDias] : rango.avisos;

  const [valorizacion, rotacion, sinMov, consumo] = await Promise.all([
    getValorizacionStock(),
    getRotacionStock(rango.desde, rango.hasta),
    getStockSinMovimiento(dias),
    getConsumoRealVsTeorico(rango.desde, rango.hasta),
  ]);

  return (
    <>
      <Seccion
        epigrafe="Lo que hay en el taller"
        titulo="Reportes de stock"
        descripcion={`Período: ${rango.etiqueta} · sin movimiento: ${dias} ${dias === 1 ? "día" : "días"}`}
        accion={
          <Boton href="/reportes" variante="secundario">
            Reportes
          </Boton>
        }
      />

      <FiltroFechas rango={rango} ruta="/reportes/stock" conservar={{ dias }}>
        <FormularioDias rango={rango} dias={dias} />
      </FiltroFechas>

      <AvisosFiltro avisos={avisos} />

      <Reporte
        titulo="1. Valorización"
        descripcion="Stock actual de cada material a costo actual. No cambia con el período."
        badge="A hoy"
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta
            titulo="Valor del stock"
            valor={fmtMonedaCorta(valorizacion.total)}
            detalle={`${fmtNumero(valorizacion.lineas.length)} ${valorizacion.lineas.length === 1 ? "material" : "materiales"}`}
          />
        </div>
        {valorizacion.lineas.length === 0 ? (
          <Vacio mensaje="Ningún material con stock." hint="Cuando haya materiales activos, se valoriza su stock acá." />
        ) : (
          <Tabla
            columnas={["Material", "Stock", "Costo unitario", "Valor", "Participación"]}
            filas={valorizacion.lineas.map((l) => [
              l.nombre,
              `${fmtNumero(l.stockActual)} ${l.unidad}`,
              fmtMoneda(l.costoUnitario),
              fmtMoneda(l.valor),
              fmtPorcentaje(l.participacion),
            ])}
          />
        )}
      </Reporte>

      <Reporte
        titulo="2. Sin movimiento"
        descripcion={`Materiales con stock y sin compras, ventas ni ajustes desde hace ${fmtNumero(sinMov.dias)} ${sinMov.dias === 1 ? "día" : "días"} o más.`}
        badge="A hoy"
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta
            titulo="Valor inmovilizado"
            valor={fmtMonedaCorta(sinMov.totalInmovilizado)}
            tono={sinMov.lineas.length > 0 ? "aviso" : "ok"}
            detalle={`${fmtNumero(sinMov.lineas.length)} ${sinMov.lineas.length === 1 ? "material" : "materiales"}`}
          />
        </div>
        {sinMov.lineas.length === 0 ? (
          <Vacio
            mensaje="Ningún material parado."
            hint={`Todo el stock tuvo movimiento en los últimos ${fmtNumero(sinMov.dias)} días.`}
          />
        ) : (
          <Tabla
            columnas={["Material", "Días sin mover", "Stock", "Valor inmovilizado"]}
            filas={sinMov.lineas.map((l) => [
              l.nombre,
              `${fmtNumero(l.diasSinMovimiento)}${l.nuncaSeMovio ? " (nunca se movió)" : ""}`,
              `${fmtNumero(l.stockActual)} ${l.unidad}`,
              fmtMoneda(l.valorInmovilizado),
            ])}
          />
        )}
      </Reporte>

      <Reporte
        titulo="3. Consumo real vs teórico"
        descripcion="Lo que debía salir según las recetas de lo vendido, contra lo que salió del stock. Los desvíos están resaltados."
        badge="Por período"
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tarjeta titulo="Teórico" valor={fmtMonedaCorta(consumo.totalValorTeorico)} detalle="a costo actual" />
          <Tarjeta titulo="Real" valor={fmtMonedaCorta(consumo.totalValorReal)} detalle="a costo actual" />
          <Tarjeta
            titulo="Diferencia"
            valor={fmtMonedaCorta(consumo.totalValorDiferencia)}
            tono={consumo.totalValorDiferencia.isZero() ? "ok" : "aviso"}
            detalle={`${fmtNumero(cantidadConDesvio(consumo))} con desvío`}
          />
        </div>
        {consumo.lineas.length === 0 ? (
          <Vacio mensaje="No salió ningún material en el período." hint="No hubo ventas con recetas de materiales en estas fechas." />
        ) : (
          <TablaConsumo lineas={consumo.lineas} />
        )}
      </Reporte>

      <Reporte
        titulo="4. Rotación y cobertura"
        descripcion="Cuántas veces rotó el stock en el período y cuántos días alcanza el stock final al ritmo del período."
        badge="Por período"
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta
            titulo="Rotación global"
            valor={rotacion.resumen.rotacionGlobal === null ? "—" : `${fmtNumero(rotacion.resumen.rotacionGlobal)} veces`}
            detalle="consumo ÷ stock promedio, a costo"
          />
          <Tarjeta
            titulo="Cobertura global"
            valor={rotacion.resumen.coberturaGlobalDias === null ? "—" : `${fmtNumero(rotacion.resumen.coberturaGlobalDias)} días`}
            detalle="al ritmo del período"
          />
        </div>
        {rotacion.lineas.length === 0 ? (
          <Vacio mensaje="Todavía no hay materiales activos." hint="Cargá el primero en Materiales y acá ves cuánto rota." />
        ) : (
          <Tabla
            columnas={["Material", "Consumo", "Rotación", "Cobertura (días)", "Estado"]}
            filas={rotacion.lineas.map((l) => [
              l.nombre,
              `${fmtNumero(l.consumoPeriodo)} ${l.unidad}`,
              l.rotacion === null ? "—" : `${fmtNumero(l.rotacion)} veces`,
              l.coberturaDias === null ? "—" : fmtNumero(l.coberturaDias),
              ESTADO_ROTACION[l.estado],
            ])}
          />
        )}
      </Reporte>
    </>
  );
}

/**
 * `?dias=N`: entero entre 1 y 365. Vacio o invalido → 60, con aviso si vino algo.
 * No lanza: la pantalla de lectura no se cae por un parametro mal escrito.
 */
function leerDias(valor: string | string[] | undefined): { dias: number; aviso: string | null } {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const texto = bruto?.trim();
  if (!texto) return { dias: DIAS_DEFECTO, aviso: null };
  const n = /^\d+$/.test(texto) ? Number(texto) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= DIAS_MAX) return { dias: n, aviso: null };
  return {
    dias: DIAS_DEFECTO,
    aviso: `Días inválidos "${texto}" (se espera un entero entre 1 y ${DIAS_MAX}); se usaron ${DIAS_DEFECTO}.`,
  };
}

/** Solo da signo visual a un valor ya calculado: no altera la cuenta. */
function conSigno(texto: string, valor: Dinero): string {
  return valor.cmp(0) > 0 ? `+${texto}` : texto;
}

function hayDesvio(l: ConsumoRealVsTeorico["lineas"][number]): boolean {
  return !l.diferencia.isZero();
}

function cantidadConDesvio(consumo: ConsumoRealVsTeorico): number {
  return consumo.lineas.filter(hayDesvio).length;
}

/**
 * Consumo real vs teorico. Igual que `Tabla` (tabla en desktop, tarjetas en
 * mobile), pero con los desvios resaltados: `Tabla` no puede pintar celdas.
 */
function TablaConsumo({ lineas }: { lineas: ConsumoRealVsTeorico["lineas"] }) {
  const columnas = ["Material", "Teórico", "Real", "Diferencia", "Dif. %", "Valor dif."];

  const celdas = (l: ConsumoRealVsTeorico["lineas"][number]) => [
    `${fmtNumero(l.teorico)} ${l.unidad}`,
    `${fmtNumero(l.real)} ${l.unidad}`,
    conSigno(`${fmtNumero(l.diferencia)} ${l.unidad}`, l.diferencia),
    l.diferenciaPct === null ? "—" : conSigno(fmtPorcentaje(l.diferenciaPct), l.diferenciaPct),
    conSigno(fmtMoneda(l.valorDiferencia), l.valorDiferencia),
  ];

  return (
    <>
      {/* Desktop: tabla normal. */}
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
            {lineas.map((l) => (
              <tr key={l.id} className={hayDesvio(l) ? "bg-aviso-soft" : undefined}>
                <td className="font-semibold text-ink">
                  {l.nombre}
                  {hayDesvio(l) ? <EtiquetaDesvio /> : null}
                </td>
                {celdas(l).map((c, j) => (
                  <td key={j} className="tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: tarjetas apiladas; el desvio se marca con borde y texto, no solo color. */}
      <div className="space-y-2 sm:hidden">
        {lineas.map((l) => (
          <div key={l.id} className={`tarjeta p-3 ${hayDesvio(l) ? "border-aviso-line bg-aviso-soft" : ""}`}>
            <p className="font-semibold text-ink">
              {l.nombre}
              {hayDesvio(l) ? <EtiquetaDesvio /> : null}
            </p>
            <dl className="mt-2 space-y-1">
              {celdas(l).map((c, j) => (
                <div key={j} className="flex items-baseline justify-between gap-3">
                  <dt className="eyebrow">{columnas[j + 1]}</dt>
                  <dd className="text-body-sm font-semibold tabular-nums text-ink">{c}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function EtiquetaDesvio() {
  return (
    <Etiqueta tono="aviso" className="ml-2 align-middle">
      Desvío
    </Etiqueta>
  );
}

/**
 * Días sin movimiento: tercer formulario GET del filtro. Lleva el período en hidden inputs, para no
 * perderlo al cambiar los días.
 */
function FormularioDias({ rango, dias }: { rango: RangoFechas; dias: number }) {
  return (
    <form method="get" action="/reportes/stock" className="flex flex-wrap items-end gap-3 border-t-(length:--border-width) border-line pt-3">
      {rango.tipo === "mes" ? (
        <input type="hidden" name="mes" value={rango.desdeISO.slice(0, 7)} />
      ) : (
        <>
          <input type="hidden" name="desde" value={rango.desdeISO} />
          <input type="hidden" name="hasta" value={rango.hastaISO} />
        </>
      )}
      <label className="mb-0 min-w-0 flex-1 basis-40">
        Días sin movimiento (1 a {DIAS_MAX})
        <input type="number" name="dias" defaultValue={dias} min={1} max={DIAS_MAX} step={1} inputMode="numeric" required className="mt-1" />
      </label>
      <button type="submit" className={claseBoton({ variante: "secundario" })}>
        Aplicar días
      </button>
    </form>
  );
}
