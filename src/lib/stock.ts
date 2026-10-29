import { aMoneda, CERO, d, type Dinero, sumar } from "@/lib/money";

export type LineaCompra = { cantidad: string; costoUnitario: string };

/** Subtotal de una linea de compra, redondeado a centavos como se guarda. */
export function subtotalCompra(cantidad: Dinero | string, costoUnitario: Dinero | string): Dinero {
  return aMoneda(d(cantidad).times(d(costoUnitario)));
}

/** Total de una compra: suma de subtotales ya redondeados, igual que en la base. */
export function totalizarCompra(lineas: LineaCompra[]): Dinero {
  return sumar(...lineas.map((l) => subtotalCompra(l.cantidad, l.costoUnitario)));
}

/** Cuanto falta para llegar al minimo. 0 si no hay minimo o ya se alcanzo. */
export function faltanteParaMinimo(stockActual: Dinero, stockMinimo: Dinero): Dinero {
  if (stockMinimo.cmp(0) <= 0) return CERO;
  const falta = stockMinimo.minus(stockActual);
  return falta.cmp(0) > 0 ? falta : CERO;
}

/** Diferencia entre lo contado y lo que dice el sistema. Positivo = sobra. */
export function diferenciaDeConteo(stockSistema: Dinero, stockContado: Dinero): Dinero {
  return stockContado.minus(stockSistema);
}
