import Decimal from "decimal.js";

// Precision global: 20 digitos significativos. Mas que suficiente para ARS y
// para multiplicar porcantidades, y evita que una cadena de operaciones pierda
// centavos.
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type Dinero = Decimal;

export const CERO: Dinero = new Decimal(0);

/** Acepta number | string | Decimal sin perder precision. */
export function d(valor: Decimal | number | string | null | undefined): Dinero {
  if (valor === null || valor === undefined) return CERO;
  return new Decimal(valor);
}

export function sumar(...valores: (Decimal | number | string | null | undefined)[]): Dinero {
  return valores.reduce<Dinero>((acc, v) => acc.plus(d(v)), CERO);
}

/** Redondeo monetario a 2 decimales. Para displaying y para guardar totales. */
export function aMoneda(valor: Dinero): Dinero {
  return valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Redondeo a 4 decimales. Para costos unitarios y cantidades de receta, donde
 * 2 decimales perderian precision real (un m2 de vinilo no se paga en centavos).
 */
export function aCosto(valor: Dinero): Dinero {
  return valor.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Porcentaje seguro: si el denominador es 0 devuelve 0, nunca NaN ni Infinity. */
export function porcentaje(parte: Dinero, total: Dinero): Dinero {
  if (total.isZero()) return CERO;
  return parte.div(total).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

const formatoARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatoNumero = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 3,
});

const formatoPorcentaje = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function fmtMoneda(valor: Dinero | number | string | null | undefined): string {
  return formatoARS.format(d(valor).toNumber());
}

const formatoARSEntero = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Pesos sin centavos, para tarjetas y listados donde el ancho es escaso y los
 * centavos son ruido. Los costos y los comprobantes siguen usando `fmtMoneda`.
 */
export function fmtMonedaCorta(valor: Dinero | number | string | null | undefined): string {
  return formatoARSEntero.format(d(valor).toNumber());
}

export function fmtNumero(valor: Dinero | number | string | null | undefined): string {
  return formatoNumero.format(d(valor).toNumber());
}

export function fmtPorcentaje(valor: Dinero | number | string | null | undefined): string {
  return `${formatoPorcentaje.format(d(valor).toNumber())}%`;
}

export function fmtFecha(fecha: Date | null | undefined): string {
  if (!fecha) return "-";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(fecha);
}
