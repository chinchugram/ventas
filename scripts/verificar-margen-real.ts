/**
 * Verificacion del margen real contra numeros armados a mano (parte pura, sin base).
 *
 *   npm run test:margen-real
 */
import { construirCSV } from "../src/lib/csv";
import { d, type Dinero } from "../src/lib/money";
import {
  armarReporteMargenReal,
  comparar3,
  costoRealDeTrabajo,
  csvDe,
  csvPorArticulo,
  csvPorPeriodo,
  csvPorTrabajo,
  leerDetalleCsv,
  mayoresDesvios,
  pctONulo,
  textoPct,
  type TrabajoParaMargen,
} from "../src/lib/margen-real";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const texto = (v: { toString(): string } | null) => (v === null ? "null" : v.toString());

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

function trabajo(parcial: Partial<TrabajoParaMargen> & { id: string }): TrabajoParaMargen {
  return {
    fecha: dia("2026-10-05"),
    ventaId: `v-${parcial.id}`,
    ventaNumero: 1,
    ventaAnio: 2026,
    articuloId: "X",
    articuloNombre: "Articulo X",
    unidades: d(1),
    precioNeto: d(0),
    costoReceta: d(0),
    minutosManoObra: d(0),
    costoHoraManoObraSnapshot: d(0),
    consumos: [],
    tiempos: [],
    ...parcial,
  };
}

console.log("--- Costo real de un trabajo ---");
const real = costoRealDeTrabajo({
  consumos: [
    { cantidad: d("2"), costoUnitarioSnapshot: d("4200.50") }, // 8401,00
    { cantidad: d("0.5"), costoUnitarioSnapshot: d("1400") }, // 700,00
  ],
  tiempos: [
    { minutos: d("90"), costoHoraSnapshot: d("3000") }, // 4500,00
    { minutos: d("30"), costoHoraSnapshot: d("6000") }, // 3000,00
  ],
  minutosManoObra: d("45"),
  costoHoraManoObraSnapshot: d("4000"), // 3000,00
});
comprobar("materiales", texto(real.materiales), "9101");
comprobar("maquinas", texto(real.maquinas), "7500");
comprobar("mano de obra", texto(real.manoObra), "3000");
comprobar("total", texto(real.total), "19601");

const vacio = costoRealDeTrabajo({ consumos: [], tiempos: [], minutosManoObra: d(0), costoHoraManoObraSnapshot: d(0) });
comprobar("trabajo sin nada: costo 0", texto(vacio.total), "0");

const redondeo = costoRealDeTrabajo({
  consumos: [{ cantidad: d("0.333"), costoUnitarioSnapshot: d("15.0075") }], // 4,99749975 -> 5,00
  tiempos: [{ minutos: d("7"), costoHoraSnapshot: d("100") }], // 11,6667 -> 11,67
  minutosManoObra: d("10"),
  costoHoraManoObraSnapshot: d("100"), // 16,6667 -> 16,67
});
comprobar("cada componente a centavos", [redondeo.materiales, redondeo.maquinas, redondeo.manoObra].map(texto).join(","), "5,11.67,16.67");
comprobar("el total es la suma de los componentes ya redondeados", texto(redondeo.total), "33.34");

const soloMinutos = costoRealDeTrabajo({ consumos: [], tiempos: [], minutosManoObra: d("30"), costoHoraManoObraSnapshot: d("4137.61") });
comprobar("30 min a 4137,61 la hora", texto(soloMinutos.total), "2068.81");

console.log("--- Desvio y margenes de un renglon ---");
const c = comparar3(d(30000), d(18000), d(19601));
comprobar("desvio $", texto(c.desvio), "1601");
comprobar("desvio %", texto(c.desvioPct), "8.89");
comprobar("ganancia estimada", texto(c.gananciaEstimada), "12000");
comprobar("ganancia real", texto(c.gananciaReal), "10399");
comprobar("margen estimado %", texto(c.margenEstimadoPct), "40");
comprobar("margen real %", texto(c.margenRealPct), "34.66");
comprobar("diferencia de margen (puntos)", texto(c.margenDifPuntos), "-5.34");

