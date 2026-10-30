/**
 * Verificacion de la logica pura de "Facturar desde la venta y listado" (5.5),
 * sin base y sin Next:
 *
 *   npm run test:facturar
 *
 *  1. Filtros del listado: URL → filtros → `where`, entradas invalidas, paginacion.
 *  2. Estado de facturacion de una venta derivado de sus comprobantes.
 *  3. Avisos antes de emitir (datos fiscales, emisor deshabilitado, receptor, monotributo con IVA).
 *  4. La marca "SIN VALIDEZ FISCAL".
 */
import { d } from "../src/lib/money";
import { digitoVerificadorCuit } from "../src/lib/cuit";
import { CLAVES_FISCALES } from "../src/lib/datos-fiscales";
import type { ClienteReceptor, TipoComprobante } from "../src/lib/comprobantes";
import { MENSAJE_SIMULADO_EN_PRODUCCION, seleccionarEmisor } from "../src/lib/fiscal";
import {
  avisosParaEmitir,
  derivarFacturacion,
  paginar,
  parseFiltrosComprobantes,
  pendienteResoluble,
  queryDeFiltros,
  sinValidezFiscal,
  TAMANO_PAGINA,
  whereDeFiltros,
  type AmbienteComprobante,
  type ComprobanteDeVenta,
  type EstadoComprobante,
} from "../src/lib/facturacion";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const iso = (f: Date | null) => (f ? f.toISOString().slice(0, 10) : "-");

// ─── 1. Filtros del listado ───────────────────────────────────────────────────

