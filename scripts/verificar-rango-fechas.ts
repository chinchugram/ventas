/**
 * Verificacion de `lib/rango-fechas.ts` contra fechas conocidas.
 *
 *   npm run test:rango-fechas
 */
import { conRango, parseRangoFechas, rangoAQuery, rangoDeMes, rangoEntre } from "../src/lib/rango-fechas";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: unknown, esperado: unknown) {
  const o = typeof obtenido === "string" ? obtenido : JSON.stringify(obtenido);
  const e = typeof esperado === "string" ? esperado : JSON.stringify(esperado);
  const ok = o === e;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${o}${ok ? "" : ` (esperado ${e})`}`);
}

/** "desde → hasta(exclusivo) | ultimo dia incluido" para leer rapido. */
const resumen = (r: { desde: Date; hasta: Date; hastaISO: string }) =>
  `${r.desde.toISOString()} → ${r.hasta.toISOString()} | ${r.hastaISO}`;

const AHORA = new Date("2026-03-15T15:00:00Z"); // 12:00 en Argentina

console.log("--- Meses: fin de mes, bisiestos, cambio de anio ---");
comprobar("enero 2026 (31 dias)", resumen(parseRangoFechas({ mes: "2026-01" }, AHORA)), "2026-01-01T00:00:00.000Z → 2026-02-01T00:00:00.000Z | 2026-01-31");
comprobar("abril 2026 (30 dias)", resumen(parseRangoFechas({ mes: "2026-04" }, AHORA)), "2026-04-01T00:00:00.000Z → 2026-05-01T00:00:00.000Z | 2026-04-30");
comprobar("febrero 2024 bisiesto", resumen(parseRangoFechas({ mes: "2024-02" }, AHORA)), "2024-02-01T00:00:00.000Z → 2024-03-01T00:00:00.000Z | 2024-02-29");
comprobar("febrero 2028 bisiesto", resumen(parseRangoFechas({ mes: "2028-02" }, AHORA)), "2028-02-01T00:00:00.000Z → 2028-03-01T00:00:00.000Z | 2028-02-29");
comprobar("febrero 2026 no bisiesto", resumen(parseRangoFechas({ mes: "2026-02" }, AHORA)), "2026-02-01T00:00:00.000Z → 2026-03-01T00:00:00.000Z | 2026-02-28");
comprobar("febrero 2100 no bisiesto (siglo)", parseRangoFechas({ mes: "2100-02" }, AHORA).hastaISO, "2100-02-28");
comprobar("diciembre 2026 → enero 2027", resumen(parseRangoFechas({ mes: "2026-12" }, AHORA)), "2026-12-01T00:00:00.000Z → 2027-01-01T00:00:00.000Z | 2026-12-31");
comprobar("etiqueta mes", parseRangoFechas({ mes: "2026-09" }, AHORA).etiqueta, "Septiembre 2026");
const sep = parseRangoFechas({ mes: "2026-09" }, AHORA);
comprobar("tipo/anio/mes", [sep.tipo, sep.anio, sep.mes], ["mes", 2026, 9]);
comprobar("rangoDeMes directo", resumen(rangoDeMes(2026, 12)), "2026-12-01T00:00:00.000Z → 2027-01-01T00:00:00.000Z | 2026-12-31");
// Meses consecutivos encajan sin huecos ni solapes (hasta de uno = desde del siguiente).
let encajan = true;
for (let m = 1; m <= 12; m++) {
  const a = rangoDeMes(2026, m);
  const b = m === 12 ? rangoDeMes(2027, 1) : rangoDeMes(2026, m + 1);
  if (a.hasta.getTime() !== b.desde.getTime()) encajan = false;
}
comprobar("12 meses de 2026 encajan sin huecos", encajan, true);

console.log("");
console.log("--- Rango desde/hasta (hasta inclusivo en la URL) ---");
const r1 = parseRangoFechas({ desde: "2026-01-10", hasta: "2026-01-31" }, AHORA);
comprobar("10 al 31 ene", resumen(r1), "2026-01-10T00:00:00.000Z → 2026-02-01T00:00:00.000Z | 2026-01-31");
comprobar("etiqueta rango", r1.etiqueta, "10/01/2026 al 31/01/2026");
comprobar("tipo rango", r1.tipo, "rango");
comprobar("un solo dia", resumen(parseRangoFechas({ desde: "2026-04-30", hasta: "2026-04-30" }, AHORA)), "2026-04-30T00:00:00.000Z → 2026-05-01T00:00:00.000Z | 2026-04-30");
comprobar("etiqueta un dia", parseRangoFechas({ desde: "2026-04-30", hasta: "2026-04-30" }, AHORA).etiqueta, "30/04/2026");
comprobar("cruza el anio", resumen(parseRangoFechas({ desde: "2026-12-20", hasta: "2027-01-05" }, AHORA)), "2026-12-20T00:00:00.000Z → 2027-01-06T00:00:00.000Z | 2027-01-05");
comprobar("29 feb bisiesto valido", resumen(parseRangoFechas({ desde: "2024-02-29", hasta: "2024-02-29" }, AHORA)), "2024-02-29T00:00:00.000Z → 2024-03-01T00:00:00.000Z | 2024-02-29");
comprobar("rangoEntre invalido → null", rangoEntre("2026-02-30", "2026-03-01"), null);

console.log("");
console.log("--- desde > hasta: se intercambian y avisa ---");
const inv = parseRangoFechas({ desde: "2026-02-10", hasta: "2026-02-01" }, AHORA);
comprobar("intercambiado", resumen(inv), "2026-02-01T00:00:00.000Z → 2026-02-11T00:00:00.000Z | 2026-02-10");
comprobar("query tras intercambiar", inv.query, "desde=2026-02-01&hasta=2026-02-10");
comprobar("con aviso", inv.avisos.length, 1);
comprobar("sin aviso si estaban bien", parseRangoFechas({ desde: "2026-02-01", hasta: "2026-02-10" }, AHORA).avisos.length, 0);

console.log("");
console.log("--- Entradas invalidas → fallback al mes actual (marzo 2026) ---");
const MARZO = "2026-03-01T00:00:00.000Z → 2026-04-01T00:00:00.000Z | 2026-03-31";
const invalidas: [string, Record<string, string>][] = [
  ["sin parametros", {}],
  ["mes vacio", { mes: "" }],
  ["mes basura", { mes: "abc" }],
  ["mes 13", { mes: "2026-13" }],
  ["mes 00", { mes: "2026-00" }],
  ["mes sin cero (2026-3)", { mes: "2026-3" }],
  ["anio fuera de rango", { mes: "1999-05" }],
  ["mes legacy numerico", { mes: "3" }],
  ["desde sin hasta", { desde: "2026-01-01" }],
  ["hasta sin desde", { hasta: "2026-01-31" }],
  ["fecha imposible", { desde: "2026-02-30", hasta: "2026-03-05" }],
  ["fecha con formato dd/mm/aaaa", { desde: "01/01/2026", hasta: "31/01/2026" }],
];
for (const [nombre, params] of invalidas) {
  comprobar(nombre, resumen(parseRangoFechas(params, AHORA)), MARZO);
}
comprobar("sin parametros: porDefecto", parseRangoFechas({}, AHORA).porDefecto, true);
const basura = parseRangoFechas({ mes: "abc" }, AHORA);
comprobar("mes basura: porDefecto + aviso", [basura.porDefecto, basura.avisos.length], [true, 1]);
comprobar("mes valido: no es porDefecto", parseRangoFechas({ mes: "2026-01" }, AHORA).porDefecto, false);
comprobar("rango invalido pero mes valido → usa el mes", parseRangoFechas({ desde: "x", hasta: "y", mes: "2026-01" }, AHORA).etiqueta, "Enero 2026");
comprobar("rango valido gana sobre mes", parseRangoFechas({ desde: "2026-01-05", hasta: "2026-01-06", mes: "2026-02" }, AHORA).tipo, "rango");
comprobar("array (param repetido): toma el primero", parseRangoFechas({ mes: ["2026-01", "2026-02"] }, AHORA).etiqueta, "Enero 2026");
comprobar("espacios alrededor", parseRangoFechas({ mes: " 2026-01 " }, AHORA).etiqueta, "Enero 2026");

console.log("");
console.log("--- Mes actual con 'ahora' inyectado (hora Argentina) ---");
const mesDe = (iso: string) => parseRangoFechas({}, new Date(iso)).etiqueta;
comprobar("mediodia 15/03 ART", mesDe("2026-03-15T15:00:00Z"), "Marzo 2026");
comprobar("00:00 del 1/03 ART (= 03:00Z)", mesDe("2026-03-01T03:00:00Z"), "Marzo 2026");
comprobar("23:59 del 28/02 ART (= 02:59Z del 1/03)", mesDe("2026-03-01T02:59:00Z"), "Febrero 2026");

console.log("");
console.log("--- Borde horario: 23:30 ART del ultimo dia del mes ---");
// 23:30 ART del 31/01 = 02:30 UTC del 01/02. El mes sigue siendo enero.
const tarde = parseRangoFechas({}, new Date("2026-02-01T02:30:00Z"));
comprobar("23:30 ART 31/01 sigue siendo enero", tarde.etiqueta, "Enero 2026");
comprobar("rango de ese 'ahora'", resumen(tarde), "2026-01-01T00:00:00.000Z → 2026-02-01T00:00:00.000Z | 2026-01-31");
comprobar("el UTC ya es febrero (el bug que se evita)", new Date("2026-02-01T02:30:00Z").getUTCMonth() + 1, 2);
// Una venta del 31/01 se guarda como 2026-01-31T00:00:00Z y entra en enero, no en febrero.
const ventaFin = new Date("2026-01-31T00:00:00Z");
comprobar("venta 31/01 entra en enero", ventaFin >= tarde.desde && ventaFin < tarde.hasta, true);
const ventaSig = new Date("2026-02-01T00:00:00Z");
comprobar("venta 01/02 NO entra en enero (hasta exclusivo)", ventaSig >= tarde.desde && ventaSig < tarde.hasta, false);
// Mismo borde en cambio de anio: 23:30 ART del 31/12.
comprobar("23:30 ART 31/12 sigue siendo diciembre", mesDe("2027-01-01T02:30:00Z"), "Diciembre 2026");
comprobar("00:30 ART 01/01 ya es enero", mesDe("2027-01-01T03:30:00Z"), "Enero 2027");
// Bisiesto: 23:30 ART del 29/02/2028.
comprobar("23:30 ART 29/02/2028 sigue siendo febrero", mesDe("2028-03-01T02:30:00Z"), "Febrero 2028");

console.log("");
console.log("--- Serializacion a query string ---");
comprobar("mes", rangoAQuery(parseRangoFechas({ mes: "2026-01" }, AHORA)), "mes=2026-01");
comprobar("rango", rangoAQuery(parseRangoFechas({ desde: "2026-01-10", hasta: "2026-01-31" }, AHORA)), "desde=2026-01-10&hasta=2026-01-31");
comprobar("por defecto sale explicito", rangoAQuery(parseRangoFechas({}, AHORA)), "mes=2026-03");
comprobar("conRango", conRango("/ventas/export", parseRangoFechas({ mes: "2026-01" }, AHORA)), "/ventas/export?mes=2026-01");
comprobar("conRango con ? previo", conRango("/x?a=1", parseRangoFechas({ mes: "2026-01" }, AHORA)), "/x?a=1&mes=2026-01");
// Ida y vuelta: parsear lo serializado da el mismo rango.
const ida = (p: Record<string, string>) => {
  const r = parseRangoFechas(p, AHORA);
  const vuelta = parseRangoFechas(Object.fromEntries(new URLSearchParams(rangoAQuery(r))), AHORA);
  return resumen(r) === resumen(vuelta) && r.tipo === vuelta.tipo;
};
comprobar("ida y vuelta mes", ida({ mes: "2026-12" }), true);
comprobar("ida y vuelta rango", ida({ desde: "2026-12-20", hasta: "2027-01-05" }), true);
comprobar("ida y vuelta por defecto", ida({}), true);

console.log("");
if (fallos > 0) {
  console.error(`${fallos} verificacion(es) fallaron.`);
  process.exit(1);
}
console.log("Todo OK.");
