/**
 * Verificacion del consumo real vs teorico contra numeros armados a mano.
 *
 *   npx tsx scripts/verificar-consumo.ts          (parte pura, sin base)
 *   npx tsx scripts/verificar-consumo.ts --db     (ademas, contra Postgres, solo lectura)
 *
 * Con --db se pide el consumo de todo el historial de la base y se comprueba
 * que, sin ajustes manuales ni anulaciones tardias, real y teorico coinciden.
 */
import "dotenv/config";
import {
  compararConsumo,
  consumoTeoricoPorMaterial,
  diferenciaPorcentual,
  type ArticuloConReceta,
  type LineaVendida,
} from "../src/lib/consumo-teorico";
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

// ─── Caso armado a mano ──────────────────────────────────────────────────────
//
// Materiales (costo actual): A Vinilo $100 · B MDF $50 · C Cinta $10 ·
//                            D Acrilico $200 · E Lamina $20 · F Papel $5 (sin uso)
//
// Recetas:
//   Rotulo  (R): A 0,5 + B 0,25 + una maquina (no consume stock)
//   Sticker (S): A 0,1 + B 0,002
//   Tira    (T): C 0,0004            ← redondeo por venta
//   Gancho  (U): C 0,0005            ← redondeo por venta (mitad hacia arriba)
//   Panel   (W): E 2
//   Diseno  (X): servicio, con un componente A 99 que NO debe contar
//
// Ventas no anuladas del periodo (lo que llega a la funcion pura):
//   V1: R×4 + S×30 → A: 2 + 3 = 5      B: 1 + 0,06 = 1,06
//   V2: R×2        → A: 1              B: 0,5
//   V3: S×1 + X×5  → A: 0,1            B: 0,002          (el servicio no cuenta)
//   V5: T×1                 → C: 0,0004 → 0,000
//   V6: T×1 y T×2 (2 lineas)→ C: 0,0012 → 0,001           (se suma y recien ahi se redondea)
//   V7: U×1                 → C: 0,0005 → 0,001
//   V8: W×2        → E: 4
//   (V4: R×10, anulada: no llega a la funcion; en el libro dejo -5 de A y +5 de A)
//
// Teorico: A 6,1 · B 1,562 · C 0,002 · E 4 · D 0 · F 0
//
// Real (libro de ventas, neto de anulaciones; positivo = salio):
//   A: V1 5 + V2 1 + V3 0,1 + V4 (5 − 5) + 0,4 de mas                 = 6,5
//   B: 1,06 + 0,5 + 0,002                                              = 1,562
//   C: 0,001 + 0,001                                                   = 0,002
//   D: 0,3 sin venta que lo explique (se retiro sin receta)            = 0,3
//   E: faltaba stock, la venta descontó 3 de los 4                     = 3

const MAT = { A: "mat-a", B: "mat-b", C: "mat-c", D: "mat-d", E: "mat-e", F: "mat-f" };
const material = (id: string, nombre: string, costo: string) => ({ id, nombre, costoUnitario: d(costo) });
const materiales = [
  material(MAT.A, "Vinilo", "100"),
  material(MAT.B, "MDF", "50"),
  material(MAT.C, "Cinta", "10"),
  material(MAT.D, "Acrilico", "200"),
  material(MAT.E, "Lamina", "20"),
  material(MAT.F, "Papel", "5"),
];

const comp = (materialId: string, cantidad: string) => ({ tipo: "MATERIAL" as const, materialId, cantidad: d(cantidad) });
const articulos: ArticuloConReceta[] = [
  {
    id: "R",
    esServicio: false,
    componentes: [
      comp(MAT.A, "0.5"),
      comp(MAT.B, "0.25"),
      { tipo: "MAQUINA", materialId: null, cantidad: d("3") },
    ],
  },
  { id: "S", esServicio: false, componentes: [comp(MAT.A, "0.1"), comp(MAT.B, "0.002")] },
  { id: "T", esServicio: false, componentes: [comp(MAT.C, "0.0004")] },
  { id: "U", esServicio: false, componentes: [comp(MAT.C, "0.0005")] },
  { id: "W", esServicio: false, componentes: [comp(MAT.E, "2")] },
  { id: "X", esServicio: true, componentes: [comp(MAT.A, "99")] },
  { id: "Y", esServicio: false, componentes: [] }, // sin receta: no consume nada
];

