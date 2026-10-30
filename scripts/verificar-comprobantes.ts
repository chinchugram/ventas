/**
 * Verificacion de la logica pura de facturacion: tipo de comprobante (A, B, C)
 * y codigos ARCA, receptor (documento, umbral de identificacion), importes por
 * alicuota con casos armados a mano (21, 10,5 y 0; redondeos que cierran y uno
 * que no), factura C, la seleccion del emisor con la guarda de produccion y el
 * emisor simulado (con un acceso a datos en memoria). No usa base.
 *
 *   npm run test:comprobantes
 */
import { d, type Dinero } from "../src/lib/money";
import {
  calcularImportes,
  CODIGO_ARCA,
  codigoAlicuota,
  DOC_TIPO,
  esFactura,
  esNotaCredito,
  letraDe,
  normalizarDni,
  numeroFormateado,
  tipoDeComprobante,
  tipoNotaCredito,
  validarReceptor,
  type ClienteReceptor,
  type LineaVentaFiscal,
  type TipoComprobante,
} from "../src/lib/comprobantes";
import {
  MENSAJE_ARCA_NO_IMPLEMENTADO,
  MENSAJE_SIMULADO_EN_PRODUCCION,
  obtenerEmisorFiscal,
  seleccionarEmisor,
  type SolicitudCae,
} from "../src/lib/fiscal";
import { crearEmisorSimulado, generarCae, type AccesoComprobantesSimulados } from "../src/lib/fiscal/emisor-simulado";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const n = (v: Dinero) => v.toFixed(2);

/** Linea de venta con los subtotales escritos A MANO (no se calculan aca). */
function linea(descripcion: string, cantidad: string, precio: string, iva: string, neto: string, ivaImporte: string, bruto: string): LineaVentaFiscal {
  return {
    descripcion,
    cantidad: d(cantidad),
    precioUnitario: d(precio),
    ivaPct: d(iva),
    subtotalNeto: d(neto),
    subtotalIVA: d(ivaImporte),
    subtotalBruto: d(bruto),
  };
}
const totales = (neto: string, iva: string, bruto: string) => ({ totalNeto: d(neto), totalIVA: d(iva), totalBruto: d(bruto) });

console.log("--- Tipos y códigos ARCA ---");
comprobar(
  "códigos",
  Object.entries(CODIGO_ARCA).map(([t, c]) => `${t}=${c}`).join(" "),
  "FACTURA_A=1 NOTA_CREDITO_A=3 FACTURA_B=6 NOTA_CREDITO_B=8 FACTURA_C=11 NOTA_CREDITO_C=13",
);
comprobar("letra de la NC A", letraDe("NOTA_CREDITO_A"), "A");
comprobar("NC de la factura A", tipoNotaCredito("FACTURA_A"), "NOTA_CREDITO_A");
comprobar("NC de la factura B", tipoNotaCredito("FACTURA_B"), "NOTA_CREDITO_B");
comprobar("NC de la factura C", tipoNotaCredito("FACTURA_C"), "NOTA_CREDITO_C");
comprobar("factura / NC", `${esFactura("FACTURA_C")} ${esNotaCredito("FACTURA_C")} ${esFactura("NOTA_CREDITO_B")} ${esNotaCredito("NOTA_CREDITO_B")}`, "true false false true");
comprobar("número formateado", numeroFormateado(1, 42), "0001-00000042");
comprobar("punto de venta de 5 dígitos", numeroFormateado(12345, 1), "12345-00000001");
comprobar(
  "alícuotas ARCA",
  ["0", "2.5", "5", "10.5", "21", "27", "15"].map((p) => `${p}:${codigoAlicuota(d(p))}`).join(" "),
  "0:3 2.5:9 5:8 10.5:4 21:5 27:6 15:null",
);

