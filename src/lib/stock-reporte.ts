/**
 * Reportes de stock: valorizacion, rotacion y materiales sin movimiento.
 *
 * Logica pura (sin base): la consulta esta en `queries/stock.ts`, que arma
 * estos insumos desde el libro `MovimientoStock`.
 *
 * Convenciones comunes a los tres reportes
 * ----------------------------------------
 * - Todo se valoriza al COSTO ACTUAL del material (`costoUnitario`). El libro
 *   de stock no guarda el costo de cada movimiento, asi que no hay costo
 *   historico: un periodo viejo se valoriza a costo de hoy.
 * - Cantidades y dinero en `Decimal`; nunca `number`. Las unicas excepciones
 *   son los dias enteros que pasaron (`diasSinMovimiento`), que son conteos.
 * - Un resultado que no se puede calcular es `null`, nunca 0, NaN ni Infinity:
 *   "rotacion 0" significa "hubo stock y no salio nada", no "no se sabe".
 * - Periodos: `desde` inclusivo, `hasta` exclusivo (como en la consulta).
 *
 * Rotacion (por material, en un periodo de `dias` dias)
 * -----------------------------------------------------
 *   consumo        = unidades que salieron por ventas en el periodo, neto de
 *                    anulaciones (lo que arma la consulta). Si el neto da
 *                    negativo (se anulo en el periodo una venta de uno
 *                    anterior) se toma 0: no existe consumo negativo.
 *   stockPromedio  = (stockInicial + stockFinal) / 2
 *   rotacion       = consumo / stockPromedio             [veces en el periodo]
 *   consumoDiario  = consumo / dias
 *   coberturaDias  = stockFinal / consumoDiario           [= stockFinal × dias / consumo]
 *
 *   stockInicial es el stock al instante `desde`; stockFinal, al instante
 *   `hasta`. Con promedio de dos puntas no se ven los vaivenes dentro del
 *   periodo (una compra grande a mitad de mes cuenta a medias): es una
 *   aproximacion, la misma para todos los materiales.
 *
 *   Casos sin dato (el campo `estado` lo dice):
 *   - SIN_ACTIVIDAD: no hubo consumo ni stock promedio. rotacion y cobertura = null.
 *   - SIN_CONSUMO:   hubo stock y no salio nada. rotacion = 0, cobertura = null
 *                    (con consumo cero la cobertura seria infinita, no se inventa).
 *   - SIN_STOCK:     salio material pero el stock promedio es 0 (entro y salio
 *                    dentro del periodo, o se vendio lo que no figuraba). rotacion = null
 *                    (dividir por 0); cobertura = stockFinal × dias / consumo (0 si no queda).
 *   - CALCULADA:     hay consumo y stock promedio positivos: todo definido.
 *
 *   Resumen global: lo mismo pero en pesos (consumo y stock a costo):
 *   rotacionGlobal = valorConsumo / valorPromedio,
 *   coberturaGlobalDias = valorFinal × dias / valorConsumo.
 */
import Decimal from "decimal.js";
import { aMoneda, CERO, d, type Dinero, porcentaje, sumar } from "@/lib/money";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

/** Valor de una cantidad de stock a costo, redondeado a centavos como en /materiales. */
export function valorDeStock(stock: Dinero | string, costoUnitario: Dinero | string): Dinero {
  return aMoneda(d(stock).times(d(costoUnitario)));
}

// ─── Valorizacion ─────────────────────────────────────────────────────────────

export type MaterialValorizable = {
  id: string;
  nombre: string;
  stockActual: Dinero;
  costoUnitario: Dinero;
};

export type LineaValorizada<T extends MaterialValorizable = MaterialValorizable> = T & {
  /** stockActual × costoUnitario, a centavos. */
  valor: Dinero;
  /** Que parte del valor total del stock es este material, en % (2 decimales). */
  participacion: Dinero;
};

export type Valorizacion<T extends MaterialValorizable = MaterialValorizable> = {
  /** De mayor a menor valor; a igual valor, por nombre. */
  lineas: LineaValorizada<T>[];
  /** Suma de los valores ya redondeados de cada material. */
  total: Dinero;
};