const linea = (ventaId: string, articuloId: string, cantidad: number): LineaVendida => ({
  ventaId,
  articuloId,
  cantidad: d(cantidad),
});
const lineas: LineaVendida[] = [
  linea("V1", "R", 4),
  linea("V1", "S", 30),
  linea("V2", "R", 2),
  linea("V3", "S", 1),
  linea("V3", "X", 5),
  linea("V3", "Y", 7),
  linea("V5", "T", 1),
  linea("V6", "T", 1),
  linea("V6", "T", 2),
  linea("V7", "U", 1),
  linea("V8", "W", 2),
];

console.log("--- Consumo teorico por material ---");
const teorico = consumoTeoricoPorMaterial(lineas, articulos);
comprobar("A Vinilo (2+3+1+0,1)", texto(teorico.get(MAT.A) ?? null), "6.1");
comprobar("B MDF (1,06+0,5+0,002)", texto(teorico.get(MAT.B) ?? null), "1.562");
comprobar("C Cinta (0 + 0,001 + 0,001)", texto(teorico.get(MAT.C) ?? null), "0.002");
comprobar("E Lamina", texto(teorico.get(MAT.E) ?? null), "4");
comprobar("D Acrilico: sin receta que lo use", texto(teorico.get(MAT.D) ?? null), "null");
comprobar("servicio y maquina no consumen (solo A, B, C, E)", [...teorico.keys()].sort().join(","), "mat-a,mat-b,mat-c,mat-e");

// Misma venta cortada en dos grupos de lineas: el redondeo es por venta, no por linea.
const t6 = consumoTeoricoPorMaterial(lineas.filter((l) => l.ventaId === "V6"), articulos);
comprobar("V6 sola: 0,0004 + 0,0008 → 0,001", texto(t6.get(MAT.C) ?? null), "0.001");
const t6enDosVentas = consumoTeoricoPorMaterial(
  [linea("V6a", "T", 1), linea("V6b", "T", 2)],
  articulos,
);
comprobar("mismas lineas en 2 ventas: 0 + 0,001", texto(t6enDosVentas.get(MAT.C) ?? null), "0.001");

console.log("--- Receta editada despues de la venta: se usa la actual ---");
const recetaNueva = articulos.map((a) => (a.id === "R" ? { ...a, componentes: [comp(MAT.A, "0.6"), comp(MAT.B, "0.25")] } : a));
comprobar(
  "A con R = 0,6 (2,4+3+1,2+0,1)",
  texto(consumoTeoricoPorMaterial(lineas, recetaNueva).get(MAT.A) ?? null),
  "6.7",
);

console.log("--- Real vs teorico ---");
const real = new Map([
  [MAT.A, d("6.5")],
  [MAT.B, d("1.562")],
  [MAT.C, d("0.002")],
  [MAT.D, d("0.3")],
  [MAT.E, d("3")],
]);
const r = compararConsumo(materiales, teorico, real);
const porNombre = new Map(r.lineas.map((l) => [l.nombre, l]));

comprobar("orden por |desvio en valor| (D, A, E, C, B)", r.lineas.map((l) => l.nombre).join(","), "Acrilico,Vinilo,Lamina,Cinta,MDF");
comprobar("Papel (0 y 0) se omite", String(porNombre.has("Papel")), "false");

const A = porNombre.get("Vinilo")!;
comprobar("A teorico", texto(A.teorico), "6.1");
comprobar("A real", texto(A.real), "6.5");
comprobar("A diferencia", texto(A.diferencia), "0.4");
comprobar("A %  (0,4 / 6,1)", texto(A.diferenciaPct), "6.56");
comprobar("A valor teorico / real / diferencia", `${A.valorTeorico} / ${A.valorReal} / ${A.valorDiferencia}`, "610 / 650 / 40");

const B = porNombre.get("MDF")!;
comprobar("B sin desvio: diferencia", texto(B.diferencia), "0");
comprobar("B sin desvio: %", texto(B.diferenciaPct), "0");
comprobar("B valor teorico = real", `${B.valorTeorico} / ${B.valorReal}`, "78.1 / 78.1");

const C = porNombre.get("Cinta")!;
comprobar("C coincide", `${C.teorico} / ${C.real} / ${C.diferencia} / ${C.valorTeorico}`, "0.002 / 0.002 / 0 / 0.02");

const D = porNombre.get("Acrilico")!;
comprobar("D teorico 0: diferencia", texto(D.diferencia), "0.3");
comprobar("D teorico 0: % es null (no Infinity)", texto(D.diferenciaPct), "null");
comprobar("D valor diferencia", texto(D.valorDiferencia), "60");

