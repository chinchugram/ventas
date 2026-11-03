// WSFEv1: armado de los mensajes SOAP y lectura de las respuestas. Todo PURO (sin red): el transporte esta en emisor-arca.ts.
//
// ⚠ Los nombres de elementos, el namespace, las acciones SOAP y sobre todo el ORDEN de los campos (el .asmx es estricto)
// salen de memoria del manual: contrastar con el WSDL oficial de homologacion antes de la primera prueba real
// (docs/06-facturacion-arca.md, 4.6 y 5).
import { aMoneda, d, type Dinero } from "@/lib/money";
import type { ComprobanteConsultado, ResultadoCae, SolicitudCae } from "../emisor";
import { CODIGOS_ARCA_CONFIGURACION, CODIGO_ARCA_NO_EXISTE, ErrorArcaConfiguracion, ErrorArcaIncierto } from "./errores";
import { escaparXml, fechaArca, parsearFechaArca, primero, tiene, todos } from "./xml";

export const NS_WSFE = "http://ar.gov.afip.dif.FEV1/";
export const accionWsfe = (operacion: string) => `${NS_WSFE}${operacion}`;

export type AuthWsfe = { token: string; sign: string; cuit: string };

const imp = (v: Dinero) => aMoneda(v).toFixed(2);

function sobre(operacion: string, cuerpo: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<${operacion} xmlns="${NS_WSFE}">${cuerpo}</${operacion}>` +
    `</soap:Body></soap:Envelope>`
  );
}

const auth = (a: AuthWsfe) => `<Auth><Token>${escaparXml(a.token)}</Token><Sign>${escaparXml(a.sign)}</Sign><Cuit>${escaparXml(a.cuit)}</Cuit></Auth>`;

export function xmlDummy(): string {
  return sobre("FEDummy", "");
}

export function xmlUltimoAutorizado(a: AuthWsfe, puntoVenta: number, codigoArca: number): string {
  return sobre("FECompUltimoAutorizado", `${auth(a)}<PtoVta>${puntoVenta}</PtoVta><CbteTipo>${codigoArca}</CbteTipo>`);
}

export function xmlConsultar(a: AuthWsfe, puntoVenta: number, codigoArca: number, numero: number): string {
  return sobre(
    "FECompConsultar",
    `${auth(a)}<FeCompConsReq><CbteTipo>${codigoArca}</CbteTipo><CbteNro>${numero}</CbteNro><PtoVta>${puntoVenta}</PtoVta></FeCompConsReq>`,
  );
}

/** `FECAESolicitar` con UN comprobante (CantReg = 1: evita el resultado parcial). */
export function xmlSolicitarCae(a: AuthWsfe, s: SolicitudCae): string {
  if (!/^\d+$/.test(s.receptor.docNro)) throw new Error(`DocNro no numerico: "${s.receptor.docNro}"`);
  if (s.numero < 1) throw new Error("El numero de comprobante tiene que ser >= 1.");
  const alicuotas =
    s.importes.alicuotas.length > 0
      ? `<Iva>${s.importes.alicuotas
          .map((x) => `<AlicIva><Id>${x.codigo}</Id><BaseImp>${imp(x.base)}</BaseImp><Importe>${imp(x.importe)}</Importe></AlicIva>`)
          .join("")}</Iva>`
      : "";
  const asoc = s.comprobanteAsociado
    ? `<CbtesAsoc><CbteAsoc><Tipo>${s.comprobanteAsociado.codigoArca}</Tipo><PtoVta>${s.comprobanteAsociado.puntoVenta}</PtoVta>` +
      `<Nro>${s.comprobanteAsociado.numero}</Nro><Cuit>${escaparXml(s.cuitEmisor)}</Cuit></CbteAsoc></CbtesAsoc>`
    : "";
  const detalle =
    `<Concepto>${s.concepto}</Concepto><DocTipo>${s.receptor.docTipo}</DocTipo><DocNro>${s.receptor.docNro}</DocNro>` +
    `<CbteDesde>${s.numero}</CbteDesde><CbteHasta>${s.numero}</CbteHasta><CbteFch>${fechaArca(s.fecha)}</CbteFch>` +
    `<ImpTotal>${imp(s.importes.total)}</ImpTotal><ImpTotConc>0.00</ImpTotConc><ImpNeto>${imp(s.importes.neto)}</ImpNeto>` +
    `<ImpOpEx>0.00</ImpOpEx><ImpTrib>0.00</ImpTrib><ImpIVA>${imp(s.importes.iva)}</ImpIVA>` +
    `<MonId>PES</MonId><MonCotiz>1</MonCotiz><CondicionIVAReceptorId>${s.receptor.condicionIvaCodigo}</CondicionIVAReceptorId>` +
    `${asoc}${alicuotas}`;
  return sobre(
    "FECAESolicitar",
    `${auth(a)}<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${s.puntoVenta}</PtoVta><CbteTipo>${s.codigoArca}</CbteTipo></FeCabReq>` +
      `<FeDetReq><FECAEDetRequest>${detalle}</FECAEDetRequest></FeDetReq></FeCAEReq>`,
  );
}

// ───────────── Lectura de respuestas ─────────────

type Msg = { codigo: number; texto: string };

function mensajes(xml: string, contenedor: string, item: string, campoCodigo: string, campoTexto: string): Msg[] {
  const bloque = todos(xml, contenedor)[0];
  if (!bloque) return [];
  return todos(bloque, item).map((it) => ({ codigo: Number(primero(it, campoCodigo)), texto: primero(it, campoTexto) ?? "" }));
}

/** `Errors/Err` de la respuesta (a nivel de la operacion). */
export function erroresDe(xml: string): Msg[] {
  return mensajes(xml, "Errors", "Err", "Code", "Msg");
}

/** `Observaciones/Obs` del detalle del comprobante. */
export function observacionesDe(xml: string): Msg[] {
  return mensajes(xml, "Observaciones", "Obs", "Code", "Msg");
}

export const textoMsg = (m: Msg) => `[${m.codigo}] ${m.texto}`;

/** Una respuesta que no es XML de WSFE, un SOAP Fault o HTTP de error: "no se sabe". */
function exigirRespuesta(xml: string, operacion: string): void {
  if (tiene(xml, "Fault")) throw new ErrorArcaIncierto(`ARCA respondio un SOAP Fault en ${operacion}.`);
  if (!tiene(xml, `${operacion}Response`)) throw new ErrorArcaIncierto(`Respuesta ilegible de ARCA en ${operacion}.`);
}

/** Si la respuesta trae errores de autenticacion/autorizacion, es un problema de configuracion, no del comprobante. */
function lanzarSiConfiguracion(errores: Msg[]): void {
  const c = errores.find((e) => CODIGOS_ARCA_CONFIGURACION.has(e.codigo));
  if (c) throw new ErrorArcaConfiguracion(`ARCA no acepto las credenciales o el CUIT: ${textoMsg(c)}`);
}

export function leerUltimoAutorizado(xml: string): number {
  exigirRespuesta(xml, "FECompUltimoAutorizado");
  const errores = erroresDe(xml);
  lanzarSiConfiguracion(errores);
  if (errores.length > 0) throw new ErrorArcaIncierto(`ARCA no informo el ultimo autorizado: ${errores.map(textoMsg).join("; ")}`);
  const n = primero(xml, "CbteNro");
  if (n === null || !/^\d+$/.test(n)) throw new ErrorArcaIncierto("ARCA no informo CbteNro.");
  return Number(n);
}

export function leerConsulta(xml: string): ComprobanteConsultado {
  exigirRespuesta(xml, "FECompConsultar");
  const errores = erroresDe(xml);
  lanzarSiConfiguracion(errores);
  // Solo "no hay datos en los registros" (602) es "no existe"; cualquier otra duda tiene que lanzar (docs/06, 2.3).
  if (errores.length > 0) {
    if (errores.length === 1 && errores[0]!.codigo === CODIGO_ARCA_NO_EXISTE) return { encontrado: false };
    throw new ErrorArcaIncierto(`ARCA no pudo consultar el comprobante: ${errores.map(textoMsg).join("; ")}`);
  }
  const res = todos(xml, "ResultGet")[0];
  if (!res) throw new ErrorArcaIncierto("ARCA no devolvio ResultGet.");
  const cae = primero(res, "CodAutorizacion");
  const vto = parsearFechaArca(primero(res, "FchVto"));
  const fecha = parsearFechaArca(primero(res, "CbteFch"));
  const total = primero(res, "ImpTotal");
  if (!cae || !/^\d{14}$/.test(cae) || !vto || !fecha || total === null || !/^-?\d+(\.\d+)?$/.test(total)) {
    throw new ErrorArcaIncierto("ARCA devolvio un comprobante con datos incompletos.");
  }
  return { encontrado: true, cae, vencimiento: vto, fecha, total: d(total) };
}

export function leerResultadoCae(xml: string): ResultadoCae {
  exigirRespuesta(xml, "FECAESolicitar");
  const errores = erroresDe(xml);
  lanzarSiConfiguracion(errores);
  const det = todos(xml, "FECAEDetResponse")[0];
  const obs = det ? observacionesDe(det).map(textoMsg) : [];
  if (!det) {
    // Errores a nivel de la operacion y sin detalle: ARCA dice que NO proceso el pedido. Si es inequivoco, es un rechazo.
    if (errores.length > 0) return { aprobado: false, observaciones: errores.map(textoMsg) };
    throw new ErrorArcaIncierto("ARCA no devolvio el detalle del comprobante.");
  }
  const resultado = primero(det, "Resultado");
  if (resultado === "A") {
    const cae = primero(det, "CAE");
    const vto = parsearFechaArca(primero(det, "CAEFchVto"));
    if (!cae || !/^\d{14}$/.test(cae) || !vto) throw new ErrorArcaIncierto("ARCA aprobo pero el CAE o su vencimiento son ilegibles.");
    return { aprobado: true, cae, vencimiento: vto, observaciones: obs };
  }
  if (resultado === "R") {
    const todas = [...obs, ...errores.map(textoMsg)];
    return { aprobado: false, observaciones: todas.length > 0 ? todas : ["ARCA rechazo el comprobante sin detalle."] };
  }
  // "P" (parcial; no deberia pasar con CantReg = 1) o cualquier otra cosa: no se sabe.
  throw new ErrorArcaIncierto(`ARCA devolvio un Resultado inesperado ("${resultado ?? "vacio"}").`);
}
