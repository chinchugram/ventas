/**
 * Prueba la estimacion de tiempos (ola 6, 6.3) contra Postgres real, sin Next:
 * la consulta `estimarTiempos` de punta a punta con trabajos sembrados por Prisma
 * (la carga de produccion es de 6.1 y no hace falta): historial del MISMO articulo,
 * trabajos anulados fuera, ultimos N por fecha, minimo de muestras, maquinas, total
 * parcial, entradas invalidas, y que no salga ningun costo.
 *
 *   npx tsx scripts/test-estimacion-tiempos.ts
 *
 * Usa la base de DATABASE_URL. Los datos de prueba llevan el prefijo `zz-est63` (y las
 * ventas el anio 2099) y se borran al terminar, tambien si falla (borrado fisico: son
 * datos de prueba, no de negocio). Solo lee con la consulta; solo escribe con Prisma
 * para sembrar y limpiar.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { estimarTiempos, getArticulosParaEstimar } from "../src/lib/queries/estimacion-tiempos";
import { estadoDemo } from "../src/lib/respaldo";
import type { Estimacion } from "../src/lib/estimacion-tiempos";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

/** Negocio de las pruebas: el de la migracion (`hl-laser`). Se resuelve al empezar `main`. */
let negocioId = "";

const ROTULO = "zz-est63";
const ANIO = 2099;
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

const num = (v: { toDecimalPlaces: (n: number) => { toString: () => string } }) => v.toDecimalPlaces(6).toString();
const resumen = (e: Estimacion) =>
  e.suficiente ? `${num(e.minutos)} [${num(e.minutosMin)}–${num(e.minutosMax)}] n=${e.muestras}` : `sin datos (${e.muestras})`;

const creados = {
  articulos: [] as string[],
  maquinas: [] as string[],
  clientes: [] as string[],
  ventas: [] as string[],
};

let numeroVenta = 0;

async function limpiar() {
  // Por prefijo y por anio: tambien levanta restos de una corrida anterior que haya fallado.
  const ventas = await prisma.venta.findMany({ where: { anio: ANIO }, select: { id: true } });
  const items = await prisma.ventaItem.findMany({ where: { ventaId: { in: ventas.map((v) => v.id) } }, select: { id: true } });
  const trabajos = await prisma.trabajoProduccion.findMany({ where: { ventaItemId: { in: items.map((i) => i.id) } }, select: { id: true } });
  const idsTrabajos = trabajos.map((t) => t.id);
  await prisma.$transaction([
    prisma.trabajoTiempo.deleteMany({ where: { trabajoId: { in: idsTrabajos } } }),
    prisma.trabajoConsumo.deleteMany({ where: { trabajoId: { in: idsTrabajos } } }),
    prisma.trabajoProduccion.deleteMany({ where: { id: { in: idsTrabajos } } }),
    prisma.ventaItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } }),
    prisma.venta.deleteMany({ where: { id: { in: ventas.map((v) => v.id) } } }),
    prisma.articulo.deleteMany({ where: { nombre: { startsWith: ROTULO } } }),
    prisma.maquina.deleteMany({ where: { nombre: { startsWith: ROTULO } } }),
    prisma.cliente.deleteMany({ where: { nombre: { startsWith: ROTULO } } }),
  ]);
}

async function articulo(nombre: string, activo = true) {
  const a = await prisma.articulo.create({ data: { negocioId, nombre: `${ROTULO} ${nombre}`, precioVenta: "1000", activo } });
  creados.articulos.push(a.id);
  return a.id;
}

async function maquina(nombre: string) {
  const m = await prisma.maquina.create({ data: { negocioId, nombre: `${ROTULO} ${nombre}`, costoHora: "7777" } });
  creados.maquinas.push(m.id);
  return m.id;
}

