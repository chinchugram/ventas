import { z } from "zod";
import { d, type Dinero } from "@/lib/money";

// Piezas comunes de las server actions. Sin dependencias de Next: lo usan
// tambien los scripts de prueba y la logica de dominio en `src/lib/dominio/`.

export type Resultado = { ok: true } | { ok: false; error: string };

export const SIN_BASE = "No hay base de datos conectada: esta pantalla está en modo demostración y no guarda.";

/**
 * Error que se le puede mostrar al usuario tal cual (cliente dado de baja, pago
 * mayor al saldo...). Cualquier otro error se loguea y se reemplaza por un
 * mensaje generico.
 */
export class ErrorDeNegocio extends Error {}

/** Mensaje para el usuario: el de un `ErrorDeNegocio`, o `generico` para el resto. */
export function mensajeDeError(error: unknown, generico: string): string {
  return error instanceof ErrorDeNegocio ? error.message : generico;
}

/** Primer problema de una validacion de zod, listo para mostrar. */
export function primerError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos";
}

// ─── Decimales tipeados por el usuario ────────────────────────────────────────
// En Argentina la coma es el separador decimal. Se acepta "1,5" y "1.5"; no se
// aceptan separadores de miles (un "1.500" seria ambiguo).

const PATRON_DECIMAL = /^\d+([.,]\d+)?$/;

/** "1,5" → "1.5". No valida: usar despues de `esDecimal`. */
export function normalizarDecimal(valor: string): string {
  return valor.trim().replace(",", ".");
}

export function esDecimal(valor: string): boolean {
  return PATRON_DECIMAL.test(valor.trim());
}

/** Texto tipeado → Decimal. Lanza si no es un numero valido. */
export function aDecimal(valor: string): Dinero {
  if (!esDecimal(valor)) throw new Error(`"${valor}" no es un número válido`);
  return d(normalizarDecimal(valor));
}

/** Para calculos en vivo en el cliente: lo que no es un numero cuenta como 0. */
export function decimalOCero(valor: string): Dinero {
  return esDecimal(valor) ? d(normalizarDecimal(valor)) : d(0);
}

/** Numero mayor a 0 (cantidades, montos). Devuelve el texto ya normalizado con punto. */
export const decimalPositivo = z
  .string()
  .trim()
  .refine((v) => esDecimal(v) && d(normalizarDecimal(v)).gt(0), "Debe ser un número mayor a 0")
  .transform(normalizarDecimal);

/** Numero 0 o mayor (costos, stock contado). Devuelve el texto ya normalizado con punto. */
export const decimalNoNegativo = z
  .string()
  .trim()
  .refine(esDecimal, "Debe ser un número válido, 0 o más")
  .transform(normalizarDecimal);

/** Campo de texto opcional: "" y solo espacios cuentan como ausente. */
export const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : null));

export const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

// ─── Fechas ───────────────────────────────────────────────────────────────────
// Las fechas de negocio (venta, pago, compra) son `date` sin hora. Se guardan
// como medianoche UTC del dia calendario en Argentina, que es como Prisma
// representa un `@db.Date`.

const ZONA = "America/Argentina/Buenos_Aires";

/** "2026-03-15" del dia de hoy en Argentina. */
export function hoyArgentinaISO(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString("en-CA", { timeZone: ZONA });
}

/** Hoy en Argentina como `Date` a medianoche UTC, listo para un campo `@db.Date`. */
export function hoyArgentina(ahora: Date = new Date()): Date {
  return fechaDesdeISO(hoyArgentinaISO(ahora));
}

/** "2026-03-15" → `Date` a medianoche UTC. */
export function fechaDesdeISO(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
