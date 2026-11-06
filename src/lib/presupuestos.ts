import { CERO, d, fmtFecha, fmtMoneda, type Dinero } from "@/lib/money";
import { costearLineaVenta, totalizarVenta } from "@/lib/costing";

// Logica pura de los presupuestos (sin base ni Next): vencimiento, totales,
// consolidacion de lineas, que precio le toca a cada linea al editar y el
// mensaje de WhatsApp. La usan la capa de dominio, las consultas, las pantallas
// y `scripts/verificar-presupuestos.ts`.
//
// Un presupuesto NO maneja costos ni margenes: los totales se calculan con el
// mismo motor que la venta (`costearLineaVenta`/`totalizarVenta`) pasando costo
// 0, y de ahi solo se devuelven neto, IVA y bruto.

export const VALIDEZ_POR_DEFECTO = 15;
export const VALIDEZ_MAXIMA = 365;

export type EstadoGuardado = "ABIERTO" | "CONVERTIDO" | "ANULADO";
/** Lo que ve el usuario: "VENCIDO" se calcula, nunca se guarda. */
export type EstadoCalculado = "ABIERTO" | "VENCIDO" | "CONVERTIDO" | "ANULADO";

export const ETIQUETA_ESTADO: Record<EstadoCalculado, string> = {
  ABIERTO: "Abierto",
  VENCIDO: "Vencido",
  CONVERTIDO: "Convertido en venta",
  ANULADO: "Anulado",
};

export const ESTILO_ESTADO: Record<EstadoCalculado, string> = {
  ABIERTO: "bg-sky-50 text-sky-800",
  VENCIDO: "bg-amber-50 text-amber-800",
  CONVERTIDO: "bg-emerald-50 text-emerald-700",
  ANULADO: "bg-slate-200 text-slate-700",
};

// ─── Vencimiento ─────────────────────────────────────────────────────────────
// Todas las fechas son `@db.Date` (medianoche UTC del dia calendario argentino);
// `hoy` es `hoyArgentina()`. Convencion: un presupuesto de 15 dias hecho el 1/10
// es valido HASTA el 16/10 inclusive (fecha + validez); vence el 17/10.

const MS_DIA = 24 * 60 * 60 * 1000;

/** Ultimo dia en que el presupuesto se puede convertir: fecha + validezDias, inclusive. */
export function validoHasta(fecha: Date, validezDias: number): Date {
  return new Date(fecha.getTime() + validezDias * MS_DIA);
}

/** Vencido = hoy es posterior al ultimo dia valido. El ultimo dia todavia vale. */
export function estaVencido(fecha: Date, validezDias: number, hoy: Date): boolean {
  return hoy.getTime() > validoHasta(fecha, validezDias).getTime();
}

/** Dias que quedan hasta el ultimo dia valido (0 = hoy es el ultimo; negativo = ya vencio). */
export function diasRestantes(fecha: Date, validezDias: number, hoy: Date): number {
  return Math.round((validoHasta(fecha, validezDias).getTime() - hoy.getTime()) / MS_DIA);
}

export function estadoCalculado(estado: EstadoGuardado, fecha: Date, validezDias: number, hoy: Date): EstadoCalculado {
  if (estado !== "ABIERTO") return estado;
  return estaVencido(fecha, validezDias, hoy) ? "VENCIDO" : "ABIERTO";
}

/** "Vence hoy", "Quedan 3 días", "Venció hace 2 días" (o null si ya no corre el plazo). */
export function textoPlazo(estado: EstadoCalculado, dias: number): string | null {
  if (estado === "CONVERTIDO" || estado === "ANULADO") return null;
  if (dias < 0) return `Venció hace ${-dias} ${dias === -1 ? "día" : "días"}`;
  if (dias === 0) return "Vence hoy";
  return `Quedan ${dias} ${dias === 1 ? "día" : "días"}`;
}

export function numeroPresupuesto(numero: number, anio: number): string {
  return `${numero}/${anio}`;
}

