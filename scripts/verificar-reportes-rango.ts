/**
 * Cuadra los reportes de /reportes contra SQL puro, para varios rangos.
 *
 *   npx tsx scripts/verificar-reportes-rango.ts
 *
 * SOLO LECTURA contra la base de DATABASE_URL (no escribe nada). Para cada
 * rango llama a las funciones de `queries/dashboard.ts` (las mismas que usa la
 * pantalla) y compara con sumas en SQL escritas aparte, con el filtro
 * formulado distinto (`fecha BETWEEN desde AND hasta` inclusivo, contra el
 * `gte/lt` exclusivo de Prisma), asi un error de borde se nota.
 *
 * Los rangos dependen de que la base tenga ventas en octubre de 2026 (seed).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { d, type Dinero } from "../src/lib/money";
import { parseRangoFechas, type ParamsFecha } from "../src/lib/rango-fechas";
import {
  getConsumoMateriales,
  getGananciaPorProducto,
  getResumenPeriodo,
  pendienteTotal,
} from "../src/lib/queries/dashboard";

let fallos = 0;
let comprobaciones = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  comprobaciones += 1;
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "OK   " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (SQL dice ${esperado})`}`);
}

const m2 = (v: Dinero) => v.toFixed(2);
const m3 = (v: Dinero) => v.toFixed(3);
const suma = (xs: Dinero[]) => xs.reduce((a, b) => a.plus(b), d(0));

type Caso = { nombre: string; params: ParamsFecha; ventasEsperadas?: number };

const CASOS: Caso[] = [
  { nombre: "Mes completo del seed (2026-10)", params: { mes: "2026-10" }, ventasEsperadas: 7 },
  { nombre: "Rango parcial 14/10 a 23/10 (ambos bordes con venta)", params: { desde: "2026-10-14", hasta: "2026-10-23" }, ventasEsperadas: 4 },
  { nombre: "Un solo dia, el ultimo con venta (27/10)", params: { desde: "2026-10-27", hasta: "2026-10-27" }, ventasEsperadas: 1 },
  { nombre: "Rango al reves (23/10 a 14/10, se intercambia)", params: { desde: "2026-10-23", hasta: "2026-10-14" }, ventasEsperadas: 4 },
  { nombre: "Rango sin ventas, entre dos ventas (10/10 a 13/10)", params: { desde: "2026-10-10", hasta: "2026-10-13" }, ventasEsperadas: 0 },
  { nombre: "Mes sin ventas (2026-01)", params: { mes: "2026-01" }, ventasEsperadas: 0 },
];

async function sqlPeriodo(desdeISO: string, hastaISO: string) {
  const [venta] = await prisma.$queryRaw<{ n: bigint; bruto: string; neto: string; iva: string; costo: string }[]>`
    SELECT count(*) AS n,
           coalesce(sum("totalBruto"), 0)::text AS bruto,
           coalesce(sum("totalNeto"), 0)::text AS neto,
           coalesce(sum("totalIVA"), 0)::text AS iva,
           coalesce(sum("costoTotal"), 0)::text AS costo
    FROM ventas
    WHERE estado <> 'ANULADA' AND fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date`;
  const [pagos] = await prisma.$queryRaw<{ monto: string }[]>`
    SELECT coalesce(sum(p.monto), 0)::text AS monto
    FROM pagos p JOIN ventas v ON v.id = p."ventaId"
    WHERE p."anuladoEn" IS NULL AND v.estado <> 'ANULADA'
      AND p.fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date`;
  const [items] = await prisma.$queryRaw<{ cant: string; bruto: string; costo: string; arts: bigint }[]>`
    SELECT coalesce(sum(i.cantidad), 0)::text AS cant,
           coalesce(sum(i."subtotalBruto"), 0)::text AS bruto,
           coalesce(sum(i."costoTotalSnapshot"), 0)::text AS costo,
           count(DISTINCT i."articuloId") AS arts
    FROM venta_items i JOIN ventas v ON v.id = i."ventaId"
    WHERE v.estado <> 'ANULADA' AND v.fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date`;
  const consumo = await prisma.$queryRaw<{ id: string; cant: string }[]>`
    SELECT m."materialId" AS id, (-sum(m.cantidad))::text AS cant
    FROM movimientos_stock m JOIN ventas v ON v.id = m."ventaId"
    WHERE m.tipo = 'VENTA' AND v.estado <> 'ANULADA'
      AND v.fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date
    GROUP BY m."materialId" HAVING sum(m.cantidad) <> 0`;
  const [pend] = await prisma.$queryRaw<{ saldo: string }[]>`
    SELECT greatest(
      (SELECT coalesce(sum("totalBruto"), 0) FROM ventas WHERE estado <> 'ANULADA')
      - (SELECT coalesce(sum(p.monto), 0) FROM pagos p JOIN ventas v ON v.id = p."ventaId"
         WHERE p."anuladoEn" IS NULL AND v.estado <> 'ANULADA'), 0)::text AS saldo`;
  // Cada agregado sin GROUP BY devuelve siempre una fila.
  return { venta: venta!, pagos: pagos!, items: items!, consumo, pend: pend! };
}

async function main() {
  console.log(`Hoy (servidor): ${new Date().toISOString()}`);
  const totalesPorCaso: string[] = [];

  for (const caso of CASOS) {
    const rango = parseRangoFechas(caso.params);
    console.log(`\n${caso.nombre}\n  rango: ${rango.etiqueta} [${rango.desdeISO} .. ${rango.hastaISO}] avisos=${rango.avisos.length}`);

    const sql = await sqlPeriodo(rango.desdeISO, rango.hastaISO);
    const [resumen, productos, consumo] = await Promise.all([
      getResumenPeriodo(rango),
      getGananciaPorProducto(rango),
      getConsumoMateriales(rango),
    ]);

    // 1. Resumen
    comprobar("resumen: cantidad de ventas", String(resumen.cantidadVentas), String(sql.venta.n));
    comprobar("resumen: facturado bruto", m2(resumen.facturadoBruto), m2(d(sql.venta.bruto)));
    comprobar("resumen: neto", m2(resumen.facturadoNeto), m2(d(sql.venta.neto)));
    comprobar("resumen: IVA", m2(resumen.iva), m2(d(sql.venta.iva)));
    comprobar("resumen: costo", m2(resumen.costoTotal), m2(d(sql.venta.costo)));
    comprobar("resumen: ganancia (bruto - costo)", m2(resumen.ganancia), m2(d(sql.venta.bruto).minus(sql.venta.costo)));
    comprobar("resumen: cobrado en el periodo", m2(resumen.cobrado), m2(d(sql.pagos.monto)));
    comprobar("resumen: pendiente a hoy", m2(resumen.pendienteCobro), m2(d(sql.pend.saldo)));
    comprobar("pendienteTotal() = a hoy", m2(await pendienteTotal()), m2(d(sql.pend.saldo)));
    if (caso.ventasEsperadas !== undefined) {
      comprobar("ventas esperadas por diseno del caso", String(resumen.cantidadVentas), String(caso.ventasEsperadas));
    }

    // 2/5. Ganancia por producto: la suma de las filas debe dar el resumen y el SQL
    comprobar("productos: filas (articulos distintos)", String(productos.length), String(sql.items.arts));
    comprobar("productos: sum facturado", m2(suma(productos.map((p) => p.facturado))), m2(d(sql.items.bruto)));
    comprobar("productos: sum costo", m2(suma(productos.map((p) => p.costo))), m2(d(sql.items.costo)));
    comprobar("productos: sum unidades", m3(suma(productos.map((p) => p.unidades))), m3(d(sql.items.cant)));
    comprobar("productos: sum facturado = resumen.facturadoBruto", m2(suma(productos.map((p) => p.facturado))), m2(resumen.facturadoBruto));
    comprobar("productos: sum ganancia = resumen.ganancia", m2(suma(productos.map((p) => p.ganancia))), m2(resumen.ganancia));

    // 4. Consumo de materiales
    const esperadoConsumo = new Map(sql.consumo.map((c) => [c.id, d(c.cant)]));
    comprobar("consumo: materiales distintos", String(consumo.length), String(esperadoConsumo.size));
    const sumaConsumo = suma(consumo.map((c) => c.cantidad));
    comprobar("consumo: sum cantidades", m3(sumaConsumo), m3(suma([...esperadoConsumo.values()])));
    for (const c of consumo) {
      const esperado = esperadoConsumo.get(c.materialId);
      if (!esperado || !c.cantidad.eq(esperado)) {
        comprobar(`consumo: ${c.nombre}`, m3(c.cantidad), esperado ? m3(esperado) : "(no esta en SQL)");
      }
    }

    totalesPorCaso.push(
      `${caso.nombre}: ${resumen.cantidadVentas} ventas, facturado ${m2(resumen.facturadoBruto)}, costo ${m2(resumen.costoTotal)}, cobrado ${m2(resumen.cobrado)}, consumo ${consumo.length} materiales`,
    );
  }

  console.log("\nResumen de totales");
  for (const t of totalesPorCaso) console.log(`  ${t}`);
  console.log(`\n${comprobaciones} comprobaciones, ${fallos} fallos`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