console.log("--- Qué factura corresponde ---");
const RI = { condicionIva: "RESPONSABLE_INSCRIPTO" as const };
const MONO = { condicionIva: "MONOTRIBUTO" as const };
const CUIT_OK = "30712345671";
comprobar("RI → RI con CUIT válido: A", tipoDeComprobante(RI, { condicionIva: "RESPONSABLE_INSCRIPTO", cuit: CUIT_OK }), "FACTURA_A");
comprobar("RI → RI con CUIT con guiones: A", tipoDeComprobante(RI, { condicionIva: "RESPONSABLE_INSCRIPTO", cuit: "30-71234567-1" }), "FACTURA_A");
comprobar("RI → RI con CUIT inválido: B (y el receptor se rechaza aparte)", tipoDeComprobante(RI, { condicionIva: "RESPONSABLE_INSCRIPTO", cuit: "30712345672" }), "FACTURA_B");
comprobar("RI → RI sin CUIT: B (y el receptor se rechaza aparte)", tipoDeComprobante(RI, { condicionIva: "RESPONSABLE_INSCRIPTO", cuit: null }), "FACTURA_B");
comprobar("RI → consumidor final: B", tipoDeComprobante(RI, { condicionIva: "CONSUMIDOR_FINAL", cuit: null }), "FACTURA_B");
comprobar("RI → consumidor final con CUIT: B", tipoDeComprobante(RI, { condicionIva: "CONSUMIDOR_FINAL", cuit: CUIT_OK }), "FACTURA_B");
comprobar("RI → monotributista: B", tipoDeComprobante(RI, { condicionIva: "MONOTRIBUTO", cuit: CUIT_OK }), "FACTURA_B");
comprobar("RI → exento: B", tipoDeComprobante(RI, { condicionIva: "EXENTO", cuit: CUIT_OK }), "FACTURA_B");
comprobar("monotributo → RI: C", tipoDeComprobante(MONO, { condicionIva: "RESPONSABLE_INSCRIPTO", cuit: CUIT_OK }), "FACTURA_C");
comprobar("monotributo → consumidor final: C", tipoDeComprobante(MONO, { condicionIva: "CONSUMIDOR_FINAL", cuit: null }), "FACTURA_C");

console.log("--- Receptor ---");
const UMBRAL = d("100000");
const cli = (extra: Partial<ClienteReceptor>): ClienteReceptor => ({
  nombre: "Cliente de prueba",
  cuit: null,
  dni: null,
  condicionIva: "CONSUMIDOR_FINAL",
  direccion: null,
  ...extra,
});
const receptor = (c: ClienteReceptor, tipo: TipoComprobante = "FACTURA_B", total = "1000", umbral = UMBRAL) => {
  const r = validarReceptor(c, { tipo, total: d(total), umbral });
  return r.ok ? `${r.receptor.docTipo}:${r.receptor.docNro}:${r.receptor.condicionIva}` : `error: ${r.error}`;
};
const esError = (s: string, fragmento: string) => (s.startsWith("error") && s.includes(fragmento) ? "rechazado" : s);
comprobar("RI con CUIT → 80", receptor(cli({ condicionIva: "RESPONSABLE_INSCRIPTO", cuit: "30-71234567-1" }), "FACTURA_A"), "80:30712345671:RESPONSABLE_INSCRIPTO");
comprobar("RI sin CUIT", esError(receptor(cli({ condicionIva: "RESPONSABLE_INSCRIPTO" })), "responsable inscripto pero no tiene CUIT"), "rechazado");
comprobar("RI con CUIT inválido", esError(receptor(cli({ condicionIva: "RESPONSABLE_INSCRIPTO", cuit: "30712345672" })), "CUIT del cliente no es válido"), "rechazado");
comprobar("monotributista sin CUIT", esError(receptor(cli({ condicionIva: "MONOTRIBUTO", dni: "12345678" })), "monotributista pero no tiene CUIT"), "rechazado");
comprobar("exento sin CUIT", esError(receptor(cli({ condicionIva: "EXENTO" })), "exento pero no tiene CUIT"), "rechazado");
comprobar("monotributista con CUIT → 80", receptor(cli({ condicionIva: "MONOTRIBUTO", cuit: CUIT_OK })), "80:30712345671:MONOTRIBUTO");
comprobar("factura A a un consumidor final", esError(receptor(cli({ cuit: CUIT_OK }), "FACTURA_A"), "solo para un responsable inscripto"), "rechazado");
comprobar("consumidor final con CUIT → 80", receptor(cli({ cuit: CUIT_OK })), "80:30712345671:CONSUMIDOR_FINAL");
comprobar("consumidor final con CUIT y DNI → prefiere CUIT", receptor(cli({ cuit: CUIT_OK, dni: "12345678" })), "80:30712345671:CONSUMIDOR_FINAL");
comprobar("consumidor final con DNI con puntos → 96", receptor(cli({ dni: "12.345.678" })), "96:12345678:CONSUMIDOR_FINAL");
comprobar("DNI de 7 dígitos", receptor(cli({ dni: "1234567" })), "96:1234567:CONSUMIDOR_FINAL");
comprobar("DNI inválido (corto)", esError(receptor(cli({ dni: "123" })), "DNI del cliente no es válido"), "rechazado");
comprobar("DNI inválido (letras)", esError(receptor(cli({ dni: "12A45678" })), "DNI del cliente no es válido"), "rechazado");
comprobar("CUIT cargado pero inválido en consumidor final: no se ignora", esError(receptor(cli({ cuit: "20-12345678-0" })), "CUIT del cliente no es válido"), "rechazado");
comprobar("sin identificar, debajo del umbral → 99, 0", receptor(cli({}), "FACTURA_B", "99999.99"), "99:0:CONSUMIDOR_FINAL");
comprobar("sin identificar, justo en el umbral", esError(receptor(cli({}), "FACTURA_B", "100000"), "exige identificar"), "rechazado");
comprobar("sin identificar, arriba del umbral", esError(receptor(cli({}), "FACTURA_B", "250000"), "exige identificar"), "rechazado");
comprobar("el umbral viene de afuera: otro umbral, otro resultado", esError(receptor(cli({}), "FACTURA_B", "60000", d("50000")), "50.000,00"), "rechazado");
comprobar("con DNI, arriba del umbral: ok", receptor(cli({ dni: "12345678" }), "FACTURA_B", "250000"), "96:12345678:CONSUMIDOR_FINAL");
comprobar("factura C sin identificar debajo del umbral", receptor(cli({}), "FACTURA_C", "500"), "99:0:CONSUMIDOR_FINAL");
comprobar("sin nombre", esError(receptor(cli({ nombre: "  " })), "no tiene nombre"), "rechazado");
comprobar("normalizarDni", `${normalizarDni(" 30.123.456 ")} ${normalizarDni("123456789")} ${normalizarDni("")}`, "30123456 null null");

