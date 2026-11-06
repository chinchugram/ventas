/**
 * Armado de CSV para las exportaciones de reportes (3.1c).
 *
 * Funcion PURA: no toca Prisma, no lee el reloj, no hace I/O. Recibe encabezados
 * y filas y devuelve el texto completo del archivo.
 *
 * Formato pensado para abrir directo en Excel en espanol (Argentina):
 *  - separador ";" (la coma es el separador decimal).
 *  - importes con coma decimal y SIN separador de miles: 1234,50.
 *  - BOM UTF-8 al comienzo, para que Excel lea bien tildes y la ñ.
 *  - fin de linea "\r\n" (RFC 4180), tambien despues de la ultima fila.
 *  - un campo va entre comillas si contiene ";", comillas, "\n" o "\r"; las
 *    comillas internas se duplican. Una coma sola no hace falta escaparla
 *    porque el separador es ";".
 *
 * ─── Importes ────────────────────────────────────────────────────────────────
 * NUNCA como number. Llegan como `Decimal` (lib/money.ts) y se formatean con
 * `toDecimalPlaces` + `toFixed`, sin pasar por Intl ni por parseFloat.
 *
 * ─── Inyeccion de formulas ───────────────────────────────────────────────────
 * Un TEXTO que empiece con = + - @ (o tabulador / retorno) se prefija con una
 * comilla simple, para que Excel lo tome como texto y no lo ejecute. Los Decimal
 * negativos NO pasan por ahi: se formatean aparte, asi "-0,50" sale como numero.
 *
 * Por eso el builder recibe valores tipados (`Celda`) y no strings ya
 * formateados: si un importe formateado ("-0,50") entrara como texto, la
 * neutralizacion le pondria la comilla.
 */
import Decimal from "decimal.js";
import { type Dinero } from "./money";

export const BOM_UTF8 = "﻿";
export const SEPARADOR_CSV = ";";
export const FIN_DE_LINEA_CSV = "\r\n";

/**
 * Valor de una celda:
 *  - string: texto. Se neutralizan formulas y se escapan comillas / ";" / saltos.
 *  - Decimal: importe, 2 decimales con coma.
 *  - { cantidad, decimales }: cantidad (ej. 3 decimales para kg o m2).
 *  - { porcentaje }: porcentaje con 2 decimales, sin "%" (el encabezado lo dice).
 *  - Date: fecha dd/mm/aaaa tomando el dia en UTC (asi se guardan las fechas de Venta y Pago).
 *  - null / undefined: celda vacia.
 */
export type Celda =
  | string
  | Dinero
  | { cantidad: Dinero; decimales: number }
  | { porcentaje: Dinero }
  | Date
  | null
  | undefined;

/** Prefijos que Excel interpreta como formula. */
const PREFIJO_FORMULA = /^[=+\-@\t\r]/;

/** Neutraliza un texto que Excel podria ejecutar como formula. */
export function neutralizarFormula(texto: string): string {
  return PREFIJO_FORMULA.test(texto) ? `'${texto}` : texto;
}

/**
 * Decimal → texto con `decimales` lugares y coma decimal, sin separador de miles.
 * Redondeo mitad hacia arriba (en magnitud). Un cero que resulta de redondear
 * (ej. -0.001) sale "0,00", no "-0,00".
 *
 *   1234.5  → "1234,50"   -0.5 → "-0,50"   1234567.891 → "1234567,89"
 */
export function decimalCSV(valor: Dinero, decimales = 2): string {
  const redondeado = valor.toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);
  const sinSigno = redondeado.isZero() ? new Decimal(0) : redondeado;
  return sinSigno.toFixed(decimales).replace(".", ",");
}

/** Porcentaje a texto con 2 decimales y coma, sin "%". 40.5 → "40,50". */
export function porcentajeCSV(valor: Dinero): string {
  return decimalCSV(valor, 2);
}

/** Fecha a "dd/mm/aaaa", dia calendario en UTC (medianoche UTC = dia de Argentina). */
export function fechaCSV(fecha: Date): string {
  const dd = String(fecha.getUTCDate()).padStart(2, "0");
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const aaaa = String(fecha.getUTCFullYear()).padStart(4, "0");
  return `${dd}/${mm}/${aaaa}`;
}

/** Escapa un texto para una celda: neutraliza formulas y entrecomilla si hace falta. */
function campo(texto: string): string {
  const seguro = neutralizarFormula(texto);
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

function celda(valor: Celda): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return campo(valor);
  if (valor instanceof Date) return fechaCSV(valor);
  if (Decimal.isDecimal(valor)) return decimalCSV(valor);
  if ("cantidad" in valor) return decimalCSV(valor.cantidad, valor.decimales);
  return porcentajeCSV(valor.porcentaje);
}

/**
 * Arma el archivo CSV completo: BOM + encabezados + filas, cada linea terminada en
 * "\r\n". Sin filas devuelve solo el encabezado (Excel lo abre igual).
 */
export function construirCSV(encabezados: string[], filas: Celda[][]): string {
  const lineas = [
    encabezados.map(campo),
    ...filas.map((fila) => fila.map(celda)),
  ];
  return BOM_UTF8 + lineas.map((linea) => linea.join(SEPARADOR_CSV) + FIN_DE_LINEA_CSV).join("");
}