const ahorro = comparar3(d(10000), d(6000), d(5000));
comprobar("ahorro: desvio negativo", texto(ahorro.desvio), "-1000");
comprobar("ahorro: desvio % negativo", texto(ahorro.desvioPct), "-16.67");
comprobar("ahorro: margen real mayor", texto(ahorro.margenRealPct), "50");

const recetaCero = comparar3(d(5000), d(0), d(1000));
comprobar("receta 0: desvio $ se calcula", texto(recetaCero.desvio), "1000");
comprobar("receta 0: desvio % es null (no Infinity)", texto(recetaCero.desvioPct), "null");
comprobar("receta 0: margenes se calculan igual", [recetaCero.margenEstimadoPct, recetaCero.margenRealPct].map(texto).join(","), "100,80");

const precioCero = comparar3(d(0), d(100), d(150));
comprobar("precio 0: margen estimado null", texto(precioCero.margenEstimadoPct), "null");
comprobar("precio 0: margen real null", texto(precioCero.margenRealPct), "null");
comprobar("precio 0: diferencia de margen null", texto(precioCero.margenDifPuntos), "null");
comprobar("precio 0: el desvio igual se ve", `${texto(precioCero.desvio)} ${texto(precioCero.desvioPct)}`, "50 50");

const todoCero = comparar3(d(0), d(0), d(0));
comprobar("todo en 0: nada es NaN ni Infinity", [todoCero.desvio, todoCero.desvioPct, todoCero.margenEstimadoPct, todoCero.margenRealPct, todoCero.margenDifPuntos].map(texto).join(","), "0,null,null,null,null");
comprobar("margen real negativo (se vende a perdida)", texto(comparar3(d(100), d(80), d(130)).margenRealPct), "-30");

comprobar("pctONulo con denominador 0", texto(pctONulo(d(5), d(0))), "null");
comprobar("pctONulo normal", texto(pctONulo(d(1), d(3))), "33.33");
comprobar("textoPct null -> raya", textoPct(null, (v: Dinero) => `${v}%`), "—");
comprobar("textoPct con signo", textoPct(d("2.5"), (v: Dinero) => `${v}%`, true), "+2.5%");
comprobar("textoPct negativo conserva su signo", textoPct(d("-2.5"), (v: Dinero) => `${v}%`, true), "-2.5%");

console.log("--- Reporte: por articulo, por periodo y total ---");
const A = trabajo({
  id: "A",
  fecha: dia("2026-10-05"),
  ventaNumero: 10,
  unidades: d(10),
  precioNeto: d(30000),
  costoReceta: d(18000),
  consumos: [
    { cantidad: d("2"), costoUnitarioSnapshot: d("4200.50") },
    { cantidad: d("0.5"), costoUnitarioSnapshot: d("1400") },
  ],
  tiempos: [
    { minutos: d("90"), costoHoraSnapshot: d("3000") },
    { minutos: d("30"), costoHoraSnapshot: d("6000") },
  ],
  minutosManoObra: d("45"),
  costoHoraManoObraSnapshot: d("4000"),
});
const B = trabajo({
  id: "B",
  fecha: dia("2026-10-20"),
  ventaNumero: 11,
  unidades: d(5),
  precioNeto: d(10000),
  costoReceta: d(6000),
  consumos: [{ cantidad: d(1), costoUnitarioSnapshot: d(5000) }],
});
const C = trabajo({
  id: "C",
  fecha: dia("2026-11-02"),
  ventaNumero: 12,
  articuloId: "Y",
  articuloNombre: "Articulo Y",
  unidades: d(2),
  precioNeto: d(5000),
  costoReceta: d(0),
  consumos: [{ cantidad: d(1), costoUnitarioSnapshot: d(1000) }],
});
// Se pasan desordenados: el reporte los ordena.
const r = armarReporteMargenReal([C, A, B]);