console.log("--- Importes: factura B, una alícuota (21%) ---");
{
  // 2 × 1210 con IVA 21%: bruto 2420, neto 2000, IVA 420.
  const r = calcularImportes([linea("Cartel", "2", "1210", "21", "2000", "420", "2420")], totales("2000", "420", "2420"), "FACTURA_B");
  comprobar("cierra", String(r.ok), "true");
  if (r.ok) {
    const i = r.importes;
    comprobar("neto / IVA / total", `${n(i.neto)} ${n(i.iva)} ${n(i.total)}`, "2000.00 420.00 2420.00");
    comprobar("una alícuota (código 5)", i.alicuotas.map((a) => `${a.pct}%:${a.codigo}:${n(a.base)}:${n(a.importe)}`).join(" "), "21%:5:2000.00:420.00");
    comprobar("línea copiada", `${i.lineas[0]!.orden} ${i.lineas[0]!.descripcion} ${n(i.lineas[0]!.subtotalBruto)}`, "1 Cartel 2420.00");
    comprobar("sin advertencias", String(i.advertencias.length), "0");
  }
}

console.log("--- Importes: factura A, varias alícuotas (21, 10,5 y 0) ---");
{
  // 1 × 1210 (21%)      → neto 1000,00  IVA 210,00  bruto 1210,00
  // 3 × 110,50 (10,5%)  → bruto 331,50 / 1,105 = 300,00  IVA 31,50
  // 2 × 500 (0%)        → neto 1000,00  IVA 0       bruto 1000,00
  // Venta: neto 2300,00 + IVA 241,50 = 2541,50
  const lineas = [
    linea("Letras corpóreas", "1", "1210", "21", "1000", "210", "1210"),
    linea("Libro", "3", "110.5", "10.5", "300", "31.5", "331.5"),
    linea("Servicio exento", "2", "500", "0", "1000", "0", "1000"),
  ];
  const r = calcularImportes(lineas, totales("2300", "241.5", "2541.5"), "FACTURA_A");
  comprobar("cierra", String(r.ok), "true");
  if (r.ok) {
    const i = r.importes;
    comprobar("neto / IVA / total", `${n(i.neto)} ${n(i.iva)} ${n(i.total)}`, "2300.00 241.50 2541.50");
    comprobar(
      "tres alícuotas ordenadas, con sus códigos",
      i.alicuotas.map((a) => `${a.pct}%:${a.codigo}:${n(a.base)}:${n(a.importe)}`).join(" "),
      "0%:3:1000.00:0.00 10.5%:4:300.00:31.50 21%:5:1000.00:210.00",
    );
    comprobar("orden de las líneas", i.lineas.map((l) => `${l.orden}:${l.descripcion}`).join(" "), "1:Letras corpóreas 2:Libro 3:Servicio exento");
  }
}

