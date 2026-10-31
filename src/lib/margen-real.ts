/**
 * Margen real (ola 6, 6.2): costo REAL de cada trabajo de produccion contra el
 * costo de receta de la misma linea de venta.
 *
 * Logica pura (sin base): la consulta esta en `queries/margen-real.ts`, que arma
 * estos insumos desde `TrabajoProduccion`. Todo en `Decimal` (nunca `number`).
 *
 * Costo real de un trabajo (costos CONGELADOS al cargarlo, ver `docs/02-modelo-datos.md`)
 * --------------------------------------------------------------------------------------
 *   materiales = Σ cantidad × costoUnitarioSnapshot
 *   maquinas   = Σ minutos / 60 × costoHoraSnapshot
 *   manoObra   = minutosManoObra / 60 × costoHoraManoObraSnapshot
 *   real       = materiales + maquinas + manoObra
 *
 *   Cada componente se redondea a centavos y el total es la suma de los componentes
 *   ya redondeados (lo que se ve en pantalla suma exacto, sin centavos de diferencia).
 *
 * Comparacion contra la receta
 * ----------------------------
 *   receta     = `VentaItem.costoTotalSnapshot` (costo estimado, congelado al vender)
 *   precio     = `VentaItem.subtotalNeto` (sin IVA: el IVA no es ingreso del negocio)
 *   desvio     = real − receta            (positivo = costo mas de lo estimado)
 *   desvioPct  = desvio / receta × 100    (null si la receta cuesta 0)
 *   margen     = (precio − costo) / precio × 100   (null si el precio es 0)
 *   margenReal vs margenEstimado: `margenDifPuntos` = real − estimado, en puntos
 *   porcentuales (null si alguno de los dos no se puede calcular).
 *
 * Un resultado que no se puede calcular es `null`, nunca 0, NaN ni Infinity; la
 * pantalla lo muestra como "—" y el CSV como celda vacia.
 *
 * Los agregados (por articulo, por mes, total) recalculan los porcentajes sobre
 * las SUMAS (Σ precio, Σ receta, Σ real), no promedian porcentajes de cada trabajo.
 */
import Decimal from "decimal.js";
import type { Celda } from "@/lib/csv";
import { aMoneda, sumar, type Dinero } from "@/lib/money";
import { MESES_ES } from "@/lib/rango-fechas";

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