type Siembra = {
  articuloId: string;
  clienteId: string;
  cantidad: number | string;
  /** Dia del trabajo (ISO yyyy-mm-dd). */
  fecha: string;
  manoObra: number | string;
  tiempos?: [string, number | string][];
  /** Trabajo anulado (baja logica con motivo). */
  anulado?: boolean;
  /** La venta de la linea se anulo despues (el trabajo medido sigue valiendo). */
  ventaAnulada?: boolean;
};

/** Siembra venta + linea + trabajo (con tiempos) directo por Prisma; 6.1 todavia no esta. */
async function sembrar(s: Siembra) {
  numeroVenta += 1;
  const venta = await prisma.venta.create({
    data: {
      negocioId,
      numero: numeroVenta,
      anio: ANIO,
      clienteId: s.clienteId,
      fecha: new Date(`${s.fecha}T00:00:00Z`),
      estado: s.ventaAnulada ? "ANULADA" : "PENDIENTE",
    },
  });
  creados.ventas.push(venta.id);
  const item = await prisma.ventaItem.create({
    data: {
      negocioId,
      ventaId: venta.id,
      articuloId: s.articuloId,
      descripcion: "Linea de prueba",
      cantidad: String(s.cantidad),
      precioUnitario: "1000",
      ivaPct: "21",
      subtotalNeto: "1000",
      subtotalIVA: "210",
      subtotalBruto: "1210",
      costoUnitarioSnapshot: "123.4567",
      costoTotalSnapshot: "123.46",
    },
  });
  await prisma.trabajoProduccion.create({
    data: {
      negocioId,
      ventaItemId: item.id,
      fecha: new Date(`${s.fecha}T00:00:00Z`),
      minutosManoObra: String(s.manoObra),
      // Costos congelados con valores marcados: tienen que NO aparecer en el resultado.
      costoHoraManoObraSnapshot: "9999",
      ...(s.anulado ? { anuladoEn: new Date(), motivoAnulacion: "Carga equivocada" } : {}),
      tiempos: {
        create: (s.tiempos ?? []).map(([maquinaId, minutos]) => ({ negocioId, maquinaId, minutos: String(minutos), costoHoraSnapshot: "8888" })),
      },
    },
  });
}

const dia = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;

