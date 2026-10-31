/**
 * Prueba el margen real contra Postgres real, sin Next: siembra trabajos de
 * produccion directamente por Prisma (la carga de la 6.1 es otra tarea) y llama
 * a la consulta de punta a punta.
 *
 *   npm run test:margen-real:db
 *
 * Usa la base de DATABASE_URL. Los datos de prueba son de 2031 (ventas numero
 * 9001 y 9002) y se confirman en la base, porque la consulta lee con su propia
 * conexion; se borran al terminar y tambien antes de empezar (borrado fisico: son
 * datos de prueba, no de negocio), incluso si algo falla. Los costos de materiales
 * y maquinas que se tocan para probar el congelado se restauran.
 *
 * Mismos numeros que `scripts/verificar-margen-real.ts` (hechos a mano):
 *   A: 10 u, neto 30.000, receta 18.000, real 19.601   (5/3 y 1/3: ver FECHA_A)
 *   B:  5 u, neto 10.000, receta  6.000, real  5.000
 *   C:  2 u, neto  5.000, receta      0, real  1.000
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { fechaDesdeISO } from "../src/lib/acciones";
import { rangoEntre } from "../src/lib/rango-fechas";
import { getMargenReal } from "../src/lib/queries/margen-real";
import { estadoDemo } from "../src/lib/respaldo";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const texto = (v: { toString(): string } | null) => (v === null ? "null" : v.toString());

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const ANIO = 2031;
const NUMEROS = [9001, 9002];

async function limpiar() {
  const ventas = await prisma.venta.findMany({ where: { anio: ANIO, numero: { in: NUMEROS } }, select: { id: true } });
  const trabajos = await prisma.trabajoProduccion.findMany({ where: { ventaItem: { ventaId: { in: ventas.map((v) => v.id) } } }, select: { id: true } });
  const ids = trabajos.map((t) => t.id);
  await prisma.trabajoConsumo.deleteMany({ where: { trabajoId: { in: ids } } });
  await prisma.trabajoTiempo.deleteMany({ where: { trabajoId: { in: ids } } });
  await prisma.trabajoProduccion.deleteMany({ where: { id: { in: ids } } });
  await prisma.venta.deleteMany({ where: { id: { in: ventas.map((v) => v.id) } } }); // los renglones caen en cascada
}

function rango(desde: string, hasta: string) {
  const r = rangoEntre(desde, hasta);
  if (!r) throw new Error(`rango invalido ${desde} ${hasta}`);
  return r;
}

type Original = { materiales: { id: string; costoUnitario: string }[]; maquinas: { id: string; costoHora: string }[] };
let original: Original | null = null;

async function main() {
  await limpiar();

  const cliente = await prisma.cliente.findFirstOrThrow();
  const [artX, artY] = await prisma.articulo.findMany({ orderBy: { nombre: "asc" }, take: 2 });
  const [mat1, mat2] = await prisma.material.findMany({ orderBy: { nombre: "asc" }, take: 2 });
  const [maq1, maq2] = await prisma.maquina.findMany({ orderBy: { nombre: "asc" }, take: 2 });
  if (!artX || !artY || !mat1 || !mat2 || !maq1 || !maq2) throw new Error("Falta el seed: hacen falta 2 articulos, 2 materiales y 2 maquinas.");
  original = {
    materiales: [mat1, mat2].map((m) => ({ id: m.id, costoUnitario: m.costoUnitario.toString() })),
    maquinas: [maq1, maq2].map((m) => ({ id: m.id, costoHora: m.costoHora.toString() })),
  };

  const renglon = (articuloId: string, cantidad: string, neto: string, receta: string) => ({
    articuloId,
    descripcion: "Renglon de prueba (margen real)",
    cantidad,
    precioUnitario: d(neto).div(cantidad).toDecimalPlaces(4).toString(),
    ivaPct: "21",
    subtotalNeto: neto,
    subtotalIVA: d(neto).times("0.21").toDecimalPlaces(2).toString(),
    subtotalBruto: d(neto).times("1.21").toDecimalPlaces(2).toString(),
    costoUnitarioSnapshot: "0",
    costoTotalSnapshot: receta,
  });
  const venta1 = await prisma.venta.create({
    data: {
      anio: ANIO,
      numero: 9001,
      clienteId: cliente.id,
      fecha: fechaDesdeISO("2031-03-01"),
      items: {
        create: [
          renglon(artX.id, "10", "30000", "18000"), // A
          renglon(artX.id, "5", "10000", "6000"), // B
          renglon(artY.id, "2", "5000", "0"), // C
          renglon(artY.id, "1", "7000", "3000"), // D: fuera de rango
        ],
      },
    },
    include: { items: { orderBy: { cantidad: "desc" } } },
  });
  const anulada = await prisma.venta.create({
    data: {
      anio: ANIO,
      numero: 9002,
      clienteId: cliente.id,
      fecha: fechaDesdeISO("2031-03-02"),
      estado: "ANULADA",
      items: { create: [renglon(artX.id, "1", "99999", "1")] },
    },
    include: { items: true },
  });
  const porCantidad = (c: string) => venta1.items.find((i) => i.cantidad.toString() === c)!;
  const [itemA, itemB, itemC, itemD] = [porCantidad("10"), porCantidad("5"), porCantidad("2"), porCantidad("1")];

  // A: fecha = primer dia de marzo (el filtro "desde" es inclusivo). Materiales 9.101, maquinas 7.500, mano de obra 3.000.
  const A = await prisma.trabajoProduccion.create({
    data: {
      ventaItemId: itemA!.id,
      fecha: fechaDesdeISO("2031-03-01"),
      minutosManoObra: "45",
      costoHoraManoObraSnapshot: "4000",
      consumos: {
        create: [
          { materialId: mat1.id, cantidad: "2", costoUnitarioSnapshot: "4200.50" },
          { materialId: mat2.id, cantidad: "0.5", costoUnitarioSnapshot: "1400" },
        ],
      },
      tiempos: {
        create: [
          { maquinaId: maq1.id, minutos: "90", costoHoraSnapshot: "3000" },
          { maquinaId: maq2.id, minutos: "30", costoHoraSnapshot: "6000" },
        ],
      },
    },
  });
  // Un trabajo ANULADO de la misma linea (con un costo enorme que no puede contar) y despues el vigente: asi se corrige.
  await prisma.trabajoProduccion.create({
    data: {
      ventaItemId: itemA!.id,
      fecha: fechaDesdeISO("2031-03-02"),
      anuladoEn: new Date(),
      motivoAnulacion: "Se cargo mal (prueba)",
      consumos: { create: [{ materialId: mat1.id, cantidad: "1000", costoUnitarioSnapshot: "5000" }] },
    },
  });
  // B: ultimo dia de marzo (incluido).
  await prisma.trabajoProduccion.create({
    data: {
      ventaItemId: itemB!.id,
      fecha: fechaDesdeISO("2031-03-31"),
      consumos: { create: [{ materialId: mat1.id, cantidad: "1", costoUnitarioSnapshot: "5000" }] },
    },
  });
  // C: primer dia de abril (hasta es exclusivo: no entra en marzo).
  await prisma.trabajoProduccion.create({
    data: {
      ventaItemId: itemC!.id,
      fecha: fechaDesdeISO("2031-04-01"),
      consumos: { create: [{ materialId: mat1.id, cantidad: "1", costoUnitarioSnapshot: "1000" }] },
    },
  });
  // D: mayo.
  await prisma.trabajoProduccion.create({
    data: {
      ventaItemId: itemD!.id,
      fecha: fechaDesdeISO("2031-05-15"),
      minutosManoObra: "60",
      costoHoraManoObraSnapshot: "4500",
    },
  });
  // De una venta ANULADA: vigente, en marzo, pero no cuenta.
  await prisma.trabajoProduccion.create({
    data: {
      ventaItemId: anulada.items[0]!.id,
      fecha: fechaDesdeISO("2031-03-10"),
      consumos: { create: [{ materialId: mat1.id, cantidad: "1", costoUnitarioSnapshot: "88888" }] },
    },
  });

  console.log("--- Marzo 2031: solo trabajos vigentes de ventas no anuladas, por fecha del trabajo ---");
  const marzo = await getMargenReal(rango("2031-03-01", "2031-03-31"));
  comprobar("la consulta uso la base (no el respaldo)", String(estadoDemo().activo), "false");
  comprobar("2 trabajos (A y B)", String(marzo.total.trabajos), "2");
  comprobar("ni el anulado, ni el de la venta anulada, ni abril, ni mayo", marzo.lineas.map((l) => l.id).includes(A.id) ? "A esta" : "falta A", "A esta");
  comprobar("total: precio, receta, real", [marzo.total.precioNeto, marzo.total.costoReceta, marzo.total.costoReal].map(texto).join(","), "40000,24000,24601");
  comprobar("total: desvio $ y %", `${texto(marzo.total.desvio)} ${texto(marzo.total.desvioPct)}`, "601 2.5");
  comprobar("total: margen estimado y real", `${texto(marzo.total.margenEstimadoPct)} ${texto(marzo.total.margenRealPct)}`, "40 38.5");
  const lineaA = marzo.lineas.find((l) => l.id === A.id)!;
  comprobar("A: desglose materiales / maquinas / mano de obra", [lineaA.desglose.materiales, lineaA.desglose.maquinas, lineaA.desglose.manoObra].map(texto).join(","), "9101,7500,3000");
  comprobar("A: real, desvio, margen real", [lineaA.costoReal, lineaA.desvio, lineaA.margenRealPct].map(texto).join(","), "19601,1601,34.66");
  comprobar("A: se identifica la venta y el articulo", `${lineaA.ventaNumero}/${lineaA.ventaAnio} ${lineaA.articuloNombre}`, `9001/${ANIO} ${artX.nombre}`);
  comprobar("un articulo, un mes", `${marzo.porArticulo.length} ${marzo.porPeriodo.map((p) => p.mes).join(",")}`, "1 2031-03");
  comprobar("el articulo es el de las lineas", marzo.porArticulo[0]!.nombre, artX.nombre);

  console.log("--- Marzo y abril ---");
  const abril = await getMargenReal(rango("2031-03-01", "2031-04-30"));
  comprobar("3 trabajos", String(abril.total.trabajos), "3");
  comprobar("total: desvio $ y %", `${texto(abril.total.desvio)} ${texto(abril.total.desvioPct)}`, "1601 6.67");
  comprobar("por mes", abril.porPeriodo.map((p) => `${p.mes}:${p.trabajos}`).join(","), "2031-03:2,2031-04:1");
  comprobar("por articulo (mayor sobrecosto primero)", abril.porArticulo.map((f) => f.nombre).join(","), `${artY.nombre},${artX.nombre}`);
  comprobar("articulo con receta 0: desvio % null", texto(abril.porArticulo[0]!.desvioPct), "null");
  const diaC = await getMargenReal(rango("2031-04-01", "2031-04-01"));
  comprobar("un solo dia (1/4): entra el trabajo de ese dia", String(diaC.total.trabajos), "1");

  console.log("--- Mayo: solo mano de obra ---");
  const mayo = await getMargenReal(rango("2031-05-01", "2031-05-31"));
  comprobar("1 trabajo, real = 60 min a 4.500", `${mayo.total.trabajos} ${texto(mayo.total.costoReal)}`, "1 4500");
  comprobar("desvio contra receta 3.000", `${texto(mayo.total.desvio)} ${texto(mayo.total.desvioPct)}`, "1500 50");

  console.log("--- Sin trabajos en el periodo ---");
  const vacio = await getMargenReal(rango("2031-06-01", "2031-06-30"));
  comprobar("0 trabajos", String(vacio.total.trabajos), "0");
  comprobar("sin porcentajes (null, no NaN)", [vacio.total.desvioPct, vacio.total.margenRealPct].map(texto).join(","), "null,null");
  comprobar("sin filas", `${vacio.porArticulo.length}${vacio.porPeriodo.length}${vacio.lineas.length}`, "000");

  console.log("--- Costos congelados: cambiar el precio del material o de la maquina no reescribe lo producido ---");
  await prisma.material.update({ where: { id: mat1.id }, data: { costoUnitario: "999999" } });
  await prisma.maquina.update({ where: { id: maq1.id }, data: { costoHora: "888888" } });
  const congelado = await getMargenReal(rango("2031-03-01", "2031-03-31"));
  comprobar("el costo real no cambia", texto(congelado.total.costoReal), "24601");

  console.log("--- Corregir = anular y recargar: el anulado no cuenta, el nuevo si ---");
  await prisma.trabajoProduccion.update({ where: { id: A.id }, data: { anuladoEn: new Date(), motivoAnulacion: "Se recarga (prueba)" } });
  await prisma.trabajoProduccion.create({
    data: {
      ventaItemId: itemA!.id,
      fecha: fechaDesdeISO("2031-03-03"),
      consumos: { create: [{ materialId: mat2.id, cantidad: "10", costoUnitarioSnapshot: "1800" }] },
    },
  });
  const recargado = await getMargenReal(rango("2031-03-01", "2031-03-31"));
  comprobar("siguen 2 trabajos y la linea A cuenta una sola vez", `${recargado.total.trabajos} ${recargado.lineas.filter((l) => l.precioNeto.eq(30000)).length}`, "2 1");
  comprobar("el real de la linea A es el recargado (18.000)", texto(recargado.lineas.find((l) => l.precioNeto.eq(30000))!.costoReal), "18000");
  comprobar("desvio de la linea recargada = 0 (sin desvio)", texto(recargado.lineas.find((l) => l.precioNeto.eq(30000))!.desvio), "0");
}

async function restaurar() {
  if (!original) return;
  for (const m of original.materiales) await prisma.material.update({ where: { id: m.id }, data: { costoUnitario: m.costoUnitario } });
  for (const m of original.maquinas) await prisma.maquina.update({ where: { id: m.id }, data: { costoHora: m.costoHora } });
}

main()
  .catch((error) => {
    fallos += 1;
    console.log("FALLA error inesperado:", error);
  })
  .finally(async () => {
    try {
      await restaurar();
      await limpiar();
    } catch (error) {
      fallos += 1;
      console.log("FALLA no se pudo limpiar:", error);
    }
    await prisma.$disconnect();
    console.log("");
    if (fallos > 0) {
      console.log(`${fallos} comprobacion(es) fallaron.`);
      process.exit(1);
    }
    console.log("Todas las comprobaciones pasaron.");
  });
