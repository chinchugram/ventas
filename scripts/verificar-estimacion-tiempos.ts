/**
 * Verificacion de la logica pura de la estimacion de tiempos (ola 6, 6.3): mediana
 * (impar, par, un solo valor), normalizacion por unidad, ultimos N, minimo de
 * muestras ("sin datos suficientes", nunca un numero inventado), rango, maquinas,
 * total del pedido (completo y parcial), validacion de entradas y formato h:mm.
 * No usa base.
 *
 *   npx tsx scripts/verificar-estimacion-tiempos.ts
 */
import { d, type Dinero } from "../src/lib/money";
import { ErrorDeNegocio } from "../src/lib/acciones";
import {
  MIN_MUESTRAS,
  N_TRABAJOS_MUESTRA,
  estimarLinea,
  fmtHorasMinutos,
  fmtMinutos,
  mediana,
  totalizarPedido,
  validarPedido,
  type Estimacion,
  type TrabajoHistorico,
} from "../src/lib/estimacion-tiempos";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const num = (v: Dinero) => v.toDecimalPlaces(6).toString();

/** Estimacion suficiente → sus numeros; insuficiente → "sin datos (n)". */
function resumen(e: Estimacion): string {
  return e.suficiente ? `${num(e.minutos)} [${num(e.minutosMin)}–${num(e.minutosMax)}] n=${e.muestras}` : `sin datos (${e.muestras})`;
}

const M1 = { id: "m1", nombre: "Láser CO2" };
const M2 = { id: "m2", nombre: "Plotter de corte" };

function trabajo(cantidad: number | string, manoObra: number | string, tiempos: [typeof M1, number | string][] = []): TrabajoHistorico {
  return {
    cantidad: d(cantidad),
    minutosManoObra: d(manoObra),
    tiempos: tiempos.map(([m, minutos]) => ({ maquinaId: m.id, maquinaNombre: m.nombre, minutos: d(minutos) })),
  };
}

const entrada = (cantidad: number | string, nombre = "Articulo") => ({ articuloId: "a1", nombre, cantidad: d(cantidad) });

console.log("--- Constantes por defecto ---");
comprobar("N de trabajos", String(N_TRABAJOS_MUESTRA), "10");
comprobar("minimo de muestras", String(MIN_MUESTRAS), "3");

console.log("--- Mediana ---");
comprobar("impar", mediana([d(5), d(1), d(3)]).toString(), "3");
comprobar("par: promedio de los dos centrales", mediana([d(1), d(2), d(10), d(4)]).toString(), "3");
comprobar("un solo valor", mediana([d(7.5)]).toString(), "7.5");
comprobar("repetidos", mediana([d(2), d(2), d(2), d(9)]).toString(), "2");
comprobar("decimales exactos (sin error de coma flotante)", mediana([d("0.1"), d("0.2")]).toString(), "0.15");
comprobar("no altera la lista original", (() => { const l = [d(3), d(1), d(2)]; mediana(l); return l.map(String).join(","); })(), "3,1,2");
comprobar("lista vacia lanza", (() => { try { mediana([]); return "no lanzo"; } catch { return "lanzo"; } })(), "lanzo");

console.log("--- Normalizacion por unidad ---");
{
  // 10 piezas en 100 min, 5 piezas en 60 min, 2 piezas en 30 min: 10, 12, 15 min por unidad.
  const h = [trabajo(10, 100), trabajo(5, 60), trabajo(2, 30)];
  const l = estimarLinea(entrada(4), h);
  comprobar("mano de obra: mediana por unidad", l.manoObra.suficiente ? num(l.manoObra.minutosPorUnidad) : "-", "12");
  comprobar("mano de obra para 4 unidades", resumen(l.manoObra), "48 [40–60] n=3");
  comprobar("cantidad decimal (2,5 m2)", resumen(estimarLinea(entrada("2.5"), h).manoObra), "30 [25–37.5] n=3");
}

console.log("--- Minimo de muestras: sin datos suficientes, nunca un numero inventado ---");
{
  const sin = estimarLinea(entrada(3), []);
  comprobar("sin historial: mano de obra", resumen(sin.manoObra), "sin datos (0)");
  comprobar("sin historial: maquinas (total)", resumen(sin.maquinaTotal), "sin datos (0)");
  comprobar("sin historial: no lista maquinas", String(sin.maquinas.length), "0");
  const dos = estimarLinea(entrada(3), [trabajo(1, 10, [[M1, 5]]), trabajo(1, 20, [[M1, 5]])]);
  comprobar("2 muestras (< 3): mano de obra", resumen(dos.manoObra), "sin datos (2)");
  comprobar("2 muestras (< 3): maquinas (total)", resumen(dos.maquinaTotal), "sin datos (2)");
  comprobar("2 muestras: trabajos reportados", String(dos.trabajos), "2");
  comprobar("2 muestras: sin maquinas desglosadas", String(dos.maquinas.length), "0");
  if (!dos.manoObra.suficiente) comprobar("pide al menos 3", String(dos.manoObra.minimoRequerido), "3");
  const tres = estimarLinea(entrada(1), [trabajo(1, 10), trabajo(1, 20), trabajo(1, 30)]);
  comprobar("3 muestras (= minimo): ya estima", resumen(tres.manoObra), "20 [10–30] n=3");
  const minimo5 = estimarLinea(entrada(1), [trabajo(1, 10), trabajo(1, 20), trabajo(1, 30), trabajo(1, 40)], { minMuestras: 5 });
  comprobar("minimo configurable (5) con 4 muestras", resumen(minimo5.manoObra), "sin datos (4)");
  comprobar("un trabajo con 0 min de mano de obra es una muestra valida (0)", resumen(estimarLinea(entrada(1), [trabajo(1, 0), trabajo(1, 0), trabajo(1, 0)]).manoObra), "0 [0–0] n=3");
}