console.log("--- Filtros del listado ---");
{
  const vacio = parseFiltrosComprobantes({});
  comprobar("sin parametros: sin filtros", JSON.stringify(whereDeFiltros(vacio)), "{}");
  comprobar("sin parametros: pagina 1 y sin avisos", `${vacio.pagina} ${vacio.avisos.length}`, "1 0");

  const todo = parseFiltrosComprobantes({
    tipo: "FACTURA_B",
    estado: "EMITIDO",
    ambiente: "SIMULADO",
    desde: "2026-03-01",
    hasta: "2026-03-31",
    pagina: "3",
  });
  const w = whereDeFiltros(todo);
  comprobar("todos los filtros: tipo/estado/ambiente", `${w.tipo} ${w.estado} ${w.ambiente}`, "FACTURA_B EMITIDO SIMULADO");
  comprobar("fechas: desde inclusivo", iso(w.fecha?.gte ?? null), "2026-03-01");
  comprobar("fechas: hasta EXCLUSIVO = dia siguiente al ultimo incluido", iso(w.fecha?.lt ?? null), "2026-04-01");
  comprobar("pagina 3", String(todo.pagina), "3");
  comprobar("query de los filtros", queryDeFiltros(todo, 3), "tipo=FACTURA_B&estado=EMITIDO&ambiente=SIMULADO&desde=2026-03-01&hasta=2026-03-31&pagina=3");
  comprobar("query: la pagina 1 no se escribe", String(queryDeFiltros(todo, 1).includes("pagina")), "false");
  comprobar("query sin filtros", queryDeFiltros(vacio), "");

  for (const t of ["FACTURA_A", "FACTURA_B", "FACTURA_C", "NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"] as TipoComprobante[]) {
    comprobar(`tipo ${t} es valido`, String(parseFiltrosComprobantes({ tipo: t }).tipo), t);
  }

  const mal = parseFiltrosComprobantes({ tipo: "RECIBO", estado: "ANULADO", ambiente: "TEST", pagina: "abc" });
  comprobar("valores invalidos: no filtran", JSON.stringify(whereDeFiltros(mal)), "{}");
  comprobar("valores invalidos: avisan (tipo, estado, ambiente, pagina)", String(mal.avisos.length), "4");
  comprobar("pagina 0 o negativa → 1 con aviso", `${parseFiltrosComprobantes({ pagina: "0" }).pagina} ${parseFiltrosComprobantes({ pagina: "-2" }).avisos.length}`, "1 1");
  comprobar("pagina enorme → se acota despues, con paginar()", String(parseFiltrosComprobantes({ pagina: "999999" }).pagina), "999999");

  const soloDesde = parseFiltrosComprobantes({ desde: "2026-03-01" });
  comprobar("solo una fecha: se ignora con aviso", `${JSON.stringify(whereDeFiltros(soloDesde))} ${soloDesde.avisos.length}`, "{} 1");
  const imposible = parseFiltrosComprobantes({ desde: "2026-02-30", hasta: "2026-03-01" });
  comprobar("fecha imposible: se ignora con aviso", `${JSON.stringify(whereDeFiltros(imposible))} ${imposible.avisos.length}`, "{} 1");
  const alReves = parseFiltrosComprobantes({ desde: "2026-03-31", hasta: "2026-03-01" });
  comprobar("fechas al reves: se intercambian (con aviso)", `${alReves.desdeISO} ${alReves.hastaISO} ${alReves.avisos.length}`, "2026-03-01 2026-03-31 1");
  comprobar("un solo dia", iso(parseFiltrosComprobantes({ desde: "2026-03-05", hasta: "2026-03-05" }).hasta), "2026-03-06");
  comprobar("parametro repetido: toma el primero", String(parseFiltrosComprobantes({ estado: ["PENDIENTE", "EMITIDO"] }).estado), "PENDIENTE");
  comprobar("vacios del formulario GET no filtran", JSON.stringify(whereDeFiltros(parseFiltrosComprobantes({ tipo: "", estado: "", ambiente: "", desde: "", hasta: "", pagina: "" }))), "{}");
  comprobar("un valor raro no pisa el prototipo", String(parseFiltrosComprobantes({ tipo: "__proto__", estado: "constructor" }).avisos.length), "2");

  const p0 = paginar(0, 1);
  comprobar("paginar: vacio = 1 pagina", `${p0.pagina}/${p0.totalPaginas} skip ${p0.skip}`, "1/1 skip 0");
  const p1 = paginar(TAMANO_PAGINA, 1);
  comprobar("paginar: justo una pagina", `${p1.totalPaginas}`, "1");
  const p2 = paginar(TAMANO_PAGINA + 1, 2);
  comprobar("paginar: segunda pagina", `${p2.pagina}/${p2.totalPaginas} skip ${p2.skip} take ${p2.take}`, `2/2 skip ${TAMANO_PAGINA} take ${TAMANO_PAGINA}`);
  const p3 = paginar(45, 99);
  comprobar("paginar: pagina inexistente → la ultima", `${p3.pagina}/${p3.totalPaginas}`, "2/2");
}

// ─── 2. Estado de facturacion de una venta ────────────────────────────────────