comprobar("trabajos", String(r.total.trabajos), "3");
comprobar("total: precio, receta, real", [r.total.precioNeto, r.total.costoReceta, r.total.costoReal].map(texto).join(","), "45000,24000,25601");
comprobar("total: desvio $ y %", `${texto(r.total.desvio)} ${texto(r.total.desvioPct)}`, "1601 6.67");
comprobar("total: margenes sobre las sumas (no promedio de %)", [r.total.margenEstimadoPct, r.total.margenRealPct, r.total.margenDifPuntos].map(texto).join(","), "46.67,43.11,-3.56");
comprobar("total: unidades", texto(r.total.unidades), "17");
comprobar("lineas cronologicas", r.lineas.map((l) => l.id).join(","), "A,B,C");
comprobar("porArticulo: mayor sobrecosto primero", r.porArticulo.map((f) => f.articuloId).join(","), "Y,X");
const fx = r.porArticulo.find((f) => f.articuloId === "X")!;
comprobar("articulo X: trabajos y unidades", `${fx.trabajos} ${texto(fx.unidades)}`, "2 15");
comprobar("articulo X: precio, receta, real", [fx.precioNeto, fx.costoReceta, fx.costoReal].map(texto).join(","), "40000,24000,24601");
comprobar("articulo X: desvio $ y %", `${texto(fx.desvio)} ${texto(fx.desvioPct)}`, "601 2.5");
comprobar("articulo X: margenes", [fx.margenEstimadoPct, fx.margenRealPct].map(texto).join(","), "40,38.5");
const fy = r.porArticulo.find((f) => f.articuloId === "Y")!;
comprobar("articulo Y (receta 0): desvio % null", texto(fy.desvioPct), "null");
comprobar("porPeriodo: un mes por fila", r.porPeriodo.map((f) => f.mes).join(","), "2026-10,2026-11");
comprobar("porPeriodo: etiquetas", r.porPeriodo.map((f) => f.etiqueta).join(","), "Octubre 2026,Noviembre 2026");
comprobar("octubre: trabajos y desvio", `${r.porPeriodo[0]!.trabajos} ${texto(r.porPeriodo[0]!.desvio)}`, "2 601");
comprobar("noviembre: trabajos y desvio", `${r.porPeriodo[1]!.trabajos} ${texto(r.porPeriodo[1]!.desvio)}`, "1 1000");
comprobar("la suma de los periodos es el total", texto(r.porPeriodo.reduce((a, f) => a.plus(f.desvio), d(0))), texto(r.total.desvio));
comprobar("la suma de los articulos es el total", texto(r.porArticulo.reduce((a, f) => a.plus(f.costoReal), d(0))), texto(r.total.costoReal));
comprobar("mayoresDesvios(2)", mayoresDesvios(r.lineas, 2).map((l) => l.id).join(","), "A,C");
comprobar("mayoresDesvios(0)", String(mayoresDesvios(r.lineas, 0).length), "0");
comprobar("mayoresDesvios no altera el orden original", r.lineas.map((l) => l.id).join(","), "A,B,C");

console.log("--- Sin trabajos ---");
const nada = armarReporteMargenReal([]);
comprobar("0 trabajos", String(nada.total.trabajos), "0");
comprobar("todo en 0 y sin porcentajes", [nada.total.precioNeto, nada.total.costoReal, nada.total.desvio].map(texto).join(","), "0,0,0");
comprobar("sin desvio % ni margenes (null, no NaN)", [nada.total.desvioPct, nada.total.margenRealPct, nada.total.margenEstimadoPct].map(texto).join(","), "null,null,null");
comprobar("sin articulos ni periodos ni lineas", `${nada.porArticulo.length}${nada.porPeriodo.length}${nada.lineas.length}`, "000");

console.log("--- Nunca NaN ni Infinity, ni en un caso feo ---");
const feo = armarReporteMargenReal([trabajo({ id: "Z" }), trabajo({ id: "W", precioNeto: d(100), costoReceta: d(0), consumos: [{ cantidad: d(0), costoUnitarioSnapshot: d(0) }] })]);
const todosLosTextos = JSON.stringify([feo, csvPorArticulo(feo), csvPorPeriodo(feo), csvPorTrabajo(feo)], (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? "NUMERO-NO-FINITO" : v));
comprobar("no aparece Infinity ni NaN", String(/Infinity|NaN|NUMERO-NO-FINITO/.test(todosLosTextos)), "false");