console.log("--- Importes: redondeos que cierran ---");
{
  // 3 × 33,33 (21%): bruto 99,99; neto 99,99 / 1,21 = 82,636… → 82,64; IVA 99,99 − 82,64 = 17,35.
  // 1 × 0,01 (21%): bruto 0,01; neto 0,00826… → 0,01; IVA 0,00.
  const lineas = [linea("Stickers", "3", "33.33", "21", "82.64", "17.35", "99.99"), linea("Centavo", "1", "0.01", "21", "0.01", "0", "0.01")];
  const r = calcularImportes(lineas, totales("82.65", "17.35", "100"), "FACTURA_B");
  comprobar("cierra al centavo", r.ok ? `${n(r.importes.neto)} ${n(r.importes.iva)} ${n(r.importes.total)}` : r.error, "82.65 17.35 100.00");
  // Cantidad decimal: 1,5 × 1000 (10,5%): bruto 1500; neto 1500 / 1,105 = 1357,466… → 1357,47; IVA 142,53.
  const r2 = calcularImportes([linea("Vinilo por metro", "1.5", "1000", "10.5", "1357.47", "142.53", "1500")], totales("1357.47", "142.53", "1500"), "FACTURA_B");
  comprobar("cantidad decimal", r2.ok ? `${n(r2.importes.neto)} ${n(r2.importes.iva)}` : r2.error, "1357.47 142.53");
  // Muchas lineas chicas: el IVA por linea (0,02 × 7 = 0,14) se aleja de base × alicuota (0,56 × 21% = 0,12).
  // Se informa la suma por linea (la de la venta) y se AVISA; no se ajusta.
  const chicas = Array.from({ length: 7 }, (_, k) => linea(`Imán ${k + 1}`, "1", "0.10", "21", "0.08", "0.02", "0.10"));
  const r3 = calcularImportes(chicas, totales("0.56", "0.14", "0.70"), "FACTURA_B");
  comprobar("muchas líneas: cierra con la venta", r3.ok ? `${n(r3.importes.neto)} ${n(r3.importes.iva)}` : r3.error, "0.56 0.14");
  comprobar("muchas líneas: avisa la diferencia con base × alícuota", String(r3.ok && r3.importes.advertencias.some((a) => a.includes("base × alícuota"))), "true");
}

