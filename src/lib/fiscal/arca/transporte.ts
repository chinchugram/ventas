// Transporte SOAP inyectable: el emisor y WSAA reciben una funcion `EnviarSoap`, asi se prueban sin red.
import { ErrorArcaIncierto } from "./errores";

export type EnviarSoap = (url: string, accionSoap: string, xml: string) => Promise<{ status: number; cuerpo: string }>;

export const TIMEOUT_POR_LLAMADA_MS = 30_000;

/**
 * Transporte real con `fetch`. Un corte o un timeout lanza `ErrorArcaIncierto` ("no se sabe"). Un HTTP 5xx con cuerpo
 * SOAP Fault se devuelve igual: lo interpretan los lectores (Fault => incierto).
 *
 * ⚠ TLS: si los servidores de ARCA fallan con "dh key too small", resolverlo con un Agent acotado a esos hosts, NUNCA
 * desactivando la verificacion del certificado ni de forma global (docs/06, 4.1).
 */
export function crearTransporteFetch(timeoutMs = TIMEOUT_POR_LLAMADA_MS): EnviarSoap {
  return async (url, accionSoap, xml) => {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${accionSoap}"` },
        body: xml,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: r.status, cuerpo: await r.text() };
    } catch {
      throw new ErrorArcaIncierto("No se pudo hablar con ARCA (corte o demora).");
    }
  };
}