/** Valor del stock: cantidad × costo por material y total. */
export function valorizarStock<T extends MaterialValorizable>(materiales: T[]): Valorizacion<T> {
  const valoradas = materiales.map((m) => ({ ...m, valor: valorDeStock(m.stockActual, m.costoUnitario) }));
  const total = sumar(...valoradas.map((l) => l.valor));
  const lineas = valoradas
    .map((l) => ({ ...l, participacion: porcentaje(l.valor, total) }))
    .sort((a, b) => b.valor.cmp(a.valor) || comparar(a.nombre, b.nombre));
  return { lineas, total };
}

// ─── Rotacion ─────────────────────────────────────────────────────────────────

/** Dias que dura el periodo [desde, hasta). Puede ser fraccionario. Falla si hasta <= desde. */
export function diasDelPeriodo(desde: Date, hasta: Date): Dinero {
  const ms = hasta.getTime() - desde.getTime();
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error("El periodo es invalido: 'hasta' tiene que ser posterior a 'desde'.");
  }
  return d(ms).div(MS_POR_DIA);
}

export type MaterialParaRotacion = {
  id: string;
  nombre: string;
  costoUnitario: Dinero;
  /** Stock al instante `desde`. */
  stockInicial: Dinero;
  /** Stock al instante `hasta`. */
  stockFinal: Dinero;
  /** Salidas por ventas del periodo, neto de anulaciones (positivo = salio). */
  consumo: Dinero;
};

export type EstadoRotacion = "CALCULADA" | "SIN_CONSUMO" | "SIN_STOCK" | "SIN_ACTIVIDAD";

export type LineaRotacion<T extends MaterialParaRotacion = MaterialParaRotacion> = T & {
  /** Consumo usado en las cuentas (nunca negativo). */
  consumoPeriodo: Dinero;
  stockPromedio: Dinero;
  /** Veces que roto el stock en el periodo (2 decimales). null si no se puede calcular. */
  rotacion: Dinero | null;
  /** Consumo por dia (4 decimales). */
  consumoDiario: Dinero;
  /** Dias que alcanza el stock final al ritmo del periodo (1 decimal). null sin consumo. */
  coberturaDias: Dinero | null;
  /** Consumo a costo (centavos). */
  valorConsumo: Dinero;
  /** Stock inicial y final a costo (centavos). */
  valorInicial: Dinero;
  valorFinal: Dinero;
  estado: EstadoRotacion;
};

export type ResumenRotacion = {
  dias: Dinero;
  valorInicial: Dinero;
  valorFinal: Dinero;
  /** (valorInicial + valorFinal) / 2 */
  valorPromedio: Dinero;
  valorConsumo: Dinero;
  /** valorConsumo / valorPromedio (2 decimales). null si el stock promedio es 0. */
  rotacionGlobal: Dinero | null;
  /** valorFinal × dias / valorConsumo (1 decimal). null sin consumo. */
  coberturaGlobalDias: Dinero | null;
};

export type ReporteRotacion<T extends MaterialParaRotacion = MaterialParaRotacion> = {
  lineas: LineaRotacion<T>[];
  resumen: ResumenRotacion;
};

const DOS = Decimal.ROUND_HALF_UP;

/** Rotacion de cada material y global, en un periodo de `dias` dias (> 0). */
export function calcularRotacion<T extends MaterialParaRotacion>(
  materiales: T[],
  dias: Dinero,
): ReporteRotacion<T> {
  if (dias.cmp(0) <= 0) throw new Error("Los dias del periodo tienen que ser mayores que 0.");

  const lineas = materiales.map((m): LineaRotacion<T> => {
    const consumoPeriodo = m.consumo.cmp(0) > 0 ? m.consumo : CERO;
    const stockPromedio = m.stockInicial.plus(m.stockFinal).div(2);
    const hayConsumo = consumoPeriodo.cmp(0) > 0;
    const hayStock = stockPromedio.cmp(0) > 0;

    const estado: EstadoRotacion = hayConsumo
      ? hayStock
        ? "CALCULADA"
        : "SIN_STOCK"
      : hayStock
        ? "SIN_CONSUMO"
        : "SIN_ACTIVIDAD";

    const rotacion = hayStock ? consumoPeriodo.div(stockPromedio).toDecimalPlaces(2, DOS) : null;
    const stockFinalPositivo = m.stockFinal.cmp(0) > 0 ? m.stockFinal : CERO;
    const coberturaDias = hayConsumo
      ? stockFinalPositivo.times(dias).div(consumoPeriodo).toDecimalPlaces(1, DOS)
      : null;

    return {
      ...m,
      consumoPeriodo,
      stockPromedio,
      rotacion,
      consumoDiario: consumoPeriodo.div(dias).toDecimalPlaces(4, DOS),
      coberturaDias,
      valorConsumo: valorDeStock(consumoPeriodo, m.costoUnitario),
      valorInicial: valorDeStock(m.stockInicial, m.costoUnitario),
      valorFinal: valorDeStock(m.stockFinal, m.costoUnitario),
      estado,
    };
  });

  lineas.sort((a, b) => b.valorConsumo.cmp(a.valorConsumo) || comparar(a.nombre, b.nombre));

  const valorInicial = sumar(...lineas.map((l) => l.valorInicial));
  const valorFinal = sumar(...lineas.map((l) => l.valorFinal));
  const valorConsumo = sumar(...lineas.map((l) => l.valorConsumo));
  const valorPromedio = valorInicial.plus(valorFinal).div(2);

  return {
    lineas,
    resumen: {
      dias,
      valorInicial,
      valorFinal,
      valorPromedio,
      valorConsumo,
      rotacionGlobal: valorPromedio.cmp(0) > 0 ? valorConsumo.div(valorPromedio).toDecimalPlaces(2, DOS) : null,
      coberturaGlobalDias:
        valorConsumo.cmp(0) > 0 ? valorFinal.times(dias).div(valorConsumo).toDecimalPlaces(1, DOS) : null,
    },
  };
}