console.log("--- Importes: lo que NO cierra se rechaza (tolerancia cero) ---");
{
  const base = [linea("Cartel", "2", "1210", "21", "2000", "420", "2420")];
  const r1 = calcularImportes(base, totales("2000.01", "419.99", "2420"), "FACTURA_B");
  comprobar("neto de la venta corrido un centavo", r1.ok ? "aceptado" : r1.error.includes("neto de la venta") ? "rechazado" : r1.error, "rechazado");
  const r2 = calcularImportes(base, totales("2000", "420", "2420.01"), "FACTURA_B");
  comprobar("total de la venta corrido un centavo", r2.ok ? "aceptado" : r2.error.includes("total de la venta") ? "rechazado" : r2.error, "rechazado");
  // La linea guardada dice 82,63 + 17,36 (suma bien) pero el calculo de la venta da 82,64 + 17,35.
  const r3 = calcularImportes([linea("Stickers", "3", "33.33", "21", "82.63", "17.36", "99.99")], totales("82.63", "17.36", "99.99"), "FACTURA_B");
  comprobar("línea con el desglose corrido un centavo", r3.ok ? "aceptado" : r3.error.includes("no cierra") ? "rechazado" : r3.error, "rechazado");
  comprobar("el error dice qué línea y qué esperaba", String(!r3.ok && r3.error.includes("línea 1") && r3.error.includes("82,64")), "true");
  // El precio no da el bruto guardado (alguien edito la linea a mano).
  const r4 = calcularImportes([linea("Cartel", "2", "1210", "21", "2000", "420", "2420.5")], totales("2000", "420", "2420.5"), "FACTURA_B");
  comprobar("bruto que no es cantidad × precio", r4.ok ? "aceptado" : r4.error.includes("no cierra") ? "rechazado" : r4.error, "rechazado");
  const r5 = calcularImportes([linea("Raro", "1", "115", "15", "100", "15", "115")], totales("100", "15", "115"), "FACTURA_B");
  comprobar("alícuota que ARCA no tiene (15%)", r5.ok ? "aceptado" : r5.error.includes("ARCA no admite") ? "rechazado" : r5.error, "rechazado");
  const r6 = calcularImportes([linea("Regalo", "1", "0", "21", "0", "0", "0")], totales("0", "0", "0"), "FACTURA_B");
  comprobar("venta de $ 0", r6.ok ? "aceptado" : r6.error.includes("$ 0") ? "rechazado" : r6.error, "rechazado");
  const r7 = calcularImportes([], totales("0", "0", "0"), "FACTURA_B");
  comprobar("sin líneas", r7.ok ? "aceptado" : r7.error.includes("no tiene artículos") ? "rechazado" : r7.error, "rechazado");
}

console.log("--- Importes: factura C (monotributo) ---");
{
  const conIva = calcularImportes([linea("Cartel", "2", "1210", "21", "2000", "420", "2420")], totales("2000", "420", "2420"), "FACTURA_C");
  comprobar("C con IVA en la venta: sale por el total", conIva.ok ? `${n(conIva.importes.neto)} ${n(conIva.importes.iva)} ${n(conIva.importes.total)}` : conIva.error, "2420.00 0.00 2420.00");
  comprobar("C: sin alícuotas", String(conIva.ok && conIva.importes.alicuotas.length), "0");
  comprobar("C con IVA > 0: advierte", String(conIva.ok && conIva.importes.advertencias.some((a) => a.includes("no discrimina IVA"))), "true");
  const sinIva = calcularImportes([linea("Cartel", "2", "1000", "0", "2000", "0", "2000")], totales("2000", "0", "2000"), "FACTURA_C");
  comprobar("C sin IVA: no advierte", String(sinIva.ok && sinIva.importes.advertencias.length), "0");
  const noCierra = calcularImportes([linea("Cartel", "2", "1210", "21", "2000", "420", "2420")], totales("2000", "420", "2420.01"), "FACTURA_C");
  comprobar("C también concilia con la venta", noCierra.ok ? "aceptado" : "rechazado", "rechazado");
}

