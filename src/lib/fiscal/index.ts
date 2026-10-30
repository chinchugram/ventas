import type { EmisorFiscal } from "./emisor";
import { crearEmisorSimulado, type AccesoComprobantesSimulados, type OpcionesSimulador } from "./emisor-simulado";

// Seleccion del emisor fiscal segun el entorno, con la salvaguarda contra la
// emision falsa en produccion. La decision es PURA: recibe el entorno como
// parametro (`seleccionarEmisor`). El unico lugar que lee `process.env` es
// `entornoDelProceso`, a la vista.
//
//   EMISOR_FISCAL            simulado (por defecto) | arca (reservado: hoy "no implementado")
//   NODE_ENV=production      el simulado exige PERMITIR_EMISOR_SIMULADO=1; si no, facturar
//                            queda deshabilitado con un mensaje claro.

export type { AmbienteFiscal, EmisorFiscal, ResultadoCae, SolicitudCae, ComprobanteConsultado } from "./emisor";
export type { AccesoComprobantesSimulados, OpcionesSimulador } from "./emisor-simulado";

export type EntornoFiscal = {
  EMISOR_FISCAL?: string;
  NODE_ENV?: string;
  PERMITIR_EMISOR_SIMULADO?: string;
};

export type SeleccionEmisor = { ok: true; emisor: "simulado" } | { ok: false; error: string };

export const MENSAJE_ARCA_NO_IMPLEMENTADO =
  "La facturación con ARCA todavía no está implementada (EMISOR_FISCAL=arca). Por ahora solo existe el emisor simulado.";

export const MENSAJE_SIMULADO_EN_PRODUCCION =
  "Facturación deshabilitada: el servidor está en producción y el único emisor disponible es el simulado, " +
  "que no tiene validez fiscal. Para usarlo igual (por ejemplo en una demo) hay que definir PERMITIR_EMISOR_SIMULADO=1.";

/** Que emisor corresponde a este entorno, o por que no se puede facturar. */
export function seleccionarEmisor(entorno: EntornoFiscal): SeleccionEmisor {
  const pedido = (entorno.EMISOR_FISCAL ?? "").trim().toLowerCase() || "simulado";
  if (pedido === "arca") return { ok: false, error: MENSAJE_ARCA_NO_IMPLEMENTADO };
  if (pedido !== "simulado") {
    return {
      ok: false,
      error: `EMISOR_FISCAL tiene un valor desconocido ("${entorno.EMISOR_FISCAL}"). Valores posibles: simulado, arca.`,
    };
  }
  if (entorno.NODE_ENV === "production" && (entorno.PERMITIR_EMISOR_SIMULADO ?? "").trim() !== "1") {
    return { ok: false, error: MENSAJE_SIMULADO_EN_PRODUCCION };
  }
  return { ok: true, emisor: "simulado" };
}

/** Las variables que importan, leidas del proceso. Unico acceso a `process.env` de la facturacion. */
export function entornoDelProceso(): EntornoFiscal {
  return {
    EMISOR_FISCAL: process.env.EMISOR_FISCAL,
    NODE_ENV: process.env.NODE_ENV,
    PERMITIR_EMISOR_SIMULADO: process.env.PERMITIR_EMISOR_SIMULADO,
  };
}

export type ObtencionEmisor = { ok: true; emisor: EmisorFiscal } | { ok: false; error: string };

/**
 * El emisor listo para usar, o el motivo por el que facturar esta deshabilitado.
 * `acceso` es lo que necesita el simulador (ver `accesoSimulado` en
 * src/lib/dominio/comprobantes.ts).
 */
export function obtenerEmisorFiscal(
  entorno: EntornoFiscal,
  acceso: AccesoComprobantesSimulados,
  opciones?: OpcionesSimulador,
): ObtencionEmisor {
  const seleccion = seleccionarEmisor(entorno);
  if (!seleccion.ok) return seleccion;
  return { ok: true, emisor: crearEmisorSimulado(acceso, opciones) };
}