console.log("--- Estado de facturacion de una venta ---");
let seq = 0;
function comp(extra: Partial<ComprobanteDeVenta> & { id: string }): ComprobanteDeVenta {
  seq += 1;
  return {
    tipo: "FACTURA_B",
    estado: "EMITIDO",
    ambiente: "SIMULADO",
    puntoVenta: 1,
    numero: seq,
    fecha: new Date("2026-03-01T00:00:00Z"),
    importeTotal: d(1210),
    observaciones: null,
    comprobanteAsociadoId: null,
    creadoEn: new Date(Date.UTC(2026, 2, 1, 12, 0, seq)),
    ...extra,
  };
}
const sit = (cs: ComprobanteDeVenta[], anulada = false) => {
  const r = derivarFacturacion(cs, anulada);
  return `${r.situacion} emitir=${r.puedeEmitir}`;
};
{
  comprobar("sin comprobantes", sit([]), "SIN_FACTURA emitir=true");
  comprobar("sin comprobantes y anulada", sit([], true), "VENTA_ANULADA emitir=false");
  comprobar("factura EMITIDA", sit([comp({ id: "f" })]), "EMITIDA emitir=false");
  comprobar("factura PENDIENTE", sit([comp({ id: "f", estado: "PENDIENTE" })]), "PENDIENTE emitir=false");
  comprobar("factura RECHAZADA: se puede reintentar", sit([comp({ id: "f", estado: "RECHAZADO", observaciones: "x" })]), "RECHAZADA emitir=true");
  comprobar("rechazada en una venta anulada: no se factura", sit([comp({ id: "f", estado: "RECHAZADO" })], true), "VENTA_ANULADA emitir=false");

  const rechazada = comp({ id: "r", estado: "RECHAZADO", observaciones: "[10016] mal" });
  const emitida = comp({ id: "e" });
  const reintentada = derivarFacturacion([rechazada, emitida], false);
  comprobar("rechazada y despues emitida: manda la emitida", `${reintentada.situacion} ${reintentada.factura?.id} rechazos=${reintentada.rechazos}`, "EMITIDA e rechazos=1");

  const dosRechazos = derivarFacturacion(
    [comp({ id: "r1", estado: "RECHAZADO", creadoEn: new Date("2026-03-01T10:00:00Z") }), comp({ id: "r2", estado: "RECHAZADO", creadoEn: new Date("2026-03-01T11:00:00Z") })],
    false,
  );
  comprobar("dos rechazos: se muestra el ultimo", `${dosRechazos.factura?.id} rechazos=${dosRechazos.rechazos}`, "r2 rechazos=2");

  const nc = comp({ id: "n", tipo: "NOTA_CREDITO_B", comprobanteAsociadoId: "e" });
  const conNc = derivarFacturacion([emitida, nc], true);
  comprobar("factura con NC emitida (venta anulada)", `${conNc.situacion} ${conNc.factura?.id} ${conNc.notaCredito?.id} emitir=${conNc.puedeEmitir}`, "CON_NOTA_CREDITO e n emitir=false");
  const ncPend = derivarFacturacion([emitida, comp({ id: "np", tipo: "NOTA_CREDITO_B", estado: "PENDIENTE", comprobanteAsociadoId: "e" })], false);
  comprobar("NC pendiente: sigue EMITIDA, con la NC a la vista", `${ncPend.situacion} ${ncPend.notaCredito?.id}`, "EMITIDA np");
  const ncRech = derivarFacturacion([emitida, comp({ id: "nr", tipo: "NOTA_CREDITO_B", estado: "RECHAZADO", comprobanteAsociadoId: "e" })], false);
  comprobar("NC rechazada: no cuenta", `${ncRech.situacion} ${ncRech.notaCredito}`, "EMITIDA null");
  const ncAjena = derivarFacturacion([emitida, comp({ id: "nx", tipo: "NOTA_CREDITO_B", comprobanteAsociadoId: "otra" })], false);
  comprobar("NC de otra factura: no cuenta", ncAjena.situacion, "EMITIDA");
  comprobar("las NC no cuentan como factura", sit([nc]), "SIN_FACTURA emitir=true");
  comprobar("orden de entrada irrelevante", sit([nc, emitida]), sit([emitida, nc]));

  const ahora = new Date("2026-03-01T12:10:00Z");
  const DOS_MIN = 2 * 60_000;
  comprobar("PENDIENTE de 1 minuto: todavia no se resuelve", String(pendienteResoluble(new Date("2026-03-01T12:09:00Z"), ahora, DOS_MIN)), "false");
  comprobar("PENDIENTE de 2 minutos justos: se resuelve", String(pendienteResoluble(new Date("2026-03-01T12:08:00Z"), ahora, DOS_MIN)), "true");
  comprobar("PENDIENTE de una hora: se resuelve", String(pendienteResoluble(new Date("2026-03-01T11:10:00Z"), ahora, DOS_MIN)), "true");
}

// ─── 3. Avisos antes de emitir ────────────────────────────────────────────────