console.log("--- Ultimos N trabajos (del mas reciente al mas viejo) ---");
{
  // 12 trabajos: los dos MAS VIEJOS (al final) valen 1000; los 10 recientes valen 1..10.
  const h = [...Array.from({ length: 10 }, (_, i) => trabajo(1, i + 1)), trabajo(1, 1000), trabajo(1, 1000)];
  const l = estimarLinea(entrada(1), h);
  comprobar("toma solo los 10 mas recientes", String(l.trabajos), "10");
  comprobar("mediana de 1..10 (par) = 5,5; rango 1–10", resumen(l.manoObra), "5.5 [1–10] n=10");
  const n3 = estimarLinea(entrada(1), h, { n: 3 });
  comprobar("N configurable (3): usa 1,2,3", resumen(n3.manoObra), "2 [1–3] n=3");
  const con0 = estimarLinea(entrada(1), [trabajo(0, 99), trabajo(1, 10), trabajo(1, 20), trabajo(1, 30)], { n: 3 });
  comprobar("un trabajo con cantidad 0 se ignora y no ocupa lugar de N", resumen(con0.manoObra), "20 [10–30] n=3");
}

console.log("--- Maquinas ---");
{
  const h = [
    trabajo(2, 20, [[M1, 20], [M2, 10]]), // por unidad: M1 10, M2 5, total 15
    trabajo(1, 10, [[M1, 12], [M2, 6]]), //  M1 12, M2 6, total 18
    trabajo(1, 10, [[M1, 14]]), //          M1 14,       total 14 (no uso M2)
    trabajo(4, 40, [[M1, 40]]), //          M1 10,       total 10 (no uso M2)
    trabajo(1, 5), //                       sin maquinas: total 0
  ];
  const l = estimarLinea(entrada(2), h);
  comprobar("total de maquinas: mediana de la suma por trabajo (0,10,14,15,18 → 14) × 2", resumen(l.maquinaTotal), "28 [0–36] n=5");
  comprobar("maquinas desglosadas, ordenadas por nombre", l.maquinas.map((m) => m.maquinaNombre).join(" | "), "Láser CO2 | Plotter de corte");
  const m1 = l.maquinas.find((m) => m.maquinaId === "m1")!;
  const m2 = l.maquinas.find((m) => m.maquinaId === "m2")!;
  comprobar("M1 (4 trabajos 10,12,14,10 → 11) × 2", resumen(m1), "22 [20–28] n=4");
  comprobar("M2 (solo 2 trabajos la usaron): sin datos suficientes", resumen(m2), "sin datos (2)");
  const sumaMedianas = l.maquinas.reduce((a, m) => (m.suficiente ? a.plus(m.minutos) : a), d(0));
  comprobar("suma de medianas por maquina != mediana del total (por eso se calculan aparte)", `${num(sumaMedianas)} vs ${l.maquinaTotal.suficiente ? num(l.maquinaTotal.minutos) : "-"}`, "22 vs 28");
}

console.log("--- Entradas invalidas en la estimacion ---");
for (const [etiqueta, cantidad] of [["cantidad 0", "0"], ["cantidad negativa", "-2"]] as const) {
  try {
    estimarLinea(entrada(cantidad), []);
    comprobar(etiqueta, "no lanzó", "ErrorDeNegocio");
  } catch (error) {
    comprobar(etiqueta, error instanceof ErrorDeNegocio ? error.message : String(error), "La cantidad tiene que ser mayor a 0.");
  }
}
comprobar("N invalido lanza", (() => { try { estimarLinea(entrada(1), [], { n: 0 }); return "no lanzo"; } catch { return "lanzo"; } })(), "lanzo");