/** Porcentaje a 2 decimales; `null` si el denominador es 0 (no se inventa un numero). */
export function pctONulo(parte: Dinero, total: Dinero): Dinero | null {
  if (total.isZero()) return null;
  return parte.div(total).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// ─── Costo real de un trabajo ─────────────────────────────────────────────────

export type ConsumoParaMargen = { cantidad: Dinero; costoUnitarioSnapshot: Dinero };
export type TiempoParaMargen = { minutos: Dinero; costoHoraSnapshot: Dinero };

export type CostoRealInsumos = {
  consumos: readonly ConsumoParaMargen[];
  tiempos: readonly TiempoParaMargen[];
  minutosManoObra: Dinero;
  costoHoraManoObraSnapshot: Dinero;
};

export type CostoReal = {
  materiales: Dinero;
  maquinas: Dinero;
  manoObra: Dinero;
  total: Dinero;
};

const MINUTOS_POR_HORA = new Decimal(60);

/** Costo de `minutos` a un costo por hora: minutos / 60 × costoHora (sin redondear). */
function costoDeMinutos(minutos: Dinero, costoHora: Dinero): Dinero {
  return minutos.div(MINUTOS_POR_HORA).times(costoHora);
}

export function costoRealDeTrabajo(t: CostoRealInsumos): CostoReal {
  const materiales = aMoneda(sumar(...t.consumos.map((c) => c.cantidad.times(c.costoUnitarioSnapshot))));
  const maquinas = aMoneda(sumar(...t.tiempos.map((x) => costoDeMinutos(x.minutos, x.costoHoraSnapshot))));
  const manoObra = aMoneda(costoDeMinutos(t.minutosManoObra, t.costoHoraManoObraSnapshot));
  return { materiales, maquinas, manoObra, total: materiales.plus(maquinas).plus(manoObra) };
}

// ─── Comparacion de un renglon ────────────────────────────────────────────────

/** Un trabajo VIGENTE de una venta no anulada, con lo necesario para compararlo. */
export type TrabajoParaMargen = CostoRealInsumos & {
  id: string;
  fecha: Date;
  ventaId: string;
  ventaNumero: number;
  ventaAnio: number;
  articuloId: string;
  /** Nombre del articulo (el de hoy: es lo que agrupa el reporte). */
  articuloNombre: string;
  /** `VentaItem.cantidad`. */
  unidades: Dinero;
  /** `VentaItem.subtotalNeto`: el precio de venta de la linea, sin IVA. */
  precioNeto: Dinero;
  /** `VentaItem.costoTotalSnapshot`: el costo estimado por receta. */
  costoReceta: Dinero;
};

/** Lo comun de un renglon y de cualquier agregado: importes, desvio y margenes. */
export type Comparacion = {
  precioNeto: Dinero;
  costoReceta: Dinero;
  costoReal: Dinero;
  /** real − receta. Positivo = salio mas caro que lo estimado. */
  desvio: Dinero;
  /** desvio / receta × 100, o null si la receta cuesta 0. */
  desvioPct: Dinero | null;
  /** precio − receta. */
  gananciaEstimada: Dinero;
  /** precio − real. */
  gananciaReal: Dinero;
  /** Sobre el precio neto, o null si el precio es 0. */
  margenEstimadoPct: Dinero | null;
  margenRealPct: Dinero | null;
  /** margenReal − margenEstimado, en puntos porcentuales; null si falta alguno. */
  margenDifPuntos: Dinero | null;
};

export function comparar3(precioNeto: Dinero, costoReceta: Dinero, costoReal: Dinero): Comparacion {
  const desvio = costoReal.minus(costoReceta);
  const gananciaEstimada = precioNeto.minus(costoReceta);
  const gananciaReal = precioNeto.minus(costoReal);
  const margenEstimadoPct = pctONulo(gananciaEstimada, precioNeto);
  const margenRealPct = pctONulo(gananciaReal, precioNeto);
  return {
    precioNeto,
    costoReceta,
    costoReal,
    desvio,
    desvioPct: pctONulo(desvio, costoReceta),
    gananciaEstimada,
    gananciaReal,
    margenEstimadoPct,
    margenRealPct,
    margenDifPuntos: margenEstimadoPct && margenRealPct ? margenRealPct.minus(margenEstimadoPct) : null,
  };
}

export type LineaMargen = Comparacion & {
  id: string;
  fecha: Date;
  ventaId: string;
  ventaNumero: number;
  ventaAnio: number;
  articuloId: string;
  articuloNombre: string;
  unidades: Dinero;
  desglose: CostoReal;
};

export function compararTrabajo(t: TrabajoParaMargen): LineaMargen {
  const desglose = costoRealDeTrabajo(t);
  return {
    ...comparar3(t.precioNeto, t.costoReceta, desglose.total),
    id: t.id,
    fecha: t.fecha,
    ventaId: t.ventaId,
    ventaNumero: t.ventaNumero,
    ventaAnio: t.ventaAnio,
    articuloId: t.articuloId,
    articuloNombre: t.articuloNombre,
    unidades: t.unidades,
    desglose,
  };
}

// ─── Agregados ────────────────────────────────────────────────────────────────

export type Agregado = Comparacion & {
  trabajos: number;
  unidades: Dinero;
};

function agregar(lineas: readonly LineaMargen[]): Agregado {
  const base = comparar3(
    aMoneda(sumar(...lineas.map((l) => l.precioNeto))),
    aMoneda(sumar(...lineas.map((l) => l.costoReceta))),
    aMoneda(sumar(...lineas.map((l) => l.costoReal))),
  );
  return { ...base, trabajos: lineas.length, unidades: sumar(...lineas.map((l) => l.unidades)) };
}

export type FilaArticulo = Agregado & { articuloId: string; nombre: string };
export type FilaPeriodo = Agregado & {
  /** "AAAA-MM", segun `TrabajoProduccion.fecha`. */
  mes: string;
  etiqueta: string;
};

export type ReporteMargenReal = {
  total: Agregado;
  /** Mayor sobrecosto primero (desvio descendente); a igual desvio, por nombre. */
  porArticulo: FilaArticulo[];
  /** Cronologico. Un mes por fila, segun la fecha del trabajo. */
  porPeriodo: FilaPeriodo[];
  /** Cronologico (fecha, despues numero de venta). */
  lineas: LineaMargen[];
};

const claveMes = (f: Date) => `${String(f.getUTCFullYear()).padStart(4, "0")}-${String(f.getUTCMonth() + 1).padStart(2, "0")}`;

function etiquetaMes(mes: string): string {
  const [anio, m] = mes.split("-");
  return `${MESES_ES[Number(m) - 1]} ${anio}`;
}

/** Arma el reporte completo desde los trabajos vigentes ya filtrados por periodo. Sin trabajos: todo en cero. */
export function armarReporteMargenReal(trabajos: readonly TrabajoParaMargen[]): ReporteMargenReal {
  const lineas = trabajos
    .map(compararTrabajo)
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.ventaAnio - b.ventaAnio || a.ventaNumero - b.ventaNumero || comparar(a.id, b.id));

  const porArticulo = new Map<string, LineaMargen[]>();
  const porMes = new Map<string, LineaMargen[]>();
  for (const l of lineas) {
    porArticulo.set(l.articuloId, [...(porArticulo.get(l.articuloId) ?? []), l]);
    const mes = claveMes(l.fecha);
    porMes.set(mes, [...(porMes.get(mes) ?? []), l]);
  }

  return {
    total: agregar(lineas),
    porArticulo: [...porArticulo.entries()]
      .map(([articuloId, ls]) => ({
        articuloId,
        nombre: ls[0]!.articuloNombre,
        ...agregar(ls),
      }))
      .sort((a, b) => b.desvio.cmp(a.desvio) || comparar(a.nombre, b.nombre)),
    porPeriodo: [...porMes.entries()]
      .sort(([a], [b]) => comparar(a, b))
      .map(([mes, ls]) => ({ mes, etiqueta: etiquetaMes(mes), ...agregar(ls) })),
    lineas,
  };
}

