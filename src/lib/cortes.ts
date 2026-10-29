import Decimal from "decimal.js";
import { aMoneda, CERO, type Dinero } from "./money";

export type Plancha = {
  /** Medidas en cm. */
  anchoCm: Dinero;
  altoCm: Dinero;
  precio: Dinero;
};

export type Corte = { anchoCm: Dinero; altoCm: Dinero };

/**
 * Precio de un corte, proporcional al area de la plancha, mas un recargo
 * porcentual (desperdicio, mano de obra). Devuelve null si falta algun dato.
 */
export function precioCorte(
  plancha: Plancha,
  corte: Corte,
  recargoPct: Dinero = CERO,
): Dinero | null {
  const areaPlancha = plancha.anchoCm.times(plancha.altoCm);
  const areaCorte = corte.anchoCm.times(corte.altoCm);
  if (areaPlancha.lte(0) || areaCorte.lte(0) || plancha.precio.lte(0)) return null;

  const base = plancha.precio.times(areaCorte).div(areaPlancha);
  return aMoneda(base.times(new Decimal(1).plus(recargoPct.div(100))));
}

/** Cuantos cortes enteros entran en la plancha (grilla simple, con rotacion). */
export function cortesPorPlancha(plancha: Plancha, corte: Corte): number {
  const a = plancha.anchoCm.toNumber();
  const h = plancha.altoCm.toNumber();
  const w = corte.anchoCm.toNumber();
  const l = corte.altoCm.toNumber();
  if (w <= 0 || l <= 0) return 0;
  const normal = Math.floor(a / w) * Math.floor(h / l);
  const rotado = Math.floor(a / l) * Math.floor(h / w);
  return Math.max(normal, rotado);
}