/** Motivo por el que NO se puede editar o convertir, o null si se puede. */
export function motivoNoAbierto(
  p: { estado: EstadoGuardado; fecha: Date; validezDias: number; ventaNumero?: string | null },
  hoy: Date,
  accion: "editar" | "convertir",
): string | null {
  if (p.estado === "CONVERTIDO") {
    return `Este presupuesto ya se convirtió en venta${p.ventaNumero ? ` (#${p.ventaNumero})` : ""}.`;
  }
  if (p.estado === "ANULADO") return "Este presupuesto está anulado.";
  if (estaVencido(p.fecha, p.validezDias, hoy)) {
    return `Este presupuesto venció el ${fmtFecha(validoHasta(p.fecha, p.validezDias))} y ya no se puede ${
      accion === "editar" ? "editar" : "convertir en venta"
    }: duplicalo para actualizarlo con los precios de hoy.`;
  }
  return null;
}

// ─── Totales ─────────────────────────────────────────────────────────────────

export type LineaPresupuesto = { cantidad: Dinero; precioUnitario: Dinero; ivaPct: Dinero };

function costear(l: LineaPresupuesto) {
  // Costo 0 a proposito: el presupuesto no conoce ni muestra costos.
  return costearLineaVenta({ ...l, costoUnitario: CERO });
}

/** Subtotal de una linea, IVA incluido (el precio unitario ya lo incluye, igual que en la venta). */
export function subtotalLinea(l: LineaPresupuesto): Dinero {
  return costear(l).subtotalBruto;
}

export type TotalesPresupuesto = { totalNeto: Dinero; totalIVA: Dinero; totalBruto: Dinero };

/**
 * Totales con el MISMO motor que la venta: el IVA se acumula linea por linea,
 * asi el total del presupuesto coincide al centavo con el de la venta que sale
 * de convertirlo (mismas cantidades, precios e IVA).
 */
export function totalizarPresupuesto(lineas: LineaPresupuesto[]): TotalesPresupuesto {
  const t = totalizarVenta(lineas.map(costear));
  return { totalNeto: t.totalNeto, totalIVA: t.totalIVA, totalBruto: t.totalBruto };
}

// ─── Lineas ──────────────────────────────────────────────────────────────────

/** Suma las cantidades de un mismo articulo repetido y conserva el orden de aparicion. */
export function consolidarLineas<T extends { articuloId: string; cantidad: Dinero }>(items: T[]): T[] {
  const porArticulo = new Map<string, T>();
  for (const it of items) {
    const previo = porArticulo.get(it.articuloId);
    porArticulo.set(it.articuloId, previo ? { ...previo, cantidad: previo.cantidad.plus(it.cantidad) } : it);
  }
  return [...porArticulo.values()];
}

/** Linea ya guardada de un presupuesto (con su precio congelado). */
export type LineaPrevia = { articuloId: string; descripcion: string; precioUnitario: Dinero; ivaPct: Dinero };

export type DecisionPrecio = { tipo: "CONGELADO"; previa: LineaPrevia } | { tipo: "RESOLVER" };

/**
 * Que precio le toca a una linea al EDITAR un presupuesto:
 *  - cambio el cliente: todo se reprecia (`RESOLVER`) porque la lista de
 *    precios es otra;
 *  - mismo cliente y el articulo ya estaba: conserva su precio, descripcion e
 *    IVA congelados (`CONGELADO`), aunque el catalogo haya cambiado;
 *  - articulo nuevo: se resuelve con `resolverPrecio` (`RESOLVER`).
 */
export function decidirPrecio(params: {
  articuloId: string;
  previas: ReadonlyMap<string, LineaPrevia>;
  clienteCambio: boolean;
}): DecisionPrecio {
  if (params.clienteCambio) return { tipo: "RESOLVER" };
  const previa = params.previas.get(params.articuloId);
  return previa ? { tipo: "CONGELADO", previa } : { tipo: "RESOLVER" };
}

// ─── Cantidades ──────────────────────────────────────────────────────────────

/** Tope de cantidad (la columna es Decimal(14,3)); deja margen para el subtotal. */
export const CANTIDAD_MAXIMA = d("999999999");

/**
 * Problema de una cantidad, o null si sirve: mayor a 0, hasta 3 decimales (los
 * que guarda la base: redondear en silencio cambiaria el total) y con tope.
 */
export function problemaDeCantidad(cantidad: Dinero): string | null {
  if (!cantidad.isFinite() || cantidad.lte(0)) return "La cantidad tiene que ser mayor a 0.";
  if (!cantidad.equals(cantidad.toDecimalPlaces(3))) return "La cantidad admite hasta 3 decimales.";
  if (cantidad.gt(CANTIDAD_MAXIMA)) return "La cantidad es demasiado grande.";
  return null;
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

/**
 * Mensaje precargado: saludo, numero, total y validez. Nada mas del negocio (ni
 * lineas, ni datos de contacto o de pago): lo que haga falta lo escribe quien manda.
 */
export function mensajeWhatsAppPresupuesto(params: {
  clienteNombre: string;
  numero: number;
  anio: number;
  total: Dinero;
  fecha: Date;
  validezDias: number;
}): string {
  const { clienteNombre, numero, anio, total, fecha, validezDias } = params;
  return `Hola ${clienteNombre.trim()}, te paso el presupuesto N° ${numeroPresupuesto(numero, anio)} por ${fmtMoneda(total)}, válido hasta el ${fmtFecha(validoHasta(fecha, validezDias))}. ¡Gracias!`;
}
