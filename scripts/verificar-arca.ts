/**
 * Verificacion del emisor de ARCA (sin red, sin base, sin Next).
 *
 *   npm run test:arca
 *
 * Todo contra un transporte SOAP simulado y un certificado autofirmado generado al vuelo con openssl. Las respuestas
 * de ARCA estan escritas A MANO con la forma que se recuerda del manual: NO prueban compatibilidad con ARCA real
 * (eso es la etapa de homologacion, docs/06-facturacion-arca.md 4.8).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { d } from "../src/lib/money";
import { CODIGO_ARCA } from "../src/lib/comprobantes";
import type { SolicitudCae } from "../src/lib/fiscal/emisor";
import { crearEmisorArca } from "../src/lib/fiscal/emisor-arca";
import { leerConfigArca } from "../src/lib/fiscal/arca/config";
import { ErrorArcaConfiguracion, ErrorArcaIncierto } from "../src/lib/fiscal/arca/errores";
import type { EnviarSoap } from "../src/lib/fiscal/arca/transporte";
import { GestorTicket, armarTra, firmarTra, leerLoginCms, xmlLoginCms, type TicketAcceso } from "../src/lib/fiscal/arca/wsaa";
import { parsearFechaArca } from "../src/lib/fiscal/arca/xml";
import { xmlSolicitarCae } from "../src/lib/fiscal/arca/wsfe";

let fallos = 0;
let total = 0;
function comprobar(etiqueta: string, obtenido: unknown, esperado: unknown) {
  total += 1;
  const o = String(obtenido);
  const e = String(esperado);
  const ok = o === e;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK   " : "FALLA"} ${etiqueta}: ${o}${ok ? "" : ` (esperado ${e})`}`);
}
async function lanza(etiqueta: string, clase: Function, f: () => Promise<unknown> | unknown) {
  let obtenido = "no lanzo";
  try {
    await f();
  } catch (e) {
    obtenido = e instanceof clase ? clase.name : `otro: ${e instanceof Error ? e.name + ": " + e.message : e}`;
  }
  comprobar(etiqueta, obtenido, clase.name);
}

const CUIT = "20123456786";
const ENV = (cuerpo: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;
const ta: TicketAcceso = { token: "TOK", sign: "SIG", vence: new Date(Date.now() + 12 * 3600_000) };

function solicitud(extra: Partial<SolicitudCae> = {}): SolicitudCae {
  return {
    cuitEmisor: CUIT, puntoVenta: 7, tipo: "FACTURA_A", codigoArca: CODIGO_ARCA.FACTURA_A, numero: 5,
    fecha: new Date(Date.UTC(2026, 10, 3)), concepto: 1,
    receptor: { docTipo: 80, docNro: "30711111112", condicionIvaCodigo: 1 },
    importes: { total: d("1210.00"), neto: d("1000.00"), iva: d("210.00"), alicuotas: [{ codigo: 5, base: d("1000.00"), importe: d("210.00") }] },
    ...extra,
  };
}

type Registro = { url: string; accion: string; xml: string };
function transporte(respuestas: (string | Error)[]): { enviar: EnviarSoap; llamadas: Registro[] } {
  const llamadas: Registro[] = [];
  let i = 0;
  const enviar: EnviarSoap = async (url, accion, xml) => {
    llamadas.push({ url, accion, xml });
    const r = respuestas[Math.min(i++, respuestas.length - 1)]!;
    if (r instanceof Error) throw r;
    return { status: 200, cuerpo: r };
  };
  return { enviar, llamadas };
}
const gestor = () => new GestorTicket(async () => ta);
const emisorCon = (resp: (string | Error)[], intentosLectura = 3) => {
  const t = transporte(resp);
  const emisor = crearEmisorArca({ ambiente: "HOMOLOGACION", cuit: CUIT, tickets: gestor(), enviar: t.enviar, dormir: async () => {}, intentosLectura });
  return { emisor, ...t };
};

const R_APROBADA = (obs = "") => ENV(`<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>71234567890123</CAE><CAEFchVto>20261113</CAEFchVto>${obs}</FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
const R_RECHAZADA = ENV(`<FECAESolicitarResponse><FECAESolicitarResult><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>El numero no es el proximo a autorizar</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
const R_ULTIMO = (n: number) => ENV(`<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><PtoVta>7</PtoVta><CbteTipo>1</CbteTipo><CbteNro>${n}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`);
const R_ERRORES = (code: number, msg: string, op: string) => ENV(`<${op}Response><${op}Result><Errors><Err><Code>${code}</Code><Msg>${msg}</Msg></Err></Errors></${op}Result></${op}Response>`);
const R_CONSULTA = ENV(`<FECompConsultarResponse><FECompConsultarResult><ResultGet><CodAutorizacion>71234567890123</CodAutorizacion><FchVto>20261113</FchVto><CbteFch>20261103</CbteFch><ImpTotal>1210.00</ImpTotal></ResultGet></FECompConsultarResult></FECompConsultarResponse>`);
const FAULT = ENV(`<soap:Fault><faultcode>soap:Server</faultcode><faultstring>boom</faultstring></soap:Fault>`);

async function main() {
  console.log("--- Configuracion ---");
  comprobar("sin ambiente: error", leerConfigArca({}).ok, false);
  comprobar("ambiente desconocido: error", leerConfigArca({ ARCA_AMBIENTE: "x", ARCA_CERT_PATH: "c", ARCA_KEY_PATH: "k" }).ok, false);
  comprobar("produccion fuera de NODE_ENV=production: error", leerConfigArca({ ARCA_AMBIENTE: "produccion", ARCA_CERT_PATH: "c", ARCA_KEY_PATH: "k", NODE_ENV: "development" }).ok, false);
  comprobar("produccion con NODE_ENV=production: ok", leerConfigArca({ ARCA_AMBIENTE: "produccion", ARCA_CERT_PATH: "c", ARCA_KEY_PATH: "k", NODE_ENV: "production" }).ok, true);
  comprobar("homologacion: ok", leerConfigArca({ ARCA_AMBIENTE: "Homologacion", ARCA_CERT_PATH: "c", ARCA_KEY_PATH: "k" }).ok, true);
  comprobar("faltan archivos: error", leerConfigArca({ ARCA_AMBIENTE: "homologacion" }).ok, false);
  await lanza("CUIT invalido no construye", ErrorArcaConfiguracion, () => crearEmisorArca({ ambiente: "HOMOLOGACION", cuit: "123", tickets: gestor(), enviar: transporte([]).enviar }));
  await lanza("produccion con URL ajena no construye", ErrorArcaConfiguracion, () => crearEmisorArca({ ambiente: "PRODUCCION", cuit: CUIT, tickets: gestor(), enviar: transporte([]).enviar, urls: { wsfe: "https://otro.example/x" } }));

  console.log("--- Armado de FECAESolicitar ---");
  const xml = xmlSolicitarCae({ token: "T", sign: "S", cuit: CUIT }, solicitud());
  for (const parte of ["<CantReg>1</CantReg>", "<PtoVta>7</PtoVta>", "<CbteTipo>1</CbteTipo>", "<DocTipo>80</DocTipo>", "<DocNro>30711111112</DocNro>", "<CbteDesde>5</CbteDesde><CbteHasta>5</CbteHasta>", "<CbteFch>20261103</CbteFch>", "<ImpTotal>1210.00</ImpTotal>", "<ImpNeto>1000.00</ImpNeto>", "<ImpIVA>210.00</ImpIVA>", "<MonId>PES</MonId><MonCotiz>1</MonCotiz>", "<CondicionIVAReceptorId>1</CondicionIVAReceptorId>", "<AlicIva><Id>5</Id><BaseImp>1000.00</BaseImp><Importe>210.00</Importe></AlicIva>"]) {
    comprobar(`factura A contiene ${parte}`, xml.includes(parte), true);
  }
  comprobar("factura sin CbtesAsoc", xml.includes("CbtesAsoc"), false);
  const xmlC = xmlSolicitarCae({ token: "T", sign: "S", cuit: CUIT }, solicitud({ tipo: "FACTURA_C", codigoArca: 11, receptor: { docTipo: 99, docNro: "0", condicionIvaCodigo: 5 }, importes: { total: d("500"), neto: d("500"), iva: d("0"), alicuotas: [] } }));
  comprobar("factura C sin bloque Iva", xmlC.includes("<Iva>"), false);
  comprobar("factura C consumidor final: DocNro 0", xmlC.includes("<DocTipo>99</DocTipo><DocNro>0</DocNro>"), true);
  const xmlNc = xmlSolicitarCae({ token: "T", sign: "S", cuit: CUIT }, solicitud({ tipo: "NOTA_CREDITO_A", codigoArca: 3, comprobanteAsociado: { tipo: "FACTURA_A", codigoArca: 1, puntoVenta: 7, numero: 4 } }));
  comprobar("nota de credito lleva CbtesAsoc", xmlNc.includes(`<CbtesAsoc><CbteAsoc><Tipo>1</Tipo><PtoVta>7</PtoVta><Nro>4</Nro><Cuit>${CUIT}</Cuit></CbteAsoc></CbtesAsoc>`), true);
  comprobar("el token se escapa", xmlSolicitarCae({ token: "<&>", sign: "S", cuit: CUIT }, solicitud()).includes("<Token>&lt;&amp;&gt;</Token>"), true);
  try { xmlSolicitarCae({ token: "T", sign: "S", cuit: CUIT }, solicitud({ receptor: { docTipo: 80, docNro: "30-7", condicionIvaCodigo: 1 } })); comprobar("DocNro no numerico lanza", "no lanzo", "lanzo"); } catch { comprobar("DocNro no numerico lanza", "lanzo", "lanzo"); }

  console.log("--- solicitarCae ---");
  let e = emisorCon([R_APROBADA()]);
  let r = await e.emisor.solicitarCae(solicitud());
  comprobar("aprobada: CAE", r.aprobado && r.cae, "71234567890123");
  comprobar("aprobada: vencimiento a medianoche UTC", r.aprobado && r.vencimiento.toISOString(), "2026-11-13T00:00:00.000Z");
  comprobar("va a la URL de homologacion", e.llamadas[0]!.url, "https://wswhomo.afip.gov.ar/wsfev1/service.asmx");
  comprobar("accion SOAP", e.llamadas[0]!.accion, "http://ar.gov.afip.dif.FEV1/FECAESolicitar");
  comprobar("el ambiente del emisor", e.emisor.ambiente, "HOMOLOGACION");
  e = emisorCon([R_APROBADA(`<Observaciones><Obs><Code>10063</Code><Msg>aviso</Msg></Obs></Observaciones>`)]);
  r = await e.emisor.solicitarCae(solicitud());
  comprobar("aprobada con observaciones sigue aprobada", r.aprobado && r.observaciones.join("|"), "[10063] aviso");
  e = emisorCon([R_RECHAZADA]);
  r = await e.emisor.solicitarCae(solicitud());
  comprobar("rechazada: no es excepcion", r.aprobado, false);
  comprobar("rechazada: texto con codigo", !r.aprobado && r.observaciones[0], "[10016] El numero no es el proximo a autorizar");
  e = emisorCon([R_ERRORES(10016, "no es el proximo", "FECAESolicitar")]);
  r = await e.emisor.solicitarCae(solicitud());
  comprobar("Errors sin detalle (inequivoco) = rechazo", !r.aprobado && r.observaciones[0], "[10016] no es el proximo");
  await lanza("autenticacion (600) = configuracion", ErrorArcaConfiguracion, () => emisorCon([R_ERRORES(600, "token", "FECAESolicitar")]).emisor.solicitarCae(solicitud()));
  await lanza("SOAP Fault = incierto", ErrorArcaIncierto, () => emisorCon([FAULT]).emisor.solicitarCae(solicitud()));
  await lanza("XML ilegible = incierto", ErrorArcaIncierto, () => emisorCon(["<html>502</html>"]).emisor.solicitarCae(solicitud()));
  await lanza("Resultado P = incierto", ErrorArcaIncierto, () => emisorCon([R_APROBADA().replace(/<Resultado>A<\/Resultado><CAE>/, "<Resultado>P</Resultado><CAE>")]).emisor.solicitarCae(solicitud()));
  await lanza("aprobada sin CAE = incierto", ErrorArcaIncierto, () => emisorCon([R_APROBADA().replace("<CAE>71234567890123</CAE>", "")]).emisor.solicitarCae(solicitud()));
  e = emisorCon([new ErrorArcaIncierto("corte"), R_APROBADA()]);
  await lanza("timeout: lanza", ErrorArcaIncierto, () => e.emisor.solicitarCae(solicitud()));
  comprobar("timeout: UN solo intento (nunca se reenvia sola)", e.llamadas.length, 1);
  await lanza("CUIT distinto al del emisor", ErrorArcaConfiguracion, () => emisorCon([R_APROBADA()]).emisor.solicitarCae(solicitud({ cuitEmisor: "27111111114" })));

  console.log("--- ultimoAutorizado ---");
  e = emisorCon([R_ULTIMO(41)]);
  comprobar("devuelve CbteNro", await e.emisor.ultimoAutorizado(7, "FACTURA_A"), 41);
  comprobar("pide el codigo ARCA del tipo", e.llamadas[0]!.xml.includes("<PtoVta>7</PtoVta><CbteTipo>1</CbteTipo>"), true);
  comprobar("0 si no hay", await emisorCon([R_ULTIMO(0)]).emisor.ultimoAutorizado(7, "FACTURA_A"), 0);
  e = emisorCon([new ErrorArcaIncierto("corte"), FAULT, R_ULTIMO(9)]);
  comprobar("lectura: reintenta ante incierto", await e.emisor.ultimoAutorizado(7, "FACTURA_A"), 9);
  comprobar("lectura: 3 llamadas", e.llamadas.length, 3);
  await lanza("lectura: sigue fallando = lanza (nunca 0 por las dudas)", ErrorArcaIncierto, () => emisorCon([FAULT]).emisor.ultimoAutorizado(7, "FACTURA_A"));
  e = emisorCon([R_ERRORES(600, "token", "FECompUltimoAutorizado"), R_ULTIMO(1)]);
  await lanza("configuracion no se reintenta", ErrorArcaConfiguracion, () => e.emisor.ultimoAutorizado(7, "FACTURA_A"));
  comprobar("configuracion: una sola llamada", e.llamadas.length, 1);

  console.log("--- consultar ---");
  const c = await emisorCon([R_CONSULTA]).emisor.consultar(7, "FACTURA_A", 5);
  comprobar("encontrado", c.encontrado, true);
  comprobar("encontrado: CAE, total, fechas", c.encontrado && `${c.cae} ${c.total.toFixed(2)} ${c.fecha.toISOString().slice(0, 10)} ${c.vencimiento.toISOString().slice(0, 10)}`, "71234567890123 1210.00 2026-11-03 2026-11-13");
  comprobar("602 = no existe", (await emisorCon([R_ERRORES(602, "sin datos", "FECompConsultar")]).emisor.consultar(7, "FACTURA_A", 5)).encontrado, false);
  await lanza("otro error NO es 'no existe'", ErrorArcaIncierto, () => emisorCon([R_ERRORES(500, "error interno", "FECompConsultar")]).emisor.consultar(7, "FACTURA_A", 5));
  await lanza("timeout NO es 'no existe'", ErrorArcaIncierto, () => emisorCon([new ErrorArcaIncierto("corte")]).emisor.consultar(7, "FACTURA_A", 5));
  await lanza("respuesta sin ResultGet NO es 'no existe'", ErrorArcaIncierto, () => emisorCon([ENV("<FECompConsultarResponse><FECompConsultarResult></FECompConsultarResult></FECompConsultarResponse>")]).emisor.consultar(7, "FACTURA_A", 5));
  await lanza("602 junto con otro error NO es 'no existe'", ErrorArcaIncierto, () => emisorCon([ENV("<FECompConsultarResponse><Errors><Err><Code>602</Code><Msg>a</Msg></Err><Err><Code>500</Code><Msg>b</Msg></Err></Errors></FECompConsultarResponse>")]).emisor.consultar(7, "FACTURA_A", 5));
  await lanza("autenticacion = configuracion", ErrorArcaConfiguracion, () => emisorCon([R_ERRORES(600, "token", "FECompConsultar")]).emisor.consultar(7, "FACTURA_A", 5));

  console.log("--- Fechas ---");
  comprobar("20261113", parsearFechaArca("20261113")?.toISOString(), "2026-11-13T00:00:00.000Z");
  comprobar("20261313 invalida", parsearFechaArca("20261313"), "null");
  comprobar("texto invalida", parsearFechaArca("hoy"), "null");

  console.log("--- Ticket de acceso (cache) ---");
  let pedidos = 0;
  let ahora = new Date("2026-11-03T12:00:00Z");
  const g = new GestorTicket(async () => { pedidos++; await new Promise((r) => setTimeout(r, 10)); return { token: "t", sign: "s", vence: new Date(ahora.getTime() + 12 * 3600_000) }; }, () => ahora);
  await Promise.all([g.obtener(), g.obtener(), g.obtener()]);
  comprobar("3 pedidos simultaneos = 1 solo TA (single-flight)", pedidos, 1);
  await g.obtener();
  comprobar("vigente: se reutiliza", pedidos, 1);
  ahora = new Date(ahora.getTime() + 12 * 3600_000 - 5 * 60_000);
  await g.obtener();
  comprobar("a menos de 10 min de vencer: se renueva", pedidos, 2);
  g.invalidar();
  await g.obtener();
  comprobar("invalidar fuerza uno nuevo", pedidos, 3);
  const gFalla = new GestorTicket(async () => { throw new ErrorArcaIncierto("x"); });
  await lanza("un pedido fallido no queda trabado", ErrorArcaIncierto, () => gFalla.obtener());
  await lanza("y se puede volver a pedir", ErrorArcaIncierto, () => gFalla.obtener());

  console.log("--- WSAA: TRA, firma CMS y respuesta ---");
  const tra = armarTra(new Date("2026-11-03T13:00:00Z"), 42);
  comprobar("TRA: service wsfe", tra.includes("<service>wsfe</service>"), true);
  comprobar("TRA: generationTime 10 min atras, hora argentina", tra.includes("<generationTime>2026-11-03T09:50:00-03:00</generationTime>"), true);
  comprobar("TRA: expirationTime 10 min adelante", tra.includes("<expirationTime>2026-11-03T10:10:00-03:00</expirationTime>"), true);
  const dir = mkdtempSync(join(tmpdir(), "arca-test-"));
  const cert = join(dir, "c.crt");
  const key = join(dir, "k.key");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=prueba/serialNumber=CUIT 20123456786"], { stdio: "ignore" });
  const b64 = await firmarTra(tra, { certPath: cert, keyPath: key });
  const der = join(dir, "firma.der");
  writeFileSync(der, Buffer.from(b64, "base64"));
  const verificado = execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-in", der, "-noverify", "-certfile", cert], { stdio: ["ignore", "pipe", "ignore"] }).toString();
  comprobar("la firma CMS verifica y contiene el TRA", verificado === tra, true);
  comprobar("loginCms lleva el CMS en in0", xmlLoginCms(b64).includes(`<in0>${b64}</in0>`), true);
  await lanza("clave inexistente: error de configuracion sin filtrar rutas", ErrorArcaConfiguracion, () => firmarTra(tra, { certPath: cert, keyPath: join(dir, "no-existe.key") }));
  try { await firmarTra(tra, { certPath: cert, keyPath: join(dir, "no-existe.key") }); } catch (err) { comprobar("el mensaje no nombra la ruta", String((err as Error).message).includes("no-existe"), false); }
  const retorno = `&lt;loginTicketResponse&gt;&lt;header&gt;&lt;expirationTime&gt;2026-11-04T01:00:00.000-03:00&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;AAA&lt;/token&gt;&lt;sign&gt;BBB&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;`;
  const t = leerLoginCms(ENV(`<loginCmsResponse><loginCmsReturn>${retorno}</loginCmsReturn></loginCmsResponse>`));
  comprobar("loginCms: token y sign", `${t.token}/${t.sign}`, "AAA/BBB");
  comprobar("loginCms: vencimiento", t.vence.toISOString(), "2026-11-04T04:00:00.000Z");
  await lanza("loginCms: Fault de certificado = configuracion", ErrorArcaConfiguracion, () => leerLoginCms(ENV(`<soap:Fault><faultstring>Certificado expirado</faultstring></soap:Fault>`)));
  await lanza("loginCms: alreadyAuthenticated = incierto", ErrorArcaIncierto, () => leerLoginCms(ENV(`<soap:Fault><faultstring>ns1:coe.alreadyAuthenticated</faultstring></soap:Fault>`)));
  await lanza("loginCms: respuesta ilegible = incierto", ErrorArcaIncierto, () => leerLoginCms("<html/>"));

  void readFileSync;
  console.log(`\n${total} comprobaciones, ${fallos} fallos`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