// ─── Sin movimiento ───────────────────────────────────────────────────────────

export type MaterialParaInmovilizado = {
  id: string;
  nombre: string;
  stockActual: Dinero;
  costoUnitario: Dinero;
  /** Ultimo movimiento de cualquier tipo (compra, venta o ajuste). null si nunca tuvo. */
  ultimoMovimiento: Date | null;
  /** Alta del material: referencia para los que nunca tuvieron movimientos. */
  creadoEn: Date;
};

export type LineaSinMovimiento<T extends MaterialParaInmovilizado = MaterialParaInmovilizado> = T & {
  /** true si el material no tiene ningun movimiento: los dias cuentan desde el alta. */
  nuncaSeMovio: boolean;
  /** Dias enteros transcurridos desde el ultimo movimiento (o el alta). */
  diasSinMovimiento: number;
  /** stockActual × costoUnitario: plata parada. */
  valorInmovilizado: Dinero;
};

export type SinMovimiento<T extends MaterialParaInmovilizado = MaterialParaInmovilizado> = {
  /** Mas plata parada primero; a igual valor, mas dias primero, despues por nombre. */
  lineas: LineaSinMovimiento<T>[];
  totalInmovilizado: Dinero;
  /** Umbral usado. */
  dias: number;
};

/**
 * Materiales cuyo ultimo movimiento fue hace `dias` dias o mas (>=), contados
 * hasta `ahora`. Los materiales sin stock se omiten salvo `incluirSinStock`:
 * sin stock no hay nada inmovilizado.
 * El llamador pasa solo materiales activos.
 */
export function sinMovimiento<T extends MaterialParaInmovilizado>(
  materiales: T[],
  dias: number,
  ahora: Date,
  opciones: { incluirSinStock?: boolean } = {},
): SinMovimiento<T> {
  if (!Number.isInteger(dias) || dias < 0) {
    throw new Error("Los dias tienen que ser un entero mayor o igual a 0.");
  }
  const lineas: LineaSinMovimiento<T>[] = [];
  for (const m of materiales) {
    if (!opciones.incluirSinStock && m.stockActual.cmp(0) <= 0) continue;
    const referencia = m.ultimoMovimiento ?? m.creadoEn;
    const diasSinMovimiento = Math.max(0, Math.floor((ahora.getTime() - referencia.getTime()) / MS_POR_DIA));
    if (diasSinMovimiento < dias) continue;
    lineas.push({
      ...m,
      nuncaSeMovio: m.ultimoMovimiento === null,
      diasSinMovimiento,
      valorInmovilizado: valorDeStock(m.stockActual, m.costoUnitario),
    });
  }
  lineas.sort(
    (a, b) =>
      b.valorInmovilizado.cmp(a.valorInmovilizado) ||
      b.diasSinMovimiento - a.diasSinMovimiento ||
      comparar(a.nombre, b.nombre),
  );
  return { lineas, totalInmovilizado: sumar(...lineas.map((l) => l.valorInmovilizado)), dias };
}
