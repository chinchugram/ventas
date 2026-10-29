import Link from "next/link";
import { fmtMoneda, fmtMonedaCorta, fmtNumero, fmtPorcentaje, type Dinero } from "@/lib/money";
import {
  getConsumoRealVsTeorico,
  getRotacionStock,
  getStockSinMovimiento,
  getValorizacionStock,
  type ConsumoRealVsTeorico,
} from "@/lib/queries/stock";
import { parseRangoFechas, rangoDeMes, type ParamsFecha, type RangoFechas } from "@/lib/rango-fechas";
import { Seccion, Tabla, Tarjeta, Vacio } from "@/components/ui";

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

const CLASE_INPUT = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const CLASE_BOTON = "min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700";
const CLASE_BOTON_SECUNDARIO =
  "flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700";

export default async function ReporteStockPage({ searchParams }: { searchParams: Promise<ParamsFecha> }) {
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
        titulo="Reportes de stock"
        descripcion={`Período: ${rango.etiqueta} · sin movimiento: ${dias} ${dias === 1 ? "día" : "días"}`}
        accion={
          <Link href="/reportes" className={CLASE_BOTON_SECUNDARIO}>
            Reportes
          </Link>
        }
      />

      <FiltroStock rango={rango} dias={dias} />

      {avisos.length > 0 ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <ul className="space-y-1">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

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
          <Vacio mensaje="No hay materiales con stock" hint="Cuando haya materiales activos, se valoriza su stock acá." />
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
            mensaje="Ningún material parado"
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
          <Vacio mensaje="Sin consumo en el período" hint="No hubo ventas con recetas de materiales en estas fechas." />
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
          <Vacio mensaje="No hay materiales activos" />
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

function Reporte({
  titulo,
  descripcion,
  badge,
  children,
}: {
  titulo: string;
  descripcion?: string;
  badge: "Por período" | "A hoy";
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            badge === "A hoy" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {badge}
        </span>
      </div>
      {descripcion ? <p className="mb-3 text-sm text-slate-500">{descripcion}</p> : null}
      {children}
    </section>
  );
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
            {lineas.map((l) => (
              <tr key={l.id} className={hayDesvio(l) ? "bg-amber-50" : undefined}>
                <td className="font-medium text-slate-900">
                  {l.nombre}
                  {hayDesvio(l) ? <BadgeDesvio /> : null}
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
          <div
            key={l.id}
            className={`rounded-xl border p-3 ${hayDesvio(l) ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
          >
            <p className="font-medium text-slate-900">
              {l.nombre}
              {hayDesvio(l) ? <BadgeDesvio /> : null}
            </p>
            <dl className="mt-2 space-y-1">
              {celdas(l).map((c, j) => (
                <div key={j} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-slate-500">{columnas[j + 1]}</dt>
                  <dd className="text-sm font-medium tabular-nums text-slate-800">{c}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function BadgeDesvio() {
  return (
    <span className="ml-2 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 align-middle text-xs font-semibold text-amber-800">
      Desvío
    </span>
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
 * Filtros: formularios GET independientes (mes; desde/hasta; dias). Cada uno
 * lleva el resto del filtro en hidden inputs, para no perder el periodo ni los
 * dias al cambiar otro. El parser da prioridad al rango, por eso van separados.
 */
function FiltroStock({ rango, dias }: { rango: RangoFechas; dias: number }) {
  const esMes = rango.tipo === "mes";
  const mes = rango.desdeISO.slice(0, 7);
  const vecinos = mesesVecinos(rango);

  return (
    <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <form method="get" action="/reportes/stock" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="dias" value={dias} />
        <label className="min-w-0 flex-1 basis-40 text-xs font-medium text-slate-600">
          Mes
          <input type="month" name="mes" defaultValue={mes} min="2000-01" max="2100-12" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <button type="submit" className={CLASE_BOTON}>
          Ver mes
        </button>
        {vecinos ? (
          <span className="flex items-center gap-1">
            <a
              href={`/reportes/stock?${vecinos.anterior.query}&dias=${dias}`}
              aria-label={`Mes anterior: ${vecinos.anterior.etiqueta}`}
              className={CLASE_BOTON_SECUNDARIO}
            >
              &larr;
            </a>
            <a
              href={`/reportes/stock?${vecinos.siguiente.query}&dias=${dias}`}
              aria-label={`Mes siguiente: ${vecinos.siguiente.etiqueta}`}
              className={CLASE_BOTON_SECUNDARIO}
            >
              &rarr;
            </a>
          </span>
        ) : null}
      </form>

      <form method="get" action="/reportes/stock" className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <input type="hidden" name="dias" value={dias} />
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

      <form method="get" action="/reportes/stock" className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        {esMes ? (
          <input type="hidden" name="mes" value={mes} />
        ) : (
          <>
            <input type="hidden" name="desde" value={rango.desdeISO} />
            <input type="hidden" name="hasta" value={rango.hastaISO} />
          </>
        )}
        <label className="min-w-0 flex-1 basis-40 text-xs font-medium text-slate-600">
          Días sin movimiento (1 a {DIAS_MAX})
          <input type="number" name="dias" defaultValue={dias} min={1} max={DIAS_MAX} step={1} inputMode="numeric" required className={`mt-1 ${CLASE_INPUT}`} />
        </label>
        <button type="submit" className={CLASE_BOTON}>
          Aplicar días
        </button>
      </form>

      {rango.tipo === "rango" || !rango.porDefecto ? (
        <Link href={`/reportes/stock?dias=${dias}`} className="inline-block min-h-11 py-2 text-sm font-medium text-slate-600 underline">
          Volver al mes actual
        </Link>
      ) : null}
    </div>
  );
}
