import Decimal from "decimal.js";
import { z } from "zod";
import { esDecimal, normalizarDecimal } from "@/lib/acciones";
import { CERO, d, type Dinero } from "@/lib/money";
import { subtotalCompra, totalizarCompra } from "@/lib/stock";

// Lista de reposicion: que comprar, cuanto y cuanto va a salir. Logica pura (sin
// Prisma ni Next): la usan la pantalla `/reposicion`, la precarga de `Nueva
// compra` y `scripts/verificar-reposicion.ts`.
//
// Regla: un material con minimo cargado y stock por debajo se repone hasta
// `minimo × factor`. El factor vive en `Configuracion` (clave `factorReposicion`)
// y por defecto es 2: comprar el doble del minimo evita volver a quedar justo.

// ─── Factor de reposicion ─────────────────────────────────────────────────────

export const CLAVE_FACTOR = "factorReposicion";
export const FACTOR_POR_DEFECTO = "2";
export const FACTOR_MAXIMO = d(10);

/** Factor valido: de 1 a 10, hasta 2 decimales. Devuelve el error o `null`. */
export function validarFactor(valor: string): string | null {
  if (!esDecimal(valor)) return "El factor debe ser un número entre 1 y 10";
  const n = d(normalizarDecimal(valor));
  if (n.lt(1)) return "El factor debe ser 1 o más (1 = reponer justo hasta el mínimo)";
  if (n.gt(FACTOR_MAXIMO)) return "El factor no puede pasar de 10";
  if (n.decimalPlaces() > 2) return "Usá hasta 2 decimales";
  return null;
}

/** Campo de zod: devuelve el factor en forma canonica ("1,50" → "1.5"). */
export const esquemaFactor = z.object({
  factor: z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const error = validarFactor(v);
      if (error) ctx.addIssue({ code: "custom", message: error });
    })
    .transform((v) => d(normalizarDecimal(v)).toString()),
});

/** Factor guardado si es valido; si falta o esta roto (cargado a mano), el por defecto. */
export function leerFactor(config: Record<string, string>): Dinero {
  const guardado = config[CLAVE_FACTOR];
  return d(guardado !== undefined && validarFactor(guardado) === null ? normalizarDecimal(guardado) : FACTOR_POR_DEFECTO);
}

// ─── Cantidad sugerida ────────────────────────────────────────────────────────

/** Unidades que no se compran partidas: la sugerencia se redondea hacia arriba al entero. */
const UNIDADES_ENTERAS = new Set(["U", "HOJA", "ROLLO"]);

/**
 * Cuanto comprar para volver a `minimo × factor`. 0 si no hay minimo cargado o
 * si el stock no esta por debajo del minimo (estar justo en el minimo no pide
 * compra todavia).
 *
 * Se redondea siempre hacia arriba: a 3 decimales (la precision del stock) o al
 * entero en unidades que se compran enteras (u, hoja, rollo).
 */
export function cantidadSugerida(
  stockActual: Dinero,
  stockMinimo: Dinero,
  factor: Dinero,
  unidad?: string,
): Dinero {
  if (stockMinimo.lte(0) || stockActual.gte(stockMinimo)) return CERO;
  const falta = stockMinimo.times(factor).minus(stockActual);
  if (falta.lte(0)) return CERO;
  const decimales = unidad && UNIDADES_ENTERAS.has(unidad) ? 0 : 3;
  return falta.toDecimalPlaces(decimales, Decimal.ROUND_UP);
}

export type MaterialParaReponer = {
  id: string;
  nombre: string;
  /** Codigo del enum (`M2`, `U`...): decide si la cantidad se redondea al entero. */
  unidad: string;
  stockActual: Dinero;
  stockMinimo: Dinero;
  costoUnitario: Dinero;
};

export type LineaReposicion<M extends MaterialParaReponer = MaterialParaReponer> = M & {
  cantidad: Dinero;
  /** Cantidad × costo vigente, redondeado a centavos como un subtotal de compra. */
  costoEstimado: Dinero;
};

export type Reposicion<M extends MaterialParaReponer = MaterialParaReponer> = {
  lineas: LineaReposicion<M>[];
  /** Lo que saldria la compra sugerida completa, igual que `totalizarCompra`. */
  total: Dinero;
};

/**
 * Materiales que hay que reponer, con cantidad y costo estimado. Primero los
 * agotados, despues por que tan lejos estan del minimo (stock / minimo), y a
 * igualdad por nombre.
 */
export function armarReposicion<M extends MaterialParaReponer>(materiales: M[], factor: Dinero): Reposicion<M> {
  const lineas = materiales
    .map((m) => {
      const cantidad = cantidadSugerida(m.stockActual, m.stockMinimo, factor, m.unidad);
      return { ...m, cantidad, costoEstimado: subtotalCompra(cantidad, m.costoUnitario) };
    })
    .filter((l) => l.cantidad.gt(0))
    .sort(
      (a, b) =>
        a.stockActual.div(a.stockMinimo).cmp(b.stockActual.div(b.stockMinimo)) ||
        a.nombre.localeCompare(b.nombre, "es"),
    );
  return { lineas, total: totalizarCompra(lineas.map((l) => ({ cantidad: l.cantidad, costoUnitario: l.costoUnitario }))) };
}

// ─── Precarga de Nueva compra ─────────────────────────────────────────────────
// La lista viaja a `/compras/nueva?m=<id>:<cantidad>,<id>:<cantidad>`. Son solo
// texto: se validan al leerlos y el servidor recalcula todo al guardar.

export type LineaPrecarga = { materialId: string; cantidad: string };

/** Lineas → valor del parametro `m`. */
export function armarPrecarga(lineas: { id: string; cantidad: Dinero }[]): string {
  return lineas.map((l) => `${l.id}:${l.cantidad.toFixed()}`).join(",");
}

/** URL de Nueva compra con las lineas cargadas. */
export function urlNuevaCompra(lineas: { id: string; cantidad: Dinero }[]): string {
  if (lineas.length === 0) return "/compras/nueva";
  return `/compras/nueva?m=${encodeURIComponent(armarPrecarga(lineas))}`;
}

const ID_VALIDO = /^[0-9A-Za-z-]{1,64}$/;
const MAXIMO_LINEAS = 100;

/**
 * Valor del parametro `m` → lineas validas. Descarta en silencio lo que no se
 * entiende (id raro, cantidad que no es un numero mayor a 0) y los ids
 * repetidos (queda el primero). Que el material exista y este activo lo decide
 * quien llama, contra la lista de materiales.
 */
export function leerPrecarga(valor: string | string[] | undefined): LineaPrecarga[] {
  const texto = Array.isArray(valor) ? valor.join(",") : (valor ?? "");
  const vistos = new Set<string>();
  const lineas: LineaPrecarga[] = [];
  for (const parte of texto.split(",")) {
    const [id, cantidad, ...sobra] = parte.trim().split(":");
    if (!id || cantidad === undefined || sobra.length > 0) continue;
    if (!ID_VALIDO.test(id) || vistos.has(id)) continue;
    if (!esDecimal(cantidad) || !d(normalizarDecimal(cantidad)).gt(0)) continue;
    vistos.add(id);
    lineas.push({ materialId: id, cantidad: d(normalizarDecimal(cantidad)).toFixed() });
    if (lineas.length >= MAXIMO_LINEAS) break;
  }
  return lineas;
}