/** Los `n` trabajos con mayor sobrecosto (desvio descendente, desempate por fecha reciente). */
export function mayoresDesvios(lineas: readonly LineaMargen[], n: number): LineaMargen[] {
  return [...lineas].sort((a, b) => b.desvio.cmp(a.desvio) || b.fecha.getTime() - a.fecha.getTime()).slice(0, Math.max(0, n));
}

/** Hay desvio si el costo real difiere de la receta al centavo. */
export const hayDesvio = (c: Pick<Comparacion, "desvio">): boolean => !c.desvio.isZero();

// ─── Presentacion (texto) ─────────────────────────────────────────────────────

/** Texto de un porcentaje que puede ser null: "—" cuando no se puede calcular. */
export function textoPct(valor: Dinero | null, formato: (v: Dinero) => string, conSigno = false): string {
  if (valor === null) return "—";
  const t = formato(valor);
  return conSigno && valor.cmp(0) > 0 ? `+${t}` : t;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────
// Las filas se arman aca (puro) para poder verificarlas sin Next; la route handler solo las manda a `construirCSV`.

const pct = (v: Dinero | null): Celda => (v === null ? null : { porcentaje: v });

const COLUMNAS_COMPARACION = [
  "Precio neto",
  "Costo receta",
  "Costo real",
  "Desvío $",
  "Desvío %",
  "Margen estimado %",
  "Margen real %",
  "Diferencia de margen (puntos)",
] as const;

const celdasComparacion = (c: Comparacion): Celda[] => [
  c.precioNeto,
  c.costoReceta,
  c.costoReal,
  c.desvio,
  pct(c.desvioPct),
  pct(c.margenEstimadoPct),
  pct(c.margenRealPct),
  pct(c.margenDifPuntos),
];

export type TablaCsv = { encabezados: string[]; filas: Celda[][] };

/** Fila "Total" de los CSV agregados; sin trabajos no hay nada que totalizar. */
const filaTotal = (r: ReporteMargenReal): Celda[][] =>
  r.total.trabajos === 0
    ? []
    : [["Total", String(r.total.trabajos), { cantidad: r.total.unidades, decimales: 3 }, ...celdasComparacion(r.total)]];

export function csvPorArticulo(r: ReporteMargenReal): TablaCsv {
  return {
    encabezados: ["Artículo", "Trabajos", "Unidades", ...COLUMNAS_COMPARACION],
    filas: [
      ...r.porArticulo.map((f): Celda[] => [f.nombre, String(f.trabajos), { cantidad: f.unidades, decimales: 3 }, ...celdasComparacion(f)]),
      ...filaTotal(r),
    ],
  };
}

export function csvPorPeriodo(r: ReporteMargenReal): TablaCsv {
  return {
    encabezados: ["Mes", "Trabajos", "Unidades", ...COLUMNAS_COMPARACION],
    filas: [
      ...r.porPeriodo.map((f): Celda[] => [f.mes, String(f.trabajos), { cantidad: f.unidades, decimales: 3 }, ...celdasComparacion(f)]),
      ...filaTotal(r),
    ],
  };
}

export function csvPorTrabajo(r: ReporteMargenReal): TablaCsv {
  return {
    encabezados: ["Fecha", "Venta", "Artículo", "Unidades", "Materiales", "Máquinas", "Mano de obra", ...COLUMNAS_COMPARACION],
    filas: r.lineas.map((l): Celda[] => [
      l.fecha,
      `${l.ventaNumero}/${l.ventaAnio}`,
      l.articuloNombre,
      { cantidad: l.unidades, decimales: 3 },
      l.desglose.materiales,
      l.desglose.maquinas,
      l.desglose.manoObra,
      ...celdasComparacion(l),
    ]),
  };
}

export const DETALLES_CSV = ["articulos", "periodos", "trabajos"] as const;
export type DetalleCsv = (typeof DETALLES_CSV)[number];

export function csvDe(detalle: DetalleCsv, r: ReporteMargenReal): TablaCsv {
  return detalle === "articulos" ? csvPorArticulo(r) : detalle === "periodos" ? csvPorPeriodo(r) : csvPorTrabajo(r);
}

/** `?detalle=`: vacio → "articulos"; desconocido → null (la route responde 400). */
export function leerDetalleCsv(valor: string | null): DetalleCsv | null {
  if (valor === null || valor.trim() === "") return "articulos";
  return (DETALLES_CSV as readonly string[]).includes(valor) ? (valor as DetalleCsv) : null;
}