console.log("--- Selección del emisor y guarda de producción ---");
const sel = (e: Parameters<typeof seleccionarEmisor>[0]) => {
  const r = seleccionarEmisor(e);
  return r.ok ? r.emisor : r.error;
};
comprobar("sin nada: simulado", sel({}), "simulado");
comprobar("vacío: simulado", sel({ EMISOR_FISCAL: "" }), "simulado");
comprobar("'Simulado ' (mayúsculas y espacios)", sel({ EMISOR_FISCAL: "Simulado " }), "simulado");
comprobar("arca: no implementado", sel({ EMISOR_FISCAL: "arca" }), MENSAJE_ARCA_NO_IMPLEMENTADO);
comprobar("valor desconocido: error claro", sel({ EMISOR_FISCAL: "afip" }).includes('valor desconocido ("afip")') ? "error" : sel({ EMISOR_FISCAL: "afip" }), "error");
comprobar("desarrollo: simulado sin permiso", sel({ NODE_ENV: "development" }), "simulado");
comprobar("test: simulado sin permiso", sel({ NODE_ENV: "test" }), "simulado");
comprobar("producción sin permiso: deshabilitado", sel({ NODE_ENV: "production" }), MENSAJE_SIMULADO_EN_PRODUCCION);
comprobar("producción con EMISOR_FISCAL=simulado y sin permiso", sel({ NODE_ENV: "production", EMISOR_FISCAL: "simulado" }), MENSAJE_SIMULADO_EN_PRODUCCION);
comprobar("producción con PERMITIR_EMISOR_SIMULADO=1", sel({ NODE_ENV: "production", PERMITIR_EMISOR_SIMULADO: "1" }), "simulado");
comprobar("producción con PERMITIR_EMISOR_SIMULADO=true (no vale)", sel({ NODE_ENV: "production", PERMITIR_EMISOR_SIMULADO: "true" }), MENSAJE_SIMULADO_EN_PRODUCCION);
comprobar("producción con PERMITIR_EMISOR_SIMULADO=0", sel({ NODE_ENV: "production", PERMITIR_EMISOR_SIMULADO: "0" }), MENSAJE_SIMULADO_EN_PRODUCCION);
comprobar("producción con arca: no implementado", sel({ NODE_ENV: "production", EMISOR_FISCAL: "arca", PERMITIR_EMISOR_SIMULADO: "1" }), MENSAJE_ARCA_NO_IMPLEMENTADO);
comprobar("el mensaje de producción dice qué hacer", String(MENSAJE_SIMULADO_EN_PRODUCCION.includes("PERMITIR_EMISOR_SIMULADO=1")), "true");