async function main() {
  negocioId = (await prisma.negocio.findUniqueOrThrow({ where: { slug: "hl-laser" }, select: { id: true } })).id;
  await limpiar();
  const cliente = await prisma.cliente.create({ data: { negocioId, nombre: `${ROTULO} cliente` } });
  creados.clientes.push(cliente.id);
  const clienteId = cliente.id;

  const laser = await maquina("Láser");
  const plotter = await maquina("Plotter");

  // A: 5 trabajos vigentes + 1 anulado + 1 con venta anulada. Por unidad (cantidad, MO, laser, plotter):
  //  dia 1: 2 u, MO 20 (10/u), laser 20 (10/u), plotter 10 (5/u)
  //  dia 2: 1 u, MO 12,       laser 14,        plotter 6
  //  dia 3: 4 u, MO 40 (10/u), laser 40 (10/u)            (sin plotter)
  //  dia 4: 1 u, MO 8,        laser 12
  //  dia 5: 5 u, MO 90 (18/u), laser 100 (20/u), plotter 15 (3/u)
  //  anulado (dia 6): 1 u, MO 5000 → no cuenta.
  //  venta anulada (dia 7): 1 u, MO 14, laser 16 → SI cuenta.
  const A = await articulo("Cartel acrílico");
  await sembrar({ articuloId: A, clienteId, cantidad: 2, fecha: dia(1), manoObra: 20, tiempos: [[laser, 20], [plotter, 10]] });
  await sembrar({ articuloId: A, clienteId, cantidad: 1, fecha: dia(2), manoObra: 12, tiempos: [[laser, 14], [plotter, 6]] });
  await sembrar({ articuloId: A, clienteId, cantidad: 4, fecha: dia(3), manoObra: 40, tiempos: [[laser, 40]] });
  await sembrar({ articuloId: A, clienteId, cantidad: 1, fecha: dia(4), manoObra: 8, tiempos: [[laser, 12]] });
  await sembrar({ articuloId: A, clienteId, cantidad: 5, fecha: dia(5), manoObra: 90, tiempos: [[laser, 100], [plotter, 15]] });
  await sembrar({ articuloId: A, clienteId, cantidad: 1, fecha: dia(6), manoObra: 5000, tiempos: [[laser, 5000]], anulado: true });
  await sembrar({ articuloId: A, clienteId, cantidad: 1, fecha: dia(7), manoObra: 14, tiempos: [[laser, 16]], ventaAnulada: true });

  // B: 12 trabajos de 1 unidad con MO = 1..12 segun la fecha (el mas reciente vale 12). Entran los 10 mas recientes: 3..12.
  const B = await articulo("Llavero");
  for (let i = 1; i <= 12; i++) await sembrar({ articuloId: B, clienteId, cantidad: 1, fecha: dia(i), manoObra: i, tiempos: [[laser, i * 2]] });

  // C: solo 2 trabajos (insuficiente). D: ninguno. E: trabajos de OTRO articulo no deben mezclarse (usa los de A en otra cantidad).
  const C = await articulo("Sticker");
  await sembrar({ articuloId: C, clienteId, cantidad: 1, fecha: dia(1), manoObra: 3, tiempos: [[plotter, 3]] });
  await sembrar({ articuloId: C, clienteId, cantidad: 1, fecha: dia(2), manoObra: 4, tiempos: [[plotter, 4]] });
  const D = await articulo("Banner");
  // F: articulo dado de baja: se puede estimar igual (tiene historial), aunque no se ofrece para elegir.
  const F = await articulo("Discontinuado", false);
  for (let i = 1; i <= 3; i++) await sembrar({ articuloId: F, clienteId, cantidad: 1, fecha: dia(i), manoObra: 10 * i });

  console.log("--- Articulo con historial: mediana por unidad × cantidad, muestras y rango ---");
  {
    const r = await estimarTiempos([{ articuloId: A, cantidad: "3" }]);
    if (!r.ok) throw new Error(`no estimo: ${r.errores.join(" / ")}`);
    const l = r.lineas[0]!;
    // Vigentes (6, contando la de venta anulada, sin la anulada). MO por unidad: 10,12,10,8,18,14 → ordenadas 8,10,10,12,14,18 → mediana 11 → ×3 = 33; rango 24–54.
    comprobar("mano de obra", resumen(l.manoObra), "33 [24–54] n=6");
    // Total maquinas por unidad: 15 (20+10)/2, 20 (14+6), 10, 12, 23 ((100+15)/5), 16 → 10,12,15,16,20,23 → mediana 15,5 → ×3 = 46,5.
    comprobar("maquinas (total)", resumen(l.maquinaTotal), "46.5 [30–69] n=6");
    comprobar("trabajos que respaldan la linea", String(l.trabajos), "6");
    const l1 = l.maquinas.find((m) => m.maquinaNombre === `${ROTULO} Láser`)!;
    // Laser por unidad: 10, 14, 10, 12, 20, 16 → 10,10,12,14,16,20 → mediana 13 → ×3 = 39.
    comprobar("Láser", resumen(l1), "39 [30–60] n=6");
    const l2 = l.maquinas.find((m) => m.maquinaNombre === `${ROTULO} Plotter`)!;
    // Plotter solo en 3 trabajos: 5, 6, 3 → mediana 5 → ×3 = 15.
    comprobar("Plotter (solo los trabajos que la usaron)", resumen(l2), "15 [9–18] n=3");
    comprobar("maquinas ordenadas por nombre", l.maquinas.map((m) => m.maquinaNombre.replace(`${ROTULO} `, "")).join(","), "Láser,Plotter");
    comprobar("criterio informado", `${r.criterio.n}/${r.criterio.minMuestras}`, "10/3");
  }

  console.log("--- El trabajo anulado no entra ---");
  {
    const r = await estimarTiempos([{ articuloId: A, cantidad: "1" }]);
    if (!r.ok) throw new Error("no estimo");
    const max = r.lineas[0]!.manoObra;
    comprobar("el maximo no es 5000", max.suficiente ? num(max.minutosMax) : "sin datos", "18");
  }

  console.log("--- Ultimos N: solo los 10 mas recientes por fecha ---");
  {
    const r = await estimarTiempos([{ articuloId: B, cantidad: "2" }]);
    if (!r.ok) throw new Error("no estimo");
    const l = r.lineas[0]!;
    // MO 3..12 → mediana 7,5 → ×2 = 15; rango 3×2=6 .. 12×2=24.
    comprobar("mano de obra (3..12)", resumen(l.manoObra), "15 [6–24] n=10");
    comprobar("maquina total (6..24 → 15 ×2)", resumen(l.maquinaTotal), "30 [12–48] n=10");
  }

  console.log("--- Pocas muestras o ninguna: sin datos suficientes ---");
  {
    const r = await estimarTiempos([{ articuloId: C, cantidad: "10" }, { articuloId: D, cantidad: "1" }]);
    if (!r.ok) throw new Error("no estimo");
    comprobar("2 trabajos: mano de obra", resumen(r.lineas[0]!.manoObra), "sin datos (2)");
    comprobar("2 trabajos: maquinas", resumen(r.lineas[0]!.maquinaTotal), "sin datos (2)");
    comprobar("ningun trabajo: mano de obra", resumen(r.lineas[1]!.manoObra), "sin datos (0)");
    comprobar("sin datos en ninguna linea: no hay total", `${r.total.maquinaTotal} / ${r.total.manoObra}`, "null / null");
    comprobar("lineas sin datos", String(r.total.lineasSinDatos), "2");
  }

  console.log("--- Pedido con varias lineas: total parcial ---");
  {
    const r = await estimarTiempos([
      { articuloId: A, cantidad: "3" },
      { articuloId: C, cantidad: "1" },
      { articuloId: B, cantidad: "2" },
    ]);
    if (!r.ok) throw new Error("no estimo");
    comprobar("no es completo", String(r.total.completo), "false");
    comprobar("lineas con datos / sin datos", `${r.total.lineasConDatos}/${r.total.lineasSinDatos}`, "2/1");
    comprobar("mano de obra: 33 + 15", r.total.manoObra ? num(r.total.manoObra.minutos) : "null", "48");
    comprobar("maquinas: 46,5 + 30", r.total.maquinaTotal ? num(r.total.maquinaTotal.minutos) : "null", "76.5");
    comprobar("las lineas salen en el orden pedido", r.lineas.map((l) => l.nombre.replace(`${ROTULO} `, "")).join(","), "Cartel acrílico,Sticker,Llavero");
  }

  console.log("--- Mismo articulo en dos lineas, y articulo dado de baja ---");
  {
    const r = await estimarTiempos([{ articuloId: B, cantidad: "1" }, { articuloId: B, cantidad: "4" }]);
    if (!r.ok) throw new Error("no estimo");
    comprobar("mismo articulo, cantidades distintas", `${resumen(r.lineas[0]!.manoObra)} | ${resumen(r.lineas[1]!.manoObra)}`, "7.5 [3–12] n=10 | 30 [12–48] n=10");
    const f = await estimarTiempos([{ articuloId: F, cantidad: "2" }]);
    if (!f.ok) throw new Error("no estimo el articulo dado de baja");
    comprobar("articulo inactivo con historial: estima", resumen(f.lineas[0]!.manoObra), "40 [20–60] n=3");
    const ofrecidos = (await getArticulosParaEstimar()).map((a) => a.id);
    comprobar("el inactivo no se ofrece para elegir", String(ofrecidos.includes(F)), "false");
    comprobar("el activo si", String(ofrecidos.includes(A)), "true");
  }

  console.log("--- Entradas invalidas: error claro, sin crash ---");
  {
    const errores = async (e: { articuloId: string; cantidad: string }[]) => {
      const r = await estimarTiempos(e);
      return r.ok ? "estimo" : r.errores.join(" / ");
    };
    comprobar("articulo inexistente", await errores([{ articuloId: ID_INEXISTENTE, cantidad: "1" }]), "Línea 1: el artículo no existe.");
    comprobar("inexistente en la linea 2", await errores([{ articuloId: A, cantidad: "1" }, { articuloId: ID_INEXISTENTE, cantidad: "1" }]), "Línea 2: el artículo no existe.");
    comprobar("id que no es uuid (no llega a la base)", await errores([{ articuloId: "'; drop table articulos; --", cantidad: "1" }]), "Línea 1: el artículo no es válido.");
    comprobar("cantidad 0", await errores([{ articuloId: A, cantidad: "0" }]), "Línea 1: la cantidad tiene que ser mayor a 0.");
    comprobar("cantidad negativa", await errores([{ articuloId: A, cantidad: "-3" }]), 'Línea 1: la cantidad "-3" no es un número válido.');
    comprobar("cantidad no numerica", await errores([{ articuloId: A, cantidad: "mucho" }]), 'Línea 1: la cantidad "mucho" no es un número válido.');
    comprobar("sin lineas", await errores([]), "Agregá al menos un artículo.");
  }

  console.log("--- Sin costos en el resultado (el empleado puede verlo) ---");
  {
    const r = await estimarTiempos([{ articuloId: A, cantidad: "3" }]);
    const json = JSON.stringify(r);
    comprobar("ninguna clave de costo", String(/costo|snapshot|precio|margen/i.test(json)), "false");
    for (const marca of ["7777", "8888", "9999", "123.4567"]) comprobar(`el valor congelado ${marca} no aparece`, String(json.includes(marca)), "false");
  }

  console.log("--- Es de lectura: no escribio nada ---");
  {
    const antes = await prisma.trabajoProduccion.count();
    await estimarTiempos([{ articuloId: A, cantidad: "1" }]);
    await estimarTiempos([{ articuloId: ID_INEXISTENTE, cantidad: "1" }]);
    comprobar("la cantidad de trabajos no cambia", String((await prisma.trabajoProduccion.count()) - antes), "0");
    comprobar("no uso datos de demostracion", String(estadoDemo().activo), "false");
  }

  console.log("--- Cantidades decimales exactas (Decimal) ---");
  {
    const r = await estimarTiempos([{ articuloId: B, cantidad: "0,333" }]);
    if (!r.ok) throw new Error("no estimo");
    // Mediana por unidad 7,5 × 0,333 = 2,4975 exacto.
    comprobar("7,5 × 0,333", r.lineas[0]!.manoObra.suficiente ? d(r.lineas[0]!.manoObra.minutos).toString() : "sin datos", "2.4975");
  }
}

main()
  .catch((error) => {
    console.error(error);
    fallos += 1;
  })
  .finally(async () => {
    try {
      await limpiar();
      comprobar("sin rastro: no queda ningun articulo de prueba", String(await prisma.articulo.count({ where: { nombre: { startsWith: ROTULO } } })), "0");
      comprobar("sin rastro: no queda ninguna venta de prueba", String(await prisma.venta.count({ where: { anio: ANIO } })), "0");
      comprobar("sin rastro: no queda ninguna maquina de prueba", String(await prisma.maquina.count({ where: { nombre: { startsWith: ROTULO } } })), "0");
    } catch (error) {
      console.error(error);
      fallos += 1;
    }
    await prisma.$disconnect();
    console.log("");
    console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
    process.exit(fallos === 0 ? 0 : 1);
  });
