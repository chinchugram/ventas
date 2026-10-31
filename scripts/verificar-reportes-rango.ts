/**
 * Cuadra los reportes de /reportes contra SQL puro, para varios rangos.
 *
 *   npx tsx scripts/verificar-reportes-rango.ts
 *
 * Parte 1, SOLO LECTURA contra la base de DATABASE_URL (rol `ventas_app`, con RLS). Para
 * cada rango llama a las funciones de `queries/dashboard.ts` (las mismas que usa la
 * pantalla, con el `negocioId` del negocio del seed: slug `hl-laser`, o NEGOCIO_SLUG) y
 * compara con sumas en SQL escritas aparte, con el filtro formulado distinto
 * (`fecha BETWEEN desde AND hasta` inclusivo, contra el `gte/lt` exclusivo de Prisma) y
 * con el negocio filtrado a mano, asi un error de borde se nota.
 *
 * Parte 2, AISLAMIENTO entre negocios (F3.5). Si hay DATABASE_URL_MIGRACIONES (rol
 * `ventas_migrador`, solo Postgres local), siembra un negocio B con numeros distintos
 * (venta de 98.765,43 el 15/10/2026, deuda, consumo, meta de margen 77) y comprueba:
 *   - los reportes de A dan EXACTAMENTE lo mismo antes y despues de existir B;
 *   - los de B dan sus propios numeros, sin nada de A;
 *   - deudas, ultimas ventas, facturado por dia y pendiente no cruzan de un lado al otro.
 * Despues borra B. Sin esa variable la parte 2 se omite.
 *
 * Los rangos dependen de que la base tenga ventas en octubre de 2026 (seed).
 */
import "dotenv/config";
import { Client } from "pg";
import { prisma } from "../src/lib/prisma";
import { conNegocio, type TxNegocio } from "../src/lib/negocio";
import { d, type Dinero } from "../src/lib/money";
import { parseRangoFechas, type ParamsFecha } from "../src/lib/rango-fechas";
import {
  getConsumoMateriales,
  getDeudas,
  getFacturadoPorDia,
  getGananciaPorProducto,
  getResumenPeriodo,
  getUltimasVentas,
  pendienteTotal,
} from "../src/lib/queries/dashboard";

let fallos = 0;
let comprobaciones = 0;

const SLUG_A = process.env.NEGOCIO_SLUG ?? "hl-laser";
const SLUG_B = "test-reportes-b";

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

async function sqlPeriodo(negocioId: string, desdeISO: string, hastaISO: string) {
  // Las sumas van dentro de `conNegocio` (RLS) Y con el negocio filtrado a mano: la
  // comprobacion no depende de que la politica este bien para dar el numero esperado.
  return conNegocio(negocioId, async (tx) => {
    const [venta] = await tx.$queryRaw<{ n: bigint; bruto: string; neto: string; iva: string; costo: string }[]>`
      SELECT count(*) AS n,
             coalesce(sum("totalBruto"), 0)::text AS bruto,
             coalesce(sum("totalNeto"), 0)::text AS neto,
             coalesce(sum("totalIVA"), 0)::text AS iva,
             coalesce(sum("costoTotal"), 0)::text AS costo
      FROM ventas
      WHERE "negocioId" = ${negocioId}::uuid
        AND estado <> 'ANULADA' AND fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date`;
    const [pagos] = await tx.$queryRaw<{ monto: string }[]>`
      SELECT coalesce(sum(p.monto), 0)::text AS monto
      FROM pagos p JOIN ventas v ON v.id = p."ventaId"
      WHERE p."negocioId" = ${negocioId}::uuid AND p."anuladoEn" IS NULL AND v.estado <> 'ANULADA'
        AND p.fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date`;
    const [items] = await tx.$queryRaw<{ cant: string; bruto: string; costo: string; arts: bigint }[]>`
      SELECT coalesce(sum(i.cantidad), 0)::text AS cant,
             coalesce(sum(i."subtotalBruto"), 0)::text AS bruto,
             coalesce(sum(i."costoTotalSnapshot"), 0)::text AS costo,
             count(DISTINCT i."articuloId") AS arts
      FROM venta_items i JOIN ventas v ON v.id = i."ventaId"
      WHERE i."negocioId" = ${negocioId}::uuid
        AND v.estado <> 'ANULADA' AND v.fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date`;
    const consumo = await tx.$queryRaw<{ id: string; cant: string }[]>`
      SELECT m."materialId" AS id, (-sum(m.cantidad))::text AS cant
      FROM movimientos_stock m JOIN ventas v ON v.id = m."ventaId"
      WHERE m."negocioId" = ${negocioId}::uuid AND m.tipo = 'VENTA' AND v.estado <> 'ANULADA'
        AND v.fecha BETWEEN ${desdeISO}::date AND ${hastaISO}::date
      GROUP BY m."materialId" HAVING sum(m.cantidad) <> 0`;
    const [pend] = await tx.$queryRaw<{ saldo: string }[]>`
      SELECT greatest(
        (SELECT coalesce(sum("totalBruto"), 0) FROM ventas WHERE "negocioId" = ${negocioId}::uuid AND estado <> 'ANULADA')
        - (SELECT coalesce(sum(p.monto), 0) FROM pagos p JOIN ventas v ON v.id = p."ventaId"
           WHERE p."negocioId" = ${negocioId}::uuid AND p."anuladoEn" IS NULL AND v.estado <> 'ANULADA'), 0)::text AS saldo`;
    // Cada agregado sin GROUP BY devuelve siempre una fila.
    return { venta: venta!, pagos: pagos!, items: items!, consumo, pend: pend! };
  });
}

