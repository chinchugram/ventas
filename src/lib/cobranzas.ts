import { aMoneda, CERO, d, fmtMoneda, sumar, type Dinero } from "@/lib/money";
import { estadoPago, type EstadoPago } from "@/lib/costing";

// Logica pura de cobranzas: sin base ni Next. La usan las acciones, la logica
// de dominio (`src/lib/dominio/pagos.ts`), las pantallas y
// `scripts/verificar-cobranzas.ts`.
//
// Reglas:
// - El saldo nunca se guarda: total de la venta menos sus pagos NO anulados.
// - Un pago anulado se sigue mostrando (tachado) pero no cuenta en nada.
// - Una venta ANULADA no tiene saldo: sus pagos se muestran pero no cuentan.
// - Tolerancia de 1 centavo, como en `registrarVentaEnTx` y `estadoPago`.

export const TOLERANCIA = d("0.01");

export const METODOS_PAGO = ["EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const ETIQUETA_METODO: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  OTRO: "Otro",
};

type PagoConEstado = { monto: Dinero; anuladoEn: Date | null };

/** Los pagos que cuentan: los no anulados. */
export function pagosVigentes<P extends PagoConEstado>(pagos: P[]): P[] {
  return pagos.filter((p) => p.anuladoEn === null);
}

/** Lo cobrado de una venta: suma de sus pagos no anulados. */
export function pagadoDe(pagos: PagoConEstado[]): Dinero {
  return aMoneda(sumar(...pagosVigentes(pagos).map((p) => p.monto)));
}

/** Saldo de una venta. Nunca negativo: si se cobro de mas por redondeo, es 0. */
export function saldoDeVenta(totalBruto: Dinero, pagado: Dinero): Dinero {
  const saldo = aMoneda(totalBruto.minus(pagado));
  return saldo.isNegative() ? CERO : saldo;
}

/** Estado de pago de una venta a partir de sus pagos (los anulados no cuentan). */
export function estadoDePago(totalBruto: Dinero, pagos: PagoConEstado[]): EstadoPago {
  return estadoPago(totalBruto, pagadoDe(pagos));
}

/** La venta todavia debe algo (mas de 1 centavo). */
export function tieneSaldo(saldo: Dinero): boolean {
  return saldo.gt(TOLERANCIA);
}

/**
 * Un pago nuevo contra el saldo actual de la venta. Devuelve el problema listo
 * para mostrar, o `null` si el monto se puede cobrar.
 */
export function validarMontoContraSaldo(monto: Dinero, saldo: Dinero): string | null {
  if (monto.lte(0)) return "El monto tiene que ser mayor a 0.";
  if (!aMoneda(monto).eq(monto)) return "El monto no puede tener más de 2 decimales.";
  if (!tieneSaldo(saldo)) return "La venta ya está saldada: no hay nada para cobrar.";
  if (monto.gt(saldo.plus(TOLERANCIA))) {
    return `El pago (${fmtMoneda(monto)}) supera el saldo de la venta (${fmtMoneda(saldo)}).`;
  }
  return null;
}

/**
 * Fecha de un pago ("2026-03-15") contra hoy en Argentina. No se aceptan cobros
 * a futuro: un pago se registra cuando entra la plata. Hacia atras no hay
 * limite (se puede cargar un cobro viejo que quedo sin anotar).
 */
export function validarFechaPago(fechaISO: string, hoyISO: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaISO) || Number.isNaN(Date.parse(`${fechaISO}T00:00:00Z`))) {
    return "Fecha inválida";
  }
  if (fechaISO > hoyISO) return "La fecha del pago no puede ser posterior a hoy.";
  return null;
}

// ─── Antiguedad de la deuda ──────────────────────────────────────────────────

/** Dias entre la fecha de la venta y hoy (ambas `@db.Date`, a medianoche UTC). */
export function diasDesde(fecha: Date, hoy: Date): number {
  const dias = Math.round((hoy.getTime() - fecha.getTime()) / 86_400_000);
  return dias < 0 ? 0 : dias;
}

export const TRAMOS = [
  { clave: "HASTA_30", etiqueta: "Hasta 30 días", hasta: 30 },
  { clave: "HASTA_60", etiqueta: "31 a 60 días", hasta: 60 },
  { clave: "HASTA_90", etiqueta: "61 a 90 días", hasta: 90 },
  { clave: "MAS_90", etiqueta: "Más de 90 días", hasta: Number.POSITIVE_INFINITY },
] as const;

export type Tramo = (typeof TRAMOS)[number]["clave"];

export function tramoDe(dias: number): Tramo {
  return TRAMOS.find((t) => dias <= t.hasta)!.clave;
}

// ─── Agrupaciones para /cobranzas ────────────────────────────────────────────

export type VentaConSaldo = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  estado: "PENDIENTE" | "ENTREGADA";
  clienteId: string;
  clienteNombre: string;
  clienteTelefono: string | null;
  totalBruto: Dinero;
  pagado: Dinero;
  saldo: Dinero;
  estadoPago: EstadoPago;
  dias: number;
};

export type DeudaPorCliente = {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  saldo: Dinero;
  /** La venta impaga mas vieja. */
  desde: Date;
  diasMax: number;
  ventas: VentaConSaldo[];
};

/** Deuda agrupada por cliente, el que mas debe primero. Las ventas, la mas vieja primero. */
export function agruparPorCliente(ventas: VentaConSaldo[]): DeudaPorCliente[] {
  const porCliente = new Map<string, DeudaPorCliente>();
  for (const v of [...ventas].sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.numero - b.numero)) {
    const actual = porCliente.get(v.clienteId);
    if (actual) {
      actual.saldo = aMoneda(actual.saldo.plus(v.saldo));
      actual.diasMax = Math.max(actual.diasMax, v.dias);
      actual.ventas.push(v);
    } else {
      porCliente.set(v.clienteId, {
        clienteId: v.clienteId,
        nombre: v.clienteNombre,
        telefono: v.clienteTelefono,
        saldo: v.saldo,
        desde: v.fecha,
        diasMax: v.dias,
        ventas: [v],
      });
    }
  }
  return [...porCliente.values()].sort((a, b) => b.saldo.cmp(a.saldo) || a.nombre.localeCompare(b.nombre));
}

export type DeudaPorTramo = { clave: Tramo; etiqueta: string; saldo: Dinero; ventas: VentaConSaldo[] };

/** Deuda por antiguedad: los cuatro tramos siempre, aunque esten vacios. Dentro, la mas vieja primero. */
export function agruparPorAntiguedad(ventas: VentaConSaldo[]): DeudaPorTramo[] {
  return TRAMOS.map((t) => {
    const delTramo = ventas
      .filter((v) => tramoDe(v.dias) === t.clave)
      .sort((a, b) => b.dias - a.dias || a.numero - b.numero);
    return {
      clave: t.clave,
      etiqueta: t.etiqueta,
      saldo: aMoneda(sumar(...delTramo.map((v) => v.saldo))),
      ventas: delTramo,
    };
  });
}

/** Monto sugerido para el formulario: el saldo con coma decimal ("1234,50"). */
export function montoSugerido(saldo: Dinero): string {
  return aMoneda(saldo).toFixed(2).replace(".", ",");
}
