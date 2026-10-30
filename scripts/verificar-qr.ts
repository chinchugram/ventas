/**
 * Verificacion del QR fiscal (sin base, sin Next).
 *
 *   npm run test:qr
 *
 * No se pudo leer el PDF oficial de ARCA (host bloqueado en el entorno de
 * desarrollo): el JSON esperado esta escrito A MANO con la estructura de la
 * especificacion (ver el encabezado de src/lib/qr-fiscal.ts). Si se consigue el
 * ejemplo oficial, agregarlo aca con su base64.
 */
import { d } from "../src/lib/money";
import { importeQr, jsonQr, svgQr, urlQr, URL_QR_FISCAL, type DatosQr } from "../src/lib/qr-fiscal";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

function lanza(etiqueta: string, f: () => unknown) {
  let msg = "no lanzo";
  try {
    f();
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  const ok = msg.startsWith("QR fiscal:");
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${msg}`);
}

const base: DatosQr = {
  fecha: new Date("2026-03-05T00:00:00.000Z"),
  cuitEmisor: "20-33333333-4",
  puntoVenta: 1,
  codigoTipo: 6,
  numero: 42,
  importeTotal: d("1210.5"),
  docTipoReceptor: 96,
  docNroReceptor: "12345678",
  cae: "70417054367476",
};

async function main() {
  console.log("--- JSON (campos, orden, tipos) ---");
  const esperado =
    '{"ver":1,"fecha":"2026-03-05","cuit":20333333334,"ptoVta":1,"tipoCmp":6,"nroCmp":42,"importe":1210.50,' +
    '"moneda":"PES","ctz":1,"tipoDocRec":96,"nroDocRec":12345678,"tipoCodAut":"E","codAut":70417054367476}';
  comprobar("JSON armado a mano", jsonQr(base), esperado);

  const obj = JSON.parse(jsonQr(base)) as Record<string, unknown>;
  comprobar(
    "orden de los campos",
    Object.keys(obj).join(","),
    "ver,fecha,cuit,ptoVta,tipoCmp,nroCmp,importe,moneda,ctz,tipoDocRec,nroDocRec,tipoCodAut,codAut",
  );
  comprobar("cuit es numero", typeof obj.cuit, "number");
  comprobar("codAut es numero (CAE)", typeof obj.codAut, "number");
  comprobar("codAut conserva los 14 digitos", String(obj.codAut), "70417054367476");
  comprobar("nroDocRec es numero", typeof obj.nroDocRec, "number");
  comprobar("tipoCodAut es texto E", String(obj.tipoCodAut), "E");
  comprobar("fecha YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(String(obj.fecha)) ? "si" : "no", "si");

  console.log("--- URL y base64 ---");
  const url = urlQr(base);
  comprobar("prefijo", url.slice(0, URL_QR_FISCAL.length), "https://www.afip.gob.ar/fe/qr/?p=");
  const b64 = url.slice(URL_QR_FISCAL.length);
  comprobar("base64 valido (alfabeto estandar)", /^[A-Za-z0-9+/]+={0,2}$/.test(b64) ? "si" : "no", "si");
  comprobar("decodifica al mismo JSON", atob(b64), esperado);
  comprobar("base64 conocido de un JSON chico", Buffer.from('{"ver":1}').toString("base64"), "eyJ2ZXIiOjF9");

  console.log("--- Importe (Decimal, dos decimales, sin number) ---");
  comprobar("1210.5", importeQr(d("1210.5")), "1210.50");
  comprobar("entero", importeQr(d("100")), "100.00");
  comprobar("redondeo medio arriba", importeQr(d("0.005")), "0.01");
  comprobar("0.1+0.2 sin deriva de float", importeQr(d("0.1").plus(d("0.2"))), "0.30");
  comprobar("grande", importeQr(d("9999999999999.99")), "9999999999999.99");
  comprobar("string", importeQr("33.3"), "33.30");
  lanza("negativo", () => importeQr(d("-1")));
  lanza("mas de 13 enteros", () => importeQr(d("10000000000000")));

  console.log("--- Otras variantes ---");
  const sinIdentificar = JSON.parse(jsonQr({ ...base, codigoTipo: 11, docTipoReceptor: 99, docNroReceptor: "0" })) as Record<string, unknown>;
  comprobar("sin identificar: tipoDocRec 99, nroDocRec 0", `${sinIdentificar.tipoDocRec}/${sinIdentificar.nroDocRec}`, "99/0");
  const nc = JSON.parse(jsonQr({ ...base, codigoTipo: 8 })) as Record<string, unknown>;
  comprobar("nota de credito B: tipoCmp 8", String(nc.tipoCmp), "8");
  comprobar("CUIT sin guiones igual", jsonQr({ ...base, cuitEmisor: "20333333334" }), esperado);
  comprobar(
    "CAE con cero inicial no rompe el JSON",
    String((JSON.parse(jsonQr({ ...base, cae: "01234567890123" })) as { codAut: number }).codAut),
    "1234567890123",
  );

  console.log("--- Validaciones ---");
  lanza("CAE de 13 digitos", () => jsonQr({ ...base, cae: "7041705436747" }));
  lanza("CAE con letras", () => jsonQr({ ...base, cae: "7041705436747A" }));
  lanza("CUIT corto", () => jsonQr({ ...base, cuitEmisor: "2033333333" }));
  lanza("numero 0", () => jsonQr({ ...base, numero: 0 }));
  lanza("punto de venta decimal", () => jsonQr({ ...base, puntoVenta: 1.5 }));
  lanza("fecha invalida", () => jsonQr({ ...base, fecha: new Date("x") }));

  console.log("--- SVG ---");
  const svg = await svgQr(base);
  comprobar("es un svg", svg.startsWith("<svg") && svg.trimEnd().endsWith("</svg>") ? "si" : "no", "si");
  comprobar("tiene viewBox", /viewBox="0 0 \d+ \d+"/.test(svg) ? "si" : "no", "si");
  comprobar("determinista", (await svgQr(base)) === svg ? "si" : "no", "si");
  comprobar("cambia con el CAE", (await svgQr({ ...base, cae: "70417054367477" })) !== svg ? "si" : "no", "si");

  if (fallos > 0) {
    console.error(`\n${fallos} fallo(s)`);
    process.exit(1);
  }
  console.log("\nTodo OK");
}

main();