/** Todo lo que muestran los reportes de un negocio para un rango, en texto comparable. */
async function fotoDeReportes(negocioId: string, params: ParamsFecha): Promise<string> {
  const rango = parseRangoFechas(params);
  const [resumen, productos, consumo] = await Promise.all([
    getResumenPeriodo(negocioId, rango),
    getGananciaPorProducto(negocioId, rango),
    getConsumoMateriales(negocioId, rango),
  ]);
  return JSON.stringify({
    resumen: [resumen.cantidadVentas, m2(resumen.facturadoBruto), m2(resumen.costoTotal), m2(resumen.cobrado), m2(resumen.pendienteCobro), m2(resumen.metaMargenPct)],
    productos: productos.map((p) => [p.nombre, m3(p.unidades), m2(p.facturado), m2(p.costo)]),
    consumo: consumo.map((c) => [c.nombre, m3(c.cantidad), m2(c.costoEstimado)]),
  });
}

async function negocioPorSlug(slug: string): Promise<string | null> {
  // `negocios` es la tabla global: la app la lee sin contexto.
  return (await prisma.negocio.findUnique({ where: { slug }, select: { id: true } }))?.id ?? null;
}

async function parteReportes(negocioId: string) {
  console.log(`Hoy (servidor): ${new Date().toISOString()}`);
  const totalesPorCaso: string[] = [];

  for (const caso of CASOS) {
    const rango = parseRangoFechas(caso.params);
    console.log(`\n${caso.nombre}\n  rango: ${rango.etiqueta} [${rango.desdeISO} .. ${rango.hastaISO}] avisos=${rango.avisos.length}`);

    const sql = await sqlPeriodo(negocioId, rango.desdeISO, rango.hastaISO);
    const [resumen, productos, consumo] = await Promise.all([
      getResumenPeriodo(negocioId, rango),
      getGananciaPorProducto(negocioId, rango),
      getConsumoMateriales(negocioId, rango),
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
    comprobar("pendienteTotal() = a hoy", m2(await pendienteTotal(negocioId)), m2(d(sql.pend.saldo)));
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
}

// ─── Parte 2: aislamiento entre negocios ─────────────────────────────────────

function esLocal(url: string): boolean {
  try {
    const u = new URL(url);
    const socket = u.searchParams.get("host");
    if (socket) return socket.startsWith("/");
    return ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Orden de borrado (hijos antes que padres) de lo que siembra el negocio B. */
const BORRADO_B = ["movimientos_stock", "pagos", "venta_items", "ventas", "clientes", "articulos", "materiales", "configuracion"];

/**
 * Siembra el negocio B con numeros que no se parecen a los de A. Todo en octubre de 2026:
 *   - venta 1 (15/10): 98.765,43 bruto, costo 40.000,01, pagada 10.000,00 -> debe 88.765,43
 *   - venta 2 (20/10): ANULADA, 5.555,55 (no debe contar en nada)
 *   - consumo: 3,5 unidades del material "Material B" (costo unitario 1.234,56)
 */
async function sembrarB(mig: Client): Promise<string> {
  const id = (await mig.query<{ id: string }>(
    `INSERT INTO negocios (id, nombre, slug, "actualizadoEn") VALUES (gen_random_uuid(), 'Negocio B (test reportes)', $1, now()) RETURNING id`,
    [SLUG_B],
  )).rows[0]!.id;
  await mig.query("BEGIN");
  try {
    await mig.query(
      `
      WITH
      cli AS (INSERT INTO clientes (id, "negocioId", nombre, "actualizadoEn") VALUES (gen_random_uuid(), $1, 'Cliente Solo De B', now()) RETURNING id),
      art AS (INSERT INTO articulos (id, "negocioId", nombre, "precioVenta", "actualizadoEn") VALUES (gen_random_uuid(), $1, 'Articulo Solo De B', 98765.43, now()) RETURNING id),
      mat AS (INSERT INTO materiales (id, "negocioId", nombre, unidad, "stockActual", "stockMinimo", "costoUnitario", "actualizadoEn")
                VALUES (gen_random_uuid(), $1, 'Material B', 'M2', 50, 1, 1234.56, now()) RETURNING id),
      v1 AS (INSERT INTO ventas (id, "negocioId", numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "actualizadoEn")
               SELECT gen_random_uuid(), $1, 1, 2026, cli.id, '2026-10-15', 'PENDIENTE', 81624.32, 17141.11, 98765.43, 40000.01, now() FROM cli RETURNING id),
      v2 AS (INSERT INTO ventas (id, "negocioId", numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "actualizadoEn")
               SELECT gen_random_uuid(), $1, 2, 2026, cli.id, '2026-10-20', 'ANULADA', 4591.36, 964.19, 5555.55, 2000, now() FROM cli RETURNING id),
      i1 AS (INSERT INTO venta_items (id, "negocioId", "ventaId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIVA", "subtotalBruto", "costoUnitarioSnapshot", "costoTotalSnapshot")
               SELECT gen_random_uuid(), $1, v1.id, art.id, 'Articulo Solo De B', 2.500, 39506.172, 21, 81624.32, 17141.11, 98765.43, 16000.004, 40000.01 FROM v1, art RETURNING id),
      i2 AS (INSERT INTO venta_items (id, "negocioId", "ventaId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIVA", "subtotalBruto", "costoUnitarioSnapshot", "costoTotalSnapshot")
               SELECT gen_random_uuid(), $1, v2.id, art.id, 'Articulo Solo De B', 1, 5555.55, 21, 4591.36, 964.19, 5555.55, 2000, 2000 FROM v2, art RETURNING id),
      pg AS (INSERT INTO pagos (id, "negocioId", "ventaId", "clienteId", fecha, monto, "actualizadoEn")
               SELECT gen_random_uuid(), $1, v1.id, cli.id, '2026-10-16', 10000.00, now() FROM v1, cli RETURNING id)
      INSERT INTO movimientos_stock (id, "negocioId", "materialId", tipo, cantidad, "stockResultante", "ventaId")
        SELECT gen_random_uuid(), $1, mat.id, 'VENTA', -3.5, 46.5, v1.id FROM mat, v1`,
      [id],
    );
    await mig.query(`INSERT INTO configuracion ("negocioId", clave, valor) VALUES ($1, 'margenObjetivo', '77')`, [id]);
    await mig.query("COMMIT");
  } catch (e) {
    await mig.query("ROLLBACK");
    await limpiarB(mig);
    throw e;
  }
  return id;
}

async function limpiarB(mig: Client) {
  const ids = (await mig.query<{ id: string }>(`SELECT id FROM negocios WHERE slug = $1`, [SLUG_B])).rows.map((x) => x.id);
  if (ids.length === 0) return;
  for (const t of BORRADO_B) await mig.query(`DELETE FROM "${t}" WHERE "negocioId" = ANY($1::uuid[])`, [ids]);
  await mig.query(`DELETE FROM negocios WHERE id = ANY($1::uuid[])`, [ids]);
}

const DESDE_ANIO = new Date(Date.UTC(2026, 0, 1));

async function parteAislamiento(idA: string, urlMig: string) {
  console.log("\n══ Aislamiento entre negocios ══");
  const mig = new Client({ connectionString: urlMig });
  await mig.connect();
  try {
    await limpiarB(mig);
    const fotoDeudas = async (id: string) => JSON.stringify((await getDeudas(id)).map((x) => [x.nombre, m2(x.saldo)]));
    const fotoUltimas = async (id: string) => JSON.stringify((await getUltimasVentas(id, 100)).map((v) => [v.numero, m2(v.totalBruto)]));
    const fotoDias = async (id: string) => JSON.stringify((await getFacturadoPorDia(id, DESDE_ANIO)).map((f) => [f.dia, m2(f.total)]).sort());

    const antes = await Promise.all(CASOS.map((c) => fotoDeReportes(idA, c.params)));
    const deudasAntes = await fotoDeudas(idA);
    const ultimasAntes = await fotoUltimas(idA);
    const diasAntes = await fotoDias(idA);
    const pendienteAntes = m2(await pendienteTotal(idA));

    const idB = await sembrarB(mig);
    try {
      console.log("\nNegocio A despues de sembrar B (tiene que ser identico a antes)");
      for (const [i, caso] of CASOS.entries()) {
        comprobar(`A sin cambios: ${caso.nombre}`, await fotoDeReportes(idA, caso.params), antes[i]!);
      }
      comprobar("A sin cambios: deudas", await fotoDeudas(idA), deudasAntes);
      comprobar("A sin cambios: ultimas ventas", await fotoUltimas(idA), ultimasAntes);
      comprobar("A sin cambios: facturado por dia", await fotoDias(idA), diasAntes);
      comprobar("A sin cambios: pendiente total", m2(await pendienteTotal(idA)), pendienteAntes);
      comprobar("A no ve al cliente de B en las deudas", String((await getDeudas(idA)).some((x) => x.nombre === "Cliente Solo De B")), "false");
      const rangoOct = parseRangoFechas({ mes: "2026-10" });
      comprobar("A no ve el articulo de B", String((await getGananciaPorProducto(idA, rangoOct)).some((p) => p.nombre === "Articulo Solo De B")), "false");
      comprobar("A no ve el material de B", String((await getConsumoMateriales(idA, rangoOct)).some((c) => c.nombre === "Material B")), "false");

      console.log("\nNegocio B: sus propios numeros");
      const resB = await getResumenPeriodo(idB, rangoOct);
      comprobar("B: 1 venta en octubre (la anulada no cuenta)", String(resB.cantidadVentas), "1");
      comprobar("B: facturado bruto", m2(resB.facturadoBruto), "98765.43");
      comprobar("B: costo", m2(resB.costoTotal), "40000.01");
      comprobar("B: ganancia", m2(resB.ganancia), "58765.42");
      comprobar("B: cobrado", m2(resB.cobrado), "10000.00");
      comprobar("B: pendiente de cobro", m2(resB.pendienteCobro), "88765.43");
      comprobar("B: meta de margen propia (config por negocio)", m2(resB.metaMargenPct), "77.00");
      comprobar("pendienteTotal(B)", m2(await pendienteTotal(idB)), "88765.43");
      const prodB = await getGananciaPorProducto(idB, rangoOct);
      comprobar("B: un solo articulo", prodB.map((p) => p.nombre).join(","), "Articulo Solo De B");
      comprobar("B: unidades", m3(prodB[0]!.unidades), "2.500");
      comprobar("B: facturado del articulo", m2(prodB[0]!.facturado), "98765.43");
      const consB = await getConsumoMateriales(idB, rangoOct);
      comprobar("B: consumo = 3,5 de Material B", consB.map((c) => `${c.nombre}:${m3(c.cantidad)}`).join(","), "Material B:3.500");
      comprobar("B: costo estimado del consumo", m2(consB[0]!.costoEstimado), "4320.96");
      const deudasB = await getDeudas(idB);
      comprobar("B: deuda de un solo cliente", deudasB.map((x) => `${x.nombre}:${m2(x.saldo)}`).join(","), "Cliente Solo De B:88765.43");
      const ultB = await getUltimasVentas(idB, 100);
      comprobar("B: ultimas ventas = solo la no anulada", ultB.map((v) => `${v.numero}:${m2(v.totalBruto)}`).join(","), "1:98765.43");
      const diaB = await getFacturadoPorDia(idB, DESDE_ANIO);
      comprobar("B: facturado por dia", diaB.map((f) => `${f.dia}:${m2(f.total)}`).join(","), "2026-10-15:98765.43");
      comprobar("B: mes sin ventas da cero", m2((await getResumenPeriodo(idB, parseRangoFechas({ mes: "2026-01" }))).facturadoBruto), "0.00");
    } finally {
      await limpiarB(mig);
    }
    comprobar("B se borro al terminar", String((await mig.query(`SELECT 1 FROM negocios WHERE slug = $1`, [SLUG_B])).rowCount), "0");
  } finally {
    await mig.end();
  }
}

async function main() {
  const idA = await negocioPorSlug(SLUG_A);
  if (!idA) throw new Error(`No existe el negocio "${SLUG_A}" (correr el seed).`);
  console.log(`Negocio A: ${SLUG_A} (${idA})`);
  await parteReportes(idA);

  const urlMig = process.env.DATABASE_URL_MIGRACIONES ?? "";
  if (urlMig && esLocal(urlMig) && esLocal(process.env.DATABASE_URL ?? "")) {
    await parteAislamiento(idA, urlMig);
  } else {
    console.log("\nAislamiento omitido: hace falta DATABASE_URL_MIGRACIONES apuntando a Postgres local.");
  }

  console.log(`\n${comprobaciones} comprobaciones, ${fallos} fallos`);
  await prisma.$disconnect();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
