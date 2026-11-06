/**
 * Verificacion de los reportes de stock contra numeros armados a mano
 * (parte pura, sin base).
 *
 *   npx tsx scripts/verificar-stock-reporte.ts
 */
import {
  calcularRotacion,
  diasDelPeriodo,
  sinMovimiento,
  valorDeStock,
  valorizarStock,
} from "../src/lib/stock-reporte";
import { d } from "../src/lib/money";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const texto = (v: { toString(): string } | null) => (v === null ? "null" : v.toString());

function lanza(f: () => unknown): string {
  try {
    f();
    return "no lanza";
  } catch {
    return "lanza";
  }
}

console.log("--- Valor del stock: cantidad × costo ---");
comprobar("38 × 4.200", texto(valorDeStock(d("38"), d("4200"))), "159600");
comprobar("2,4 × 24.000", texto(valorDeStock(d("2.4"), d("24000"))), "57600");
comprobar("stock 0", texto(valorDeStock(d("0"), d("3200"))), "0");
comprobar("redondea a centavos (0,333 × 15,0075)", texto(valorDeStock(d("0.333"), d("15.0075"))), "5");
comprobar("medio centavo sube (1 × 0,005)", texto(valorDeStock(d("1"), d("0.005"))), "0.01");

console.log("--- Valorizacion (materiales de ejemplo) ---");
const v = valorizarStock([
  { id: "m1", nombre: "Vinil adhesivo brillante", stockActual: d("38"), costoUnitario: d("4200") },
  { id: "m2", nombre: "Transportador", stockActual: d("6"), costoUnitario: d("1400") },
  { id: "m3", nombre: "MDF 3mm", stockActual: d("14"), costoUnitario: d("8500") },
  { id: "m4", nombre: "Acrilico opalino 3mm", stockActual: d("2.4"), costoUnitario: d("24000") },
  { id: "m5", nombre: "Cinta doble faz", stockActual: d("0"), costoUnitario: d("3200") },
]);
comprobar("total", texto(v.total), "344600");
comprobar("orden por valor", v.lineas.map((l) => l.id).join(","), "m1,m3,m4,m2,m5");
comprobar("valores", v.lineas.map((l) => texto(l.valor)).join(","), "159600,119000,57600,8400,0");
comprobar("participacion %", v.lineas.map((l) => texto(l.participacion)).join(","), "46.31,34.53,16.72,2.44,0");
comprobar("sin materiales: total 0", texto(valorizarStock([]).total), "0");
comprobar(
  "todo en 0: participacion 0 (no NaN)",
  texto(valorizarStock([{ id: "x", nombre: "X", stockActual: d(0), costoUnitario: d(10) }]).lineas[0]!.participacion),
  "0",
);