console.log("--- Emisor simulado (acceso en memoria) ---");
async function simulador() {
  const emitidos: { pv: number; tipo: TipoComprobante; numero: number; cae: string; venc: Date; fecha: Date; total: Dinero }[] = [];
  const acceso: AccesoComprobantesSimulados = {
    async ultimoNumeroEmitido(pv, tipo) {
      return Math.max(0, ...emitidos.filter((e) => e.pv === pv && e.tipo === tipo).map((e) => e.numero));
    },
    async buscarEmitido(pv, tipo, numero) {
      const e = emitidos.find((x) => x.pv === pv && x.tipo === tipo && x.numero === numero);
      return e ? { cae: e.cae, caeVencimiento: e.venc, fecha: e.fecha, importeTotal: e.total } : null;
    },
  };
  const obtenido = obtenerEmisorFiscal({}, acceso);
  comprobar("obtenerEmisorFiscal en desarrollo: emisor SIMULADO", obtenido.ok ? obtenido.emisor.ambiente : obtenido.error, "SIMULADO");
  const bloqueado = obtenerEmisorFiscal({ NODE_ENV: "production" }, acceso);
  comprobar("obtenerEmisorFiscal en producción sin permiso: no hay emisor", bloqueado.ok ? "hay emisor" : bloqueado.error, MENSAJE_SIMULADO_EN_PRODUCCION);
  if (!obtenido.ok) return;
  const emisor = obtenido.emisor;

  const fecha = new Date("2026-10-30T00:00:00Z");
  const solicitud = (numero: number, extra: Partial<SolicitudCae> = {}): SolicitudCae => ({
    cuitEmisor: "20333333334",
    puntoVenta: 1,
    tipo: "FACTURA_B",
    codigoArca: 6,
    numero,
    fecha,
    concepto: 1,
    receptor: { docTipo: DOC_TIPO.SIN_IDENTIFICAR, docNro: "0", condicionIvaCodigo: 5 },
    importes: { total: d("1210"), neto: d("1000"), iva: d("210"), alicuotas: [{ codigo: 5, base: d("1000"), importe: d("210") }] },
    ...extra,
  });

  comprobar("último autorizado sin nada: 0", String(await emisor.ultimoAutorizado(1, "FACTURA_B")), "0");
  const r1 = await emisor.solicitarCae(solicitud(1));
  comprobar("aprueba el 1", String(r1.aprobado), "true");
  if (r1.aprobado) {
    comprobar("CAE de 14 dígitos", String(/^[1-9]\d{13}$/.test(r1.cae)), "true");
    comprobar("vencimiento: fecha + 10 días", r1.vencimiento.toISOString().slice(0, 10), "2026-11-09");
    comprobar("determinista: mismo pedido, mismo CAE", String((await emisor.solicitarCae(solicitud(1))).aprobado && r1.cae === ((await emisor.solicitarCae(solicitud(1))) as { cae: string }).cae), "true");
    emitidos.push({ pv: 1, tipo: "FACTURA_B", numero: 1, cae: r1.cae, venc: r1.vencimiento, fecha, total: d("1210") });
  }
  comprobar("último autorizado ahora: 1", String(await emisor.ultimoAutorizado(1, "FACTURA_B")), "1");
  comprobar("la numeración es por tipo: A sigue en 0", String(await emisor.ultimoAutorizado(1, "FACTURA_A")), "0");
  comprobar("y por punto de venta: el 2 sigue en 0", String(await emisor.ultimoAutorizado(2, "FACTURA_B")), "0");
  const salteado = await emisor.solicitarCae(solicitud(3));
  comprobar("rechaza un número salteado", salteado.aprobado ? "aprobado" : salteado.observaciones.join(" "), "[10016] El número 3 no es el próximo a autorizar (2).");
  const repetido = await emisor.solicitarCae(solicitud(1));
  comprobar("rechaza un número ya autorizado", String(repetido.aprobado), "false");
  const aSinCuit = await emisor.solicitarCae(solicitud(1, { tipo: "FACTURA_A", codigoArca: 1 }));
  comprobar("rechaza una A sin CUIT", aSinCuit.aprobado ? "aprobado" : String(aSinCuit.observaciones.some((o) => o.includes("[10013]"))), "true");
  const cConIva = await emisor.solicitarCae(solicitud(1, { tipo: "FACTURA_C", codigoArca: 11 }));
  comprobar("rechaza una C con IVA", cConIva.aprobado ? "aprobado" : String(cConIva.observaciones.some((o) => o.includes("[10071]"))), "true");
  const descuadre = await emisor.solicitarCae(solicitud(2, { importes: { total: d("1210"), neto: d("1000"), iva: d("210"), alicuotas: [{ codigo: 5, base: d("999"), importe: d("210") }] } }));
  comprobar("rechaza alícuotas que no suman", String(descuadre.aprobado), "false");
  const ncSinAsociado = await emisor.solicitarCae(solicitud(1, { tipo: "NOTA_CREDITO_B", codigoArca: 8 }));
  comprobar("rechaza una NC sin factura asociada", String(ncSinAsociado.aprobado), "false");
  const otroCae = await emisor.solicitarCae(solicitud(2));
  comprobar("el 2 tiene otro CAE", String(otroCae.aprobado && r1.aprobado && otroCae.cae !== r1.cae), "true");

  const consultaSi = await emisor.consultar(1, "FACTURA_B", 1);
  comprobar("consultar uno autorizado", String(consultaSi.encontrado && r1.aprobado && consultaSi.cae === r1.cae), "true");
  comprobar("consultar uno que no está", String((await emisor.consultar(1, "FACTURA_B", 2)).encontrado), "false");

  const forzado = crearEmisorSimulado(acceso, { rechazar: () => ["Rechazo de prueba"] });
  const rf = await forzado.solicitarCae(solicitud(2));
  comprobar("rechazo forzado (para pruebas)", rf.aprobado ? "aprobado" : rf.observaciones.join(), "Rechazo de prueba");
  const cortado = crearEmisorSimulado(acceso, { cortar: () => true });
  let lanzo = false;
  try {
    await cortado.solicitarCae(solicitud(2));
  } catch {
    lanzo = true;
  }
  comprobar("corte simulado: lanza (no es un rechazo)", String(lanzo), "true");

  const caes = new Set(Array.from({ length: 2000 }, (_, k) => generarCae(`semilla ${k}`)));
  comprobar("2000 CAE: todos de 14 dígitos sin cero adelante", String([...caes].every((c) => /^[1-9]\d{13}$/.test(c))), "true");
  comprobar("2000 CAE: sin repetidos", String(caes.size), "2000");
}

simulador()
  .then(() => {
    if (fallos > 0) {
      console.log(`\n${fallos} comprobaciones fallaron.`);
      process.exit(1);
    }
    console.log("\nTodo OK.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