console.log("--- Avisos antes de emitir ---");
const cuitCon = (diez: string) => `${diez}${digitoVerificadorCuit(diez)}`;
const fiscalesOk: Record<string, string> = {
  [CLAVES_FISCALES.razonSocial]: "Negocio de Prueba S.R.L.",
  [CLAVES_FISCALES.cuit]: cuitCon("2033333333"),
  [CLAVES_FISCALES.condicionIva]: "RESPONSABLE_INSCRIPTO",
  [CLAVES_FISCALES.domicilio]: "Calle 123, Córdoba",
  [CLAVES_FISCALES.inicioActividades]: "2020-03-02",
  [CLAVES_FISCALES.puntoVenta]: "1",
};
const HOY = new Date("2026-03-15T00:00:00Z");
const final: ClienteReceptor = { nombre: "Consumidor", cuit: null, dni: null, condicionIva: "CONSUMIDOR_FINAL", direccion: null };
const ri: ClienteReceptor = { nombre: "Empresa SA", cuit: cuitCon("3070000000"), dni: null, condicionIva: "RESPONSABLE_INSCRIPTO", direccion: null };
const riSinCuit: ClienteReceptor = { nombre: "Empresa sin CUIT", cuit: null, dni: null, condicionIva: "RESPONSABLE_INSCRIPTO", direccion: null };
const OK = { ok: true } as const;
const entrada = (extra: Partial<Parameters<typeof avisosParaEmitir>[0]> = {}) => ({
  emisor: OK,
  config: fiscalesOk,
  hoy: HOY,
  cliente: final,
  ventaTotal: d(1210),
  ventaIva: d(210),
  ...extra,
});
const codigos = (e: ReturnType<typeof entrada>) => avisosParaEmitir(e).bloqueantes.map((b) => b.codigo).join(",") || "-";
{
  const base = avisosParaEmitir(entrada());
  comprobar("todo en orden: sin avisos", `${base.bloqueantes.length} ${base.advertencias.length}`, "0 0");
  comprobar("todo en orden: saldria una Factura B", String(base.tipoPrevisto), "FACTURA_B");
  comprobar("receptor RI con CUIT: Factura A", String(avisosParaEmitir(entrada({ cliente: ri })).tipoPrevisto), "FACTURA_A");

  const sinNada = avisosParaEmitir(entrada({ config: {} }));
  comprobar("datos fiscales sin cargar: bloquea", codigos(entrada({ config: {} })), "DATOS_FISCALES");
  comprobar("datos fiscales: el mensaje manda a Configuracion", String(sinNada.bloqueantes[0]?.mensaje.includes("Configuración")), "true");
  comprobar("datos fiscales: sin tipo previsto", String(sinNada.tipoPrevisto), "null");
  const sinCuit = { ...fiscalesOk, [CLAVES_FISCALES.cuit]: "" };
  comprobar("falta el CUIT del negocio: bloquea", codigos(entrada({ config: sinCuit })), "DATOS_FISCALES");
  const cuitMalo = { ...fiscalesOk, [CLAVES_FISCALES.cuit]: "20333333330" };
  comprobar("CUIT del negocio invalido: bloquea", codigos(entrada({ config: cuitMalo })), "DATOS_FISCALES");
  const inicioFuturo = { ...fiscalesOk, [CLAVES_FISCALES.inicioActividades]: "2030-01-01" };
  comprobar("inicio de actividades en el futuro: bloquea", codigos(entrada({ config: inicioFuturo })), "DATOS_FISCALES");

  const deshabilitada = seleccionarEmisor({ NODE_ENV: "production" });
  comprobar("emisor simulado en produccion sin permiso: bloquea", codigos(entrada({ emisor: deshabilitada.ok ? OK : deshabilitada })), "EMISOR_DESHABILITADO");
  const avisoEmisor = avisosParaEmitir(entrada({ emisor: deshabilitada.ok ? OK : deshabilitada })).bloqueantes[0];
  comprobar("emisor deshabilitado: es el mensaje de seleccionarEmisor", avisoEmisor?.mensaje ?? "-", MENSAJE_SIMULADO_EN_PRODUCCION);
  comprobar("simulado en produccion CON permiso: no bloquea", String(seleccionarEmisor({ NODE_ENV: "production", PERMITIR_EMISOR_SIMULADO: "1" }).ok), "true");
  comprobar("EMISOR_FISCAL=arca: bloquea (no implementado)", codigos(entrada({ emisor: seleccionarEmisor({ EMISOR_FISCAL: "arca" }) as { ok: false; error: string } })), "EMISOR_DESHABILITADO");
  comprobar(
    "emisor deshabilitado Y sin datos: los dos avisos",
    codigos(entrada({ emisor: { ok: false, error: "x" }, config: {} })),
    "EMISOR_DESHABILITADO,DATOS_FISCALES",
  );

  comprobar("receptor RI sin CUIT: bloquea", codigos(entrada({ cliente: riSinCuit })), "RECEPTOR");
  comprobar("receptor RI sin CUIT: explica", String(avisosParaEmitir(entrada({ cliente: riSinCuit })).bloqueantes[0]?.mensaje.includes("no tiene CUIT")), "true");
  comprobar("consumidor final sobre el umbral sin identificar: bloquea", codigos(entrada({ ventaTotal: d(10_000_000), ventaIva: d(0) })), "RECEPTOR");
  const conDni = { ...final, dni: "12345678" };
  comprobar("consumidor final sobre el umbral CON DNI: no bloquea", codigos(entrada({ cliente: conDni, ventaTotal: d(10_000_000), ventaIva: d(0) })), "-");
  const cuitInvalido = { ...final, cuit: "20111111111" };
  comprobar("CUIT del cliente invalido: bloquea", codigos(entrada({ cliente: cuitInvalido })), "RECEPTOR");
  comprobar("receptor invalido NO oculta el tipo previsto", String(avisosParaEmitir(entrada({ cliente: riSinCuit })).tipoPrevisto), "FACTURA_B");

  const mono = { ...fiscalesOk, [CLAVES_FISCALES.condicionIva]: "MONOTRIBUTO" };
  const monoConIva = avisosParaEmitir(entrada({ config: mono }));
  comprobar("monotributo con IVA > 0: advierte, no bloquea", `${monoConIva.bloqueantes.length} ${monoConIva.advertencias.length}`, "0 1");
  comprobar("monotributo: Factura C", String(monoConIva.tipoPrevisto), "FACTURA_C");
  comprobar("monotributo: el aviso habla de IVA 0", String(monoConIva.advertencias[0]?.includes("IVA 0")), "true");
  comprobar("monotributo con IVA = 0: sin advertencia", String(avisosParaEmitir(entrada({ config: mono, ventaIva: d(0) })).advertencias.length), "0");
  comprobar("RI con IVA: sin advertencia de IVA", String(base.advertencias.length), "0");
  comprobar("monotributo a un RI: igual Factura C", String(avisosParaEmitir(entrada({ config: mono, cliente: ri })).tipoPrevisto), "FACTURA_C");
}

// ─── 4. Marca de ambiente ─────────────────────────────────────────────────────

console.log("--- SIN VALIDEZ FISCAL ---");
for (const [ambiente, esperado] of [["SIMULADO", "true"], ["HOMOLOGACION", "true"], ["PRODUCCION", "false"]] as [AmbienteComprobante, string][]) {
  comprobar(`ambiente ${ambiente}: sin validez fiscal`, String(sinValidezFiscal(ambiente)), esperado);
}
const estados: EstadoComprobante[] = ["PENDIENTE", "EMITIDO", "RECHAZADO"];
comprobar("hay un filtro por cada estado", estados.map((e) => String(parseFiltrosComprobantes({ estado: e }).estado)).join(","), estados.join(","));

if (fallos > 0) {
  console.log(`\n${fallos} comprobaciones fallaron.`);
  process.exit(1);
}
console.log("\nTodo OK.");