const E = porNombre.get("Lamina")!;
comprobar("E falto stock: diferencia negativa", texto(E.diferencia), "-1");
comprobar("E %  (-1 / 4)", texto(E.diferenciaPct), "-25");
comprobar("E valor diferencia", texto(E.valorDiferencia), "-20");

comprobar("total valor teorico", texto(r.totalValorTeorico), "768.12");
comprobar("total valor real", texto(r.totalValorReal), "848.12");
comprobar("total valor diferencia (= real − teorico)", texto(r.totalValorDiferencia), "80");

console.log("--- Casos borde ---");
comprobar("% con teorico 0 y diferencia 0", texto(diferenciaPorcentual(d(0), d(0))), "null");
comprobar("% 1 sobre 3 (redondea a 2 decimales)", texto(diferenciaPorcentual(d(1), d(3))), "33.33");
comprobar("% -2 sobre 3", texto(diferenciaPorcentual(d(-2), d(3))), "-66.67");
const vacio = compararConsumo(materiales, new Map(), new Map());
comprobar("sin ventas ni movimientos: sin lineas y totales 0", `${vacio.lineas.length} ${vacio.totalValorDiferencia}`, "0 0");
const soloReal = compararConsumo(materiales, new Map(), new Map([[MAT.B, d("2")]]));
comprobar("solo real: % null", texto(soloReal.lineas[0]!.diferenciaPct), "null");
const negativo = compararConsumo(materiales, new Map(), new Map([[MAT.B, d("-1")]]));
comprobar("real neto negativo (anulacion de otro periodo) se muestra", `${negativo.lineas[0]!.real} ${negativo.lineas[0]!.valorDiferencia}`, "-1 -50");
comprobar("material desconocido en el real", lanza(() => compararConsumo(materiales, new Map(), new Map([["zzz", d(1)]]))), "lanza");
comprobar("articulo desconocido en las ventas", lanza(() => consumoTeoricoPorMaterial([linea("V9", "Z", 1)], articulos)), "lanza");

// ─── Contra Postgres (solo lectura) ──────────────────────────────────────────

async function contraLaBase() {
  const { getConsumoRealVsTeorico } = await import("../src/lib/queries/stock");
  const { prisma } = await import("../src/lib/prisma");

  console.log("--- Contra la base: sin ajustes, real = teorico ---");
  const primera = await prisma.venta.aggregate({ _min: { fecha: true } });
  const desde = primera._min.fecha ?? new Date(Date.UTC(2020, 0, 1));
  const hasta = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const rep = await getConsumoRealVsTeorico(desde, hasta);

  const ajustes = await prisma.movimientoStock.count({ where: { tipo: "AJUSTE" } });
  const anuladas = await prisma.venta.count({ where: { estado: "ANULADA" } });
  console.log(`INFO ${rep.lineas.length} materiales con consumo, ${ajustes} ajustes, ${anuladas} ventas anuladas`);
  for (const l of rep.lineas) {
    console.log(`INFO ${l.nombre}: teorico ${l.teorico} ${l.unidad}, real ${l.real}, diferencia ${l.diferencia}`);
  }

  comprobar("hay consumo en la base", String(rep.lineas.length > 0), "true");
  comprobar(
    "diferencia 0 en todos los materiales",
    rep.lineas.filter((l) => !l.diferencia.isZero()).map((l) => l.nombre).join(",") || "ninguno",
    "ninguno",
  );
  comprobar("total valor diferencia", texto(rep.totalValorDiferencia), "0");
  comprobar("% 0 (no null) en todos", rep.lineas.map((l) => texto(l.diferenciaPct)).every((p) => p === "0") ? "si" : "no", "si");

  console.log("--- Contra la base: periodo sin ventas ---");
  const futuro = await getConsumoRealVsTeorico(new Date(Date.UTC(2099, 0, 1)), new Date(Date.UTC(2099, 1, 1)));
  comprobar("sin lineas", String(futuro.lineas.length), "0");

  console.log("--- Contra la base: periodo invalido ---");
  comprobar("hasta <= desde falla", lanza(() => getConsumoRealVsTeorico(hasta, desde)), "lanza");

  await prisma.$disconnect();
}

async function main() {
  if (process.argv.includes("--db")) await contraLaBase();
  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} comprobaciones fallaron`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