console.log("--- Dias del periodo ---");
comprobar("octubre [1/10, 31/10)", texto(diasDelPeriodo(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T00:00:00Z"))), "30");
comprobar("12 horas", texto(diasDelPeriodo(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T12:00:00Z"))), "0.5");
comprobar("hasta = desde falla", lanza(() => diasDelPeriodo(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"))), "lanza");
comprobar("hasta < desde falla", lanza(() => diasDelPeriodo(new Date("2026-10-02T00:00:00Z"), new Date("2026-10-01T00:00:00Z"))), "lanza");

console.log("--- Rotacion en 30 dias ---");
const r = calcularRotacion(
  [
    // vendio 12 de 50 a 38: promedio 44
    { id: "m1", nombre: "Vinil", costoUnitario: d("4200"), stockInicial: d("50"), stockFinal: d("38"), consumo: d("12") },
    // empezo con 6, compro 10 y vendio 10: termina en 6
    { id: "m2", nombre: "Transportador", costoUnitario: d("1400"), stockInicial: d("6"), stockFinal: d("6"), consumo: d("10") },
    // hay stock y no salio nada
    { id: "m3", nombre: "MDF", costoUnitario: d("8500"), stockInicial: d("14"), stockFinal: d("14"), consumo: d("0") },
    { id: "m4", nombre: "Acrilico", costoUnitario: d("24000"), stockInicial: d("4.4"), stockFinal: d("2.4"), consumo: d("2") },
    // sin stock y sin consumo
    { id: "m5", nombre: "Cinta", costoUnitario: d("3200"), stockInicial: d("0"), stockFinal: d("0"), consumo: d("0") },
    // entro y salio dentro del periodo: promedio 0
    { id: "m6", nombre: "Sobrante", costoUnitario: d("100"), stockInicial: d("0"), stockFinal: d("0"), consumo: d("3") },
    // anulacion de una venta anterior: consumo neto negativo
    { id: "m7", nombre: "Anulado", costoUnitario: d("10"), stockInicial: d("5"), stockFinal: d("7"), consumo: d("-2") },
  ],
  diasDelPeriodo(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T00:00:00Z")),
);
const por = Object.fromEntries(r.lineas.map((l) => [l.id, l]));
comprobar("orden por consumo valorizado", r.lineas.map((l) => l.id).join(","), "m1,m4,m2,m6,m7,m5,m3");
comprobar("vinil: stock promedio", texto(por.m1!.stockPromedio), "44");
comprobar("vinil: rotacion 12/44", texto(por.m1!.rotacion), "0.27");
comprobar("vinil: consumo diario 12/30", texto(por.m1!.consumoDiario), "0.4");
comprobar("vinil: cobertura 38×30/12", texto(por.m1!.coberturaDias), "95");
comprobar("vinil: estado", por.m1!.estado, "CALCULADA");
comprobar("transportador: rotacion 10/6", texto(por.m2!.rotacion), "1.67");
comprobar("transportador: cobertura 6×30/10", texto(por.m2!.coberturaDias), "18");
comprobar("acrilico: promedio 3,4", texto(por.m4!.stockPromedio), "3.4");
comprobar("acrilico: rotacion 2/3,4", texto(por.m4!.rotacion), "0.59");
comprobar("acrilico: cobertura 2,4×30/2", texto(por.m4!.coberturaDias), "36");
comprobar("MDF sin consumo: rotacion 0 (hubo stock)", texto(por.m3!.rotacion), "0");
comprobar("MDF sin consumo: cobertura null (no infinita)", texto(por.m3!.coberturaDias), "null");
comprobar("MDF sin consumo: estado", por.m3!.estado, "SIN_CONSUMO");
comprobar("cinta sin stock ni consumo: rotacion null", texto(por.m5!.rotacion), "null");
comprobar("cinta sin stock ni consumo: cobertura null", texto(por.m5!.coberturaDias), "null");
comprobar("cinta sin stock ni consumo: estado", por.m5!.estado, "SIN_ACTIVIDAD");
comprobar("sobrante (promedio 0, salio 3): rotacion null", texto(por.m6!.rotacion), "null");
comprobar("sobrante: cobertura 0 dias (no queda nada)", texto(por.m6!.coberturaDias), "0");
comprobar("sobrante: estado", por.m6!.estado, "SIN_STOCK");
comprobar("consumo negativo se toma como 0", texto(por.m7!.consumoPeriodo), "0");
comprobar("consumo negativo: estado", por.m7!.estado, "SIN_CONSUMO");
comprobar("consumo negativo: rotacion 0", texto(por.m7!.rotacion), "0");
comprobar("valor del consumo del vinil", texto(por.m1!.valorConsumo), "50400");

console.log("--- Rotacion global (en pesos) ---");
comprobar("valor inicial", texto(r.resumen.valorInicial), "443050");
comprobar("valor final", texto(r.resumen.valorFinal), "344670");
comprobar("valor del consumo", texto(r.resumen.valorConsumo), "112700");
comprobar("valor promedio", texto(r.resumen.valorPromedio), "393860");
comprobar("rotacion global 112700/393860", texto(r.resumen.rotacionGlobal), "0.29");
comprobar("cobertura global 344670×30/112700", texto(r.resumen.coberturaGlobalDias), "91.7");
const sinNada = calcularRotacion(
  [{ id: "z", nombre: "Z", costoUnitario: d("10"), stockInicial: d(0), stockFinal: d(0), consumo: d(0) }],
  d(30),
).resumen;
comprobar("todo en cero: rotacion global null", texto(sinNada.rotacionGlobal), "null");
comprobar("todo en cero: cobertura global null", texto(sinNada.coberturaGlobalDias), "null");
comprobar("dias 0 falla", lanza(() => calcularRotacion([], d(0))), "lanza");

console.log("--- Sin movimiento (ahora = 29/10/2026 12:00 UTC) ---");
const ahora = new Date("2026-10-29T12:00:00Z");
const materiales = [
  { id: "m1", nombre: "Vinil", stockActual: d("38"), costoUnitario: d("4200"), ultimoMovimiento: new Date("2026-10-25T10:00:00Z"), creadoEn: new Date("2026-01-01T00:00:00Z") },
  { id: "m2", nombre: "Transportador", stockActual: d("6"), costoUnitario: d("1400"), ultimoMovimiento: new Date("2026-09-29T12:00:00Z"), creadoEn: new Date("2026-01-01T00:00:00Z") },
  { id: "m3", nombre: "MDF", stockActual: d("14"), costoUnitario: d("8500"), ultimoMovimiento: new Date("2026-07-31T00:00:00Z"), creadoEn: new Date("2026-01-01T00:00:00Z") },
  { id: "m4", nombre: "Acrilico", stockActual: d("2.4"), costoUnitario: d("24000"), ultimoMovimiento: new Date("2026-09-28T12:00:00Z"), creadoEn: new Date("2026-01-01T00:00:00Z") },
  { id: "m5", nombre: "Cinta", stockActual: d("0"), costoUnitario: d("3200"), ultimoMovimiento: new Date("2026-05-01T00:00:00Z"), creadoEn: new Date("2026-01-01T00:00:00Z") },
  { id: "m7", nombre: "Nunca se movio", stockActual: d("5"), costoUnitario: d("100"), ultimoMovimiento: null, creadoEn: new Date("2026-08-30T12:00:00Z") },
];
const s = sinMovimiento(materiales, 30, ahora);
comprobar("materiales (orden por valor inmovilizado)", s.lineas.map((l) => l.id).join(","), "m3,m4,m2,m7");
comprobar("dias sin movimiento", s.lineas.map((l) => l.diasSinMovimiento).join(","), "90,31,30,60");
comprobar("valor inmovilizado", s.lineas.map((l) => texto(l.valorInmovilizado)).join(","), "119000,57600,8400,500");
comprobar("total inmovilizado", texto(s.totalInmovilizado), "185500");
comprobar("el que nunca se movio cuenta desde el alta", String(s.lineas[3]!.nuncaSeMovio), "true");
comprobar("el vinil (4 dias) no entra", String(s.lineas.some((l) => l.id === "m1")), "false");
comprobar("justo 30 dias entra (>=)", String(s.lineas.some((l) => l.id === "m2")), "true");
comprobar("sin stock se omite", String(s.lineas.some((l) => l.id === "m5")), "false");
const conCero = sinMovimiento(materiales, 30, ahora, { incluirSinStock: true });
comprobar("incluirSinStock suma la cinta con valor 0", conCero.lineas.map((l) => `${l.id}:${l.valorInmovilizado}`).join(","), "m3:119000,m4:57600,m2:8400,m7:500,m5:0");
comprobar("total no cambia con la cinta", texto(conCero.totalInmovilizado), "185500");
comprobar("umbral 60: m3 y m7", sinMovimiento(materiales, 60, ahora).lineas.map((l) => l.id).join(","), "m3,m7");
comprobar("umbral 91: nadie", String(sinMovimiento(materiales, 91, ahora).lineas.length), "0");
comprobar("umbral 0: todos los que tienen stock", String(sinMovimiento(materiales, 0, ahora).lineas.length), "5");
comprobar("movimiento futuro (reloj corrido): 0 dias, no negativo", String(sinMovimiento([{ ...materiales[0]!, ultimoMovimiento: new Date("2026-11-01T00:00:00Z") }], 0, ahora).lineas[0]!.diasSinMovimiento), "0");
comprobar("dias negativos falla", lanza(() => sinMovimiento(materiales, -1, ahora)), "lanza");
comprobar("dias fraccionarios falla", lanza(() => sinMovimiento(materiales, 1.5, ahora)), "lanza");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