console.log("--- Total del pedido ---");
{
  const hA = [trabajo(1, 10, [[M1, 20]]), trabajo(1, 20, [[M1, 30]]), trabajo(1, 30, [[M1, 40]])]; // A: MO 20, M1 30
  const hB = [trabajo(1, 5, [[M1, 10], [M2, 4]]), trabajo(1, 5, [[M1, 10], [M2, 6]]), trabajo(1, 5, [[M1, 10], [M2, 8]])]; // B: MO 5, M1 10, M2 6
  const a = estimarLinea({ articuloId: "a", nombre: "A", cantidad: d(2) }, hA);
  const b = estimarLinea({ articuloId: "b", nombre: "B", cantidad: d(3) }, hB);
  const vacio = estimarLinea({ articuloId: "c", nombre: "C", cantidad: d(1) }, [trabajo(1, 1)]);

  const completo = totalizarPedido([a, b]);
  comprobar("completo: lineas con datos", String(completo.lineasConDatos), "2");
  comprobar("completo: es completo", String(completo.completo), "true");
  comprobar("completo: maquinas (30×2 + 16×3 = 108)", completo.maquinaTotal ? num(completo.maquinaTotal.minutos) : "null", "108");
  comprobar("completo: mano de obra (20×2 + 5×3 = 55)", completo.manoObra ? num(completo.manoObra.minutos) : "null", "55");
  comprobar("completo: rango de maquinas (A 20×2..40×2 + B 14×3..18×3 = 82–134)", completo.maquinaTotal ? `${num(completo.maquinaTotal.minutosMin)}–${num(completo.maquinaTotal.minutosMax)}` : "null", "82–134");
  comprobar("completo: por maquina", completo.porMaquina.map((m) => `${m.maquinaNombre}=${num(m.minutos)}${m.completo ? "" : "(parcial)"}`).join(" | "), "Láser CO2=90 | Plotter de corte=18");
  const parcial = totalizarPedido([a, vacio, b]);
  comprobar("parcial: lineas sin datos", String(parcial.lineasSinDatos), "1");
  comprobar("parcial: no es completo", String(parcial.completo), "false");
  comprobar("parcial: el total suma solo lo que tiene datos", parcial.maquinaTotal ? num(parcial.maquinaTotal.minutos) : "null", "108");
  comprobar("parcial: por maquina marcado parcial", parcial.porMaquina.every((m) => !m.completo) ? "todas parciales" : "no", "todas parciales");
  const ninguna = totalizarPedido([vacio]);
  comprobar("ninguna linea con datos: sin total (null, no 0)", `${ninguna.maquinaTotal} / ${ninguna.manoObra}`, "null / null");
  comprobar("pedido vacio no es completo", String(totalizarPedido([]).completo), "false");
}

console.log("--- Validacion del pedido ---");
{
  const ID = "123e4567-e89b-42d3-a456-426614174000";
  const ok = validarPedido([{ articuloId: ID, cantidad: " 2,5 " }]);
  comprobar("valido (coma decimal, espacios)", ok.ok ? ok.lineas[0]!.cantidad.toString() : ok.errores.join(" / "), "2.5");
  const errores = (e: { articuloId: string; cantidad: string }[]) => {
    const r = validarPedido(e);
    return r.ok ? "sin errores" : r.errores.join(" / ");
  };
  comprobar("sin lineas", errores([]), "Agregá al menos un artículo.");
  comprobar("cantidad 0", errores([{ articuloId: ID, cantidad: "0" }]), "Línea 1: la cantidad tiene que ser mayor a 0.");
  comprobar("cantidad negativa", errores([{ articuloId: ID, cantidad: "-1" }]), 'Línea 1: la cantidad "-1" no es un número válido.');
  comprobar("cantidad vacia", errores([{ articuloId: ID, cantidad: "" }]), 'Línea 1: la cantidad "" no es un número válido.');
  comprobar("cantidad no numerica", errores([{ articuloId: ID, cantidad: "abc" }]), 'Línea 1: la cantidad "abc" no es un número válido.');
  comprobar("cantidad con notacion cientifica", errores([{ articuloId: ID, cantidad: "1e3" }]), 'Línea 1: la cantidad "1e3" no es un número válido.');
  comprobar("cantidad enorme", String(errores([{ articuloId: ID, cantidad: "1000001" }]).startsWith("Línea 1: la cantidad es demasiado grande")), "true");
  comprobar("articulo con id invalido", errores([{ articuloId: "no-es-un-uuid", cantidad: "1" }]), "Línea 1: el artículo no es válido.");
  comprobar("junta todos los errores", errores([{ articuloId: "x", cantidad: "1" }, { articuloId: ID, cantidad: "0" }]), "Línea 1: el artículo no es válido. / Línea 2: la cantidad tiene que ser mayor a 0.");
  comprobar("demasiadas lineas", errores(Array.from({ length: 51 }, () => ({ articuloId: ID, cantidad: "1" }))), "Son demasiadas líneas: el máximo es 50.");
}

console.log("--- Formato ---");
comprobar("0 min → 0:00", fmtHorasMinutos(d(0)), "0:00");
comprobar("5 min → 0:05", fmtHorasMinutos(d(5)), "0:05");
comprobar("65 min → 1:05", fmtHorasMinutos(d(65)), "1:05");
comprobar("59,5 min redondea a 1:00", fmtHorasMinutos(d("59.5")), "1:00");
comprobar("59,4 min → 0:59", fmtHorasMinutos(d("59.4")), "0:59");
comprobar("600 min → 10:00", fmtHorasMinutos(d(600)), "10:00");
comprobar("6000 min → 100:00", fmtHorasMinutos(d(6000)), "100:00");
comprobar("12,34 min", fmtMinutos(d("12.34")), "12,3 min");
comprobar("12 min", fmtMinutos(d(12)), "12 min");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
