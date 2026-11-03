// Configuracion del emisor de ARCA: ambiente, URLs y archivos del certificado. Funcion PURA: recibe el entorno por
// parametro; el unico lugar que lee `process.env` es `entornoArcaDelProceso`.

export type AmbienteArca = "HOMOLOGACION" | "PRODUCCION";

/** URLs atadas al ambiente (⚠ verificar contra la fuente oficial antes de usarlas, docs/06-facturacion-arca.md 4.6). */
export const URLS_ARCA: Record<AmbienteArca, { wsaa: string; wsfe: string }> = {
  HOMOLOGACION: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  PRODUCCION: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

export type EntornoArca = {
  ARCA_AMBIENTE?: string;
  ARCA_CERT_PATH?: string;
  ARCA_KEY_PATH?: string;
  ARCA_KEY_PASSPHRASE?: string;
  NODE_ENV?: string;
};

export type ConfigArca = {
  ambiente: AmbienteArca;
  certPath: string;
  keyPath: string;
  keyPassphrase?: string;
};

export type ResultadoConfigArca = { ok: true; config: ConfigArca } | { ok: false; error: string };

/**
 * El ambiente es OBLIGATORIO y no tiene valor por defecto: nunca se asume produccion por omision. Produccion solo con
 * NODE_ENV=production, para no facturar de verdad desde una maquina de desarrollo con el certificado real.
 */
export function leerConfigArca(entorno: EntornoArca): ResultadoConfigArca {
  const pedido = (entorno.ARCA_AMBIENTE ?? "").trim().toLowerCase();
  if (!pedido) return { ok: false, error: "Falta ARCA_AMBIENTE (homologacion o produccion): no se asume ninguno." };
  if (pedido !== "homologacion" && pedido !== "produccion") {
    return { ok: false, error: `ARCA_AMBIENTE tiene un valor desconocido ("${entorno.ARCA_AMBIENTE}"). Valores posibles: homologacion, produccion.` };
  }
  const ambiente: AmbienteArca = pedido === "produccion" ? "PRODUCCION" : "HOMOLOGACION";
  if (ambiente === "PRODUCCION" && entorno.NODE_ENV !== "production") {
    return { ok: false, error: "ARCA_AMBIENTE=produccion solo se admite con NODE_ENV=production (evita facturar de verdad desde desarrollo)." };
  }
  const certPath = (entorno.ARCA_CERT_PATH ?? "").trim();
  const keyPath = (entorno.ARCA_KEY_PATH ?? "").trim();
  if (!certPath || !keyPath) return { ok: false, error: "Faltan ARCA_CERT_PATH y/o ARCA_KEY_PATH (certificado y clave privada de ARCA)." };
  const pass = entorno.ARCA_KEY_PASSPHRASE;
  return { ok: true, config: { ambiente, certPath, keyPath, ...(pass ? { keyPassphrase: pass } : {}) } };
}

/** Unico acceso a `process.env` de la integracion con ARCA. */
export function entornoArcaDelProceso(): EntornoArca {
  return {
    ARCA_AMBIENTE: process.env.ARCA_AMBIENTE,
    ARCA_CERT_PATH: process.env.ARCA_CERT_PATH,
    ARCA_KEY_PATH: process.env.ARCA_KEY_PATH,
    ARCA_KEY_PASSPHRASE: process.env.ARCA_KEY_PASSPHRASE,
    NODE_ENV: process.env.NODE_ENV,
  };
}