console.log("--- CSV ---");
const csvArt = construirCSV(csvPorArticulo(r).encabezados, csvPorArticulo(r).filas).replace(/^﻿/, "").split("\r\n");
comprobar(
  "encabezado por articulo",
  csvArt[0]!,
  "Artículo;Trabajos;Unidades;Precio neto;Costo receta;Costo real;Desvío $;Desvío %;Margen estimado %;Margen real %;Diferencia de margen (puntos)",
);
comprobar("fila del articulo Y (receta 0: desvio % vacio)", csvArt[1]!, "Articulo Y;1;2,000;5000,00;0,00;1000,00;1000,00;;100,00;80,00;-20,00");
comprobar("fila del articulo X", csvArt[2]!, "Articulo X;2;15,000;40000,00;24000,00;24601,00;601,00;2,50;40,00;38,50;-1,50");
comprobar("fila Total", csvArt[3]!, "Total;3;17,000;45000,00;24000,00;25601,00;1601,00;6,67;46,67;43,11;-3,56");
comprobar("termina en salto de linea (ultima linea vacia)", csvArt[4]!, "");

const csvPer = construirCSV(csvPorPeriodo(r).encabezados, csvPorPeriodo(r).filas).replace(/^﻿/, "").split("\r\n");
comprobar("periodos: primera fila", csvPer[1]!, "2026-10;2;15,000;40000,00;24000,00;24601,00;601,00;2,50;40,00;38,50;-1,50");
comprobar("periodos: cantidad de lineas (encabezado + 2 + total + vacia)", String(csvPer.length), "5");

const csvTra = construirCSV(csvPorTrabajo(r).encabezados, csvPorTrabajo(r).filas).replace(/^﻿/, "").split("\r\n");
comprobar(
  "trabajos: encabezado con el desglose",
  csvTra[0]!,
  "Fecha;Venta;Artículo;Unidades;Materiales;Máquinas;Mano de obra;Precio neto;Costo receta;Costo real;Desvío $;Desvío %;Margen estimado %;Margen real %;Diferencia de margen (puntos)",
);
comprobar("trabajos: fila de A", csvTra[1]!, "05/10/2026;10/2026;Articulo X;10,000;9101,00;7500,00;3000,00;30000,00;18000,00;19601,00;1601,00;8,89;40,00;34,66;-5,34");
comprobar("trabajos: sin fila de total", String(csvTra.length), "5");

const csvNada = csvPorArticulo(nada);
comprobar("sin trabajos: el CSV es solo el encabezado", String(csvNada.filas.length), "0");
comprobar("csvDe elige por detalle", String(csvDe("periodos", r).encabezados[0]), "Mes");

const inyeccion = armarReporteMargenReal([trabajo({ id: "I", articuloNombre: '=HYPERLINK("x");y', precioNeto: d(10), costoReceta: d(5) })]);
const csvIny = construirCSV(csvPorArticulo(inyeccion).encabezados, csvPorArticulo(inyeccion).filas).split("\r\n")[1]!;
comprobar("un nombre que empieza con = no se ejecuta como formula", csvIny.startsWith("\"'=HYPERLINK(\"\"x\"\");y\";") ? "neutralizado" : csvIny, "neutralizado");

console.log("--- ?detalle= ---");
comprobar("vacio -> articulos", String(leerDetalleCsv("")), "articulos");
comprobar("ausente -> articulos", String(leerDetalleCsv(null)), "articulos");
comprobar("periodos", String(leerDetalleCsv("periodos")), "periodos");
comprobar("trabajos", String(leerDetalleCsv("trabajos")), "trabajos");
comprobar("desconocido -> null", String(leerDetalleCsv("todo")), "null");
comprobar("no confunde propiedades heredadas", String(leerDetalleCsv("constructor")), "null");

console.log("");
if (fallos > 0) {
  console.log(`${fallos} comprobacion(es) fallaron.`);
  process.exit(1);
}
console.log("Todas las comprobaciones pasaron.");
