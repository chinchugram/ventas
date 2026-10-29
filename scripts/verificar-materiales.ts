/**
 * Verificacion de la logica pura de materiales (impacto de un cambio de costo
 * en el margen de los articulos) contra numeros conocidos.
 *
 *   npx tsx scripts/verificar-materiales.ts
 */
import {
  claveDeNombre,
  costoCambio,
  deserializarArticulos,
  impactoDeCambioDeCosto,
  serializarArticulos,
  type ArticuloConReceta,
  type ComponenteConMaterial,
} from "../src/lib/materiales";
import { d } from "../src/lib/money";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const A = "material-a";
const B = "material-b";

const material = (materialId: string, nombre: string, costo: string, cantidad: string, override?: string): ComponenteConMaterial => ({
  id: `${materialId}-${nombre}-${cantidad}`,
  tipo: "MATERIAL",
  materialId,
  cantidad: d(cantidad),
  costoUnitarioOverride: override === undefined ? null : d(override),
  notas: null,
  material: { nombre, costoUnitario: d(costo), unidad: "M2" },
  maquina: null,
});

const manoDeObra = (horas: string): ComponenteConMaterial => ({
  id: `mo-${horas}`,
  tipo: "MANO_OBRA",
  materialId: null,
  cantidad: d(horas),
  costoUnitarioOverride: null,
  notas: null,
  material: null,
  maquina: null,
});

// Mano de obra a $1.000/h, IVA 21%, meta 30%.
const articulos: ArticuloConReceta[] = [
  {
    // 2 m2 de A a $100 + 1 de B a $50 + 0,5 h = $750. Vende a $1.210.
    id: "cartel",
    nombre: "Cartel",
    precioVenta: d(1210),
    ivaPct: d(21),
    componentes: [material(A, "A", "100", "2"), material(B, "B", "50", "1"), manoDeObra("0.5")],
  },
  {
    // 1 de A con override a $80 + 0,1 h = $180. Vende a $500.
    id: "sticker",
    nombre: "Sticker",
    precioVenta: d(500),
    ivaPct: d(21),
    componentes: [material(A, "A", "100", "1", "80"), manoDeObra("0.1")],
  },
  {
    // No usa A: no tiene que aparecer.
    id: "llavero",
    nombre: "Llavero",
    precioVenta: d(300),
    ivaPct: d(21),
    componentes: [material(B, "B", "50", "2")],
  },
];

const impacto = (costoNuevo: string, meta = "30") =>
  impactoDeCambioDeCosto({
    articulos,
    materialId: A,
    costoNuevo: d(costoNuevo),
    costoHoraManoObra: d(1000),
    margenObjetivoPct: d(meta),
  });

console.log("--- A pasa de $100 a $150 ---");
const sube = impacto("150");
comprobar("solo los que usan A", sube.map((i) => i.id).join(","), "cartel,sticker");
const cartel = sube.find((i) => i.id === "cartel")!;
comprobar("cartel costo actual", cartel.costoActual.toString(), "750");
comprobar("cartel costo nuevo (2 x 150 + 50 + 500)", cartel.costoNuevo.toString(), "850");
comprobar("cartel margen actual (460 / 1210)", cartel.margenActualPct.toString(), "38.02");
comprobar("cartel margen nuevo (360 / 1210)", cartel.margenNuevoPct.toString(), "29.75");
comprobar("cartel queda bajo la meta", String(cartel.quedaBajoMeta), "true");
comprobar("cartel precio para volver a 30% (850 / 0,7)", cartel.precioSugerido.toString(), "1214.29");

const sticker = sube.find((i) => i.id === "sticker")!;
comprobar("sticker con override no cambia", `${sticker.costoActual} → ${sticker.costoNuevo}`, "180 → 180");
comprobar("sticker solo override", String(sticker.soloOverride), "true");
comprobar("sticker margen (320 / 500)", sticker.margenNuevoPct.toString(), "64");

console.log("--- A baja de $100 a $40: el cartel alcanza la meta de 40% ---");
const baja = impacto("40", "40");
const cartelBaja = baja.find((i) => i.id === "cartel")!;
comprobar("cartel costo nuevo (2 x 40 + 50 + 500)", cartelBaja.costoNuevo.toString(), "630");
comprobar("cartel alcanza meta", String(cartelBaja.alcanzaMeta), "true");
comprobar("cartel no queda bajo meta", String(cartelBaja.quedaBajoMeta), "false");

console.log("--- Orden: primero el que mas margen pierde ---");
comprobar("orden al subir", sube.map((i) => i.id).join(","), "cartel,sticker");
comprobar("orden al bajar (empate en 0 → por nombre)", baja.map((i) => i.id).join(","), "sticker,cartel");

console.log("--- Sin cambio de costo ---");
const igual = impacto("100");
comprobar("cartel igual", `${igual[0]!.costoActual} → ${igual[0]!.costoNuevo}`, "750 → 750");

console.log("--- Mismo material en dos lineas: redondeo por linea, como el costeo real ---");
const doble = impactoDeCambioDeCosto({
  articulos: [
    {
      id: "doble",
      nombre: "Doble",
      precioVenta: d(100),
      ivaPct: d(21),
      componentes: [material(A, "A", "1", "0.33333"), material(A, "A", "1", "0.33333")],
    },
  ],
  materialId: A,
  costoNuevo: d("0.33333"),
  costoHoraManoObra: d(0),
  margenObjetivoPct: d(40),
});
// Cada linea: 0,33333 x 0,33333 = 0,1111088889 → 0,1111. Suma 0,2222.
comprobar("costo nuevo", doble[0]!.costoNuevo.toString(), "0.2222");

console.log("--- Ida y vuelta servidor → cliente ---");
const vuelta = deserializarArticulos(JSON.parse(JSON.stringify(serializarArticulos(articulos))));
const impactoVuelta = impactoDeCambioDeCosto({
  articulos: vuelta,
  materialId: A,
  costoNuevo: d(150),
  costoHoraManoObra: d(1000),
  margenObjetivoPct: d(30),
});
comprobar(
  "mismo resultado",
  impactoVuelta.map((i) => `${i.id}:${i.costoNuevo}:${i.margenNuevoPct}`).join(" "),
  sube.map((i) => `${i.id}:${i.costoNuevo}:${i.margenNuevoPct}`).join(" "),
);
comprobar("override conservado", String(vuelta[1]!.componentes[0]!.costoUnitarioOverride), "80");

console.log("--- Nombres repetidos ---");
comprobar("mayusculas y espacios", claveDeNombre("  MDF   3mm "), "mdf 3mm");
comprobar("tildes", String(claveDeNombre("Acrílico") === claveDeNombre("acrilico")), "true");
comprobar("distintos", String(claveDeNombre("MDF 3mm") === claveDeNombre("MDF 5mm")), "false");

console.log("--- Cambio de costo ---");
comprobar("100 vs 100.0000", String(costoCambio(d("100"), d("100.0000"))), "false");
comprobar("100 vs 100.5", String(costoCambio(d("100"), d("100.5"))), "true");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
