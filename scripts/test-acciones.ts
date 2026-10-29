/**
 * Prueba la logica de dominio de las acciones (compra, venta, anulacion y
 * ajuste) contra Postgres real, sin Next.
 *
 *   npm run test:acciones
 *
 * Usa la base de DATABASE_URL pero no deja rastro: cada escenario corre dentro
 * de una transaccion que se deshace al final, con sus propios datos de prueba.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d, type Dinero } from "../src/lib/money";
import { aDecimal, decimalPositivo, ErrorDeNegocio, hoyArgentinaISO } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import { registrarCompraEnTx } from "../src/lib/dominio/compras";
import { ajustarStockEnTx } from "../src/lib/dominio/stock";
import { anularVentaEnTx, registrarVentaEnTx } from "../src/lib/dominio/ventas";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

/** Espera un ErrorDeNegocio cuyo mensaje contenga `fragmento`. */
async function rechaza(etiqueta: string, fragmento: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "no lanzó error", `error "${fragmento}"`);
  } catch (error) {
    const ok = error instanceof ErrorDeNegocio && error.message.includes(fragmento);
    comprobar(etiqueta, ok ? "rechazada" : String(error), "rechazada");
  }
}

const num = (v: Dinero) => v.toString();

// ─── Helpers puros de las acciones ────────────────────────────────────────────

console.log("--- Helpers de acciones ---");
comprobar("coma decimal", aDecimal("1,5").toString(), "1.5");
comprobar("zod normaliza", String(decimalPositivo.parse(" 2,25 ")), "2.25");
comprobar("zod rechaza 0", String(decimalPositivo.safeParse("0").success), "false");
comprobar("zod rechaza miles", String(decimalPositivo.safeParse("1.500,00").success), "false");
// 02:00 UTC del 1/3 todavia es 28/2 en Argentina (UTC-3).
comprobar("hoy en Argentina", hoyArgentinaISO(new Date("2026-03-01T02:00:00Z")), "2026-02-28");

// ─── Contra la base ───────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

class Deshacer extends Error {}

/** Corre `fn` en una transaccion que siempre se deshace. */
async function escenario(titulo: string, fn: (tx: Tx) => Promise<void>) {
  console.log(`--- ${titulo} ---`);
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Deshacer();
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Deshacer)) {
      fallos += 1;
      console.log("FALLA error inesperado:", error);
    }
  }
}

/**
 * Un comercio minimo: dos materiales (A con stock de sobra, B con poco), un
 * articulo con receta, un servicio y un cliente. Mano de obra a $1.000/h.
 */
async function preparar(tx: Tx) {
  await tx.configuracion.upsert({
    where: { clave: "costoHoraManoObra" },
    update: { valor: "1000" },
    create: { clave: "costoHoraManoObra", valor: "1000" },
  });
  const a = await tx.material.create({
    data: { nombre: "Prueba A", unidad: "M2", stockActual: d(10), costoUnitario: d(100) },
  });
  const b = await tx.material.create({
    data: { nombre: "Prueba B", unidad: "U", stockActual: d(1), costoUnitario: d(50) },
  });
  const baja = await tx.material.create({
    data: { nombre: "Prueba de baja", unidad: "U", costoUnitario: d(1), activo: false },
  });
  const articulo = await tx.articulo.create({
    data: {
      nombre: "Artículo de prueba",
      precioVenta: d(1210),
      ivaPct: d(21),
      receta: {
        create: {
          componentes: {
            create: [
              { tipo: "MATERIAL", materialId: a.id, cantidad: d(2) },
              { tipo: "MATERIAL", materialId: b.id, cantidad: d(1) },
              { tipo: "MANO_OBRA", cantidad: d("0.5") },
            ],
          },
        },
      },
    },
  });
  const servicio = await tx.articulo.create({
    data: { nombre: "Servicio de prueba", precioVenta: d(500), esServicio: true },
  });
  const cliente = await tx.cliente.create({ data: { nombre: "Cliente de prueba" } });
  const clienteBaja = await tx.cliente.create({ data: { nombre: "Cliente de baja", activo: false } });
  return { a, b, baja, articulo, servicio, cliente, clienteBaja };
}

const stock = async (tx: Tx, id: string) =>
  num((await tx.material.findUniqueOrThrow({ where: { id } })).stockActual);

const hoy = new Date(`${hoyArgentinaISO()}T00:00:00Z`);

async function main() {
  await escenario("Compra: suma stock, actualiza costo y deja movimiento", async (tx) => {
    const { a, baja } = await preparar(tx);
    const { id } = await registrarCompraEnTx(tx, {
      fecha: hoy,
      proveedor: "Proveedor de prueba",
      comprobante: null,
      notas: null,
      actualizarCosto: true,
      items: [{ materialId: a.id, cantidad: d(5), costoUnitario: d("120.5") }],
    });
    const compra = await tx.compra.findUniqueOrThrow({ where: { id } });
    const material = await tx.material.findUniqueOrThrow({ where: { id: a.id } });
    const movs = await tx.movimientoStock.findMany({ where: { compraId: id } });
    comprobar("total", num(compra.total), "602.5");
    comprobar("stock", num(material.stockActual), "15");
    comprobar("costo actualizado", num(material.costoUnitario), "120.5");
    comprobar("movimientos", String(movs.length), "1");
    comprobar("movimiento +5 → 15", `${num(movs[0]!.cantidad)} → ${num(movs[0]!.stockResultante)}`, "5 → 15");

    await registrarCompraEnTx(tx, {
      fecha: hoy,
      proveedor: "Otro",
      comprobante: null,
      notas: null,
      actualizarCosto: false,
      items: [{ materialId: a.id, cantidad: d(1), costoUnitario: d(999) }],
    });
    comprobar("sin actualizar costo", num((await tx.material.findUniqueOrThrow({ where: { id: a.id } })).costoUnitario), "120.5");

    await rechaza("material de baja", "dado de baja", () =>
      registrarCompraEnTx(tx, {
        fecha: hoy,
        proveedor: "X",
        comprobante: null,
        notas: null,
        actualizarCosto: false,
        items: [{ materialId: baja.id, cantidad: d(1), costoUnitario: d(1) }],
      }),
    );
  });

  await escenario("Venta: totales, costo congelado, stock, pago y faltante", async (tx) => {
    const { a, b, articulo, servicio, cliente, clienteBaja } = await preparar(tx);
    const anio = hoy.getUTCFullYear();
    const previo = (await tx.venta.aggregate({ where: { anio }, _max: { numero: true } }))._max.numero ?? 0;

    const r = await registrarVentaEnTx(tx, {
      clienteId: cliente.id,
      fecha: hoy,
      observaciones: null,
      entregada: false,
      items: [
        { articuloId: articulo.id, cantidad: d(2) },
        { articuloId: servicio.id, cantidad: d(1) },
      ],
      pago: { monto: d(1000), metodo: "EFECTIVO" },
    });
    const venta = await tx.venta.findUniqueOrThrow({ where: { id: r.id }, include: { items: true, pagos: true } });
    comprobar("numero correlativo", String(r.numero), String(previo + 1));
    comprobar("bruto", num(venta.totalBruto), "2920");
    comprobar("neto", num(venta.totalNeto), "2413.22");
    comprobar("IVA", num(venta.totalIVA), "506.78");
    // 2 m2 de A a $100 + 1 u de B a $50 + 0,5 h a $1.000 = $750 por unidad.
    const item = venta.items.find((i) => i.articuloId === articulo.id)!;
    comprobar("costo unitario congelado", num(item.costoUnitarioSnapshot), "750");
    comprobar("costo total", num(venta.costoTotal), "1500");
    comprobar("estado", venta.estado, "PENDIENTE");
    comprobar("pago inicial", venta.pagos.map((p) => num(p.monto)).join(","), "1000");
    comprobar("stock A (10 − 4)", await stock(tx, a.id), "6");
    comprobar("stock B (1 − 1, faltó 1)", await stock(tx, b.id), "0");
    comprobar("advertencias", String(r.advertencias.length), "1");
    const movs = await tx.movimientoStock.findMany({ where: { ventaId: r.id } });
    comprobar("movimientos (el servicio no descuenta)", String(movs.length), "2");

    // El costo congelado no cambia si sube el material.
    await tx.material.update({ where: { id: a.id }, data: { costoUnitario: d(500) } });
    const congelado = await tx.ventaItem.findUniqueOrThrow({ where: { id: item.id } });
    comprobar("snapshot tras subir el material", num(congelado.costoUnitarioSnapshot), "750");

    await rechaza("pago mayor al total", "no puede superar", () =>
      registrarVentaEnTx(tx, {
        clienteId: cliente.id,
        fecha: hoy,
        observaciones: null,
        entregada: true,
        items: [{ articuloId: servicio.id, cantidad: d(1) }],
        pago: { monto: d("500.02"), metodo: "EFECTIVO" },
      }),
    );
    await rechaza("cliente de baja", "dado de baja", () =>
      registrarVentaEnTx(tx, {
        clienteId: clienteBaja.id,
        fecha: hoy,
        observaciones: null,
        entregada: true,
        items: [{ articuloId: servicio.id, cantidad: d(1) }],
        pago: null,
      }),
    );
  });

  await escenario("Anulación: devuelve exactamente lo que salió", async (tx) => {
    const { a, b, articulo, cliente } = await preparar(tx);
    const r = await registrarVentaEnTx(tx, {
      clienteId: cliente.id,
      fecha: hoy,
      observaciones: null,
      entregada: true,
      items: [{ articuloId: articulo.id, cantidad: d(3) }],
      pago: null,
    });
    comprobar("stock A tras vender", await stock(tx, a.id), "4");
    comprobar("stock B tras vender (faltaron 2)", await stock(tx, b.id), "0");

    // Si la receta cambia despues, igual vuelve lo que realmente salio.
    await tx.recetaComponente.updateMany({ where: { materialId: a.id }, data: { cantidad: d(9) } });
    await anularVentaEnTx(tx, r.id);
    const venta = await tx.venta.findUniqueOrThrow({ where: { id: r.id } });
    comprobar("estado", venta.estado, "ANULADA");
    comprobar("stock A restaurado", await stock(tx, a.id), "10");
    comprobar("stock B restaurado (solo lo descontado)", await stock(tx, b.id), "1");
    const movs = await tx.movimientoStock.findMany({ where: { ventaId: r.id } });
    comprobar("movimientos (2 salidas + 2 devoluciones)", String(movs.length), "4");
    await rechaza("anular dos veces", "ya estaba anulada", () => anularVentaEnTx(tx, r.id));
  });

  await escenario("Ajuste por conteo", async (tx) => {
    const { a } = await preparar(tx);
    const { diferencia } = await ajustarStockEnTx(tx, { materialId: a.id, stockContado: d("8.5"), motivo: "Conteo" });
    comprobar("diferencia", num(diferencia), "-1.5");
    comprobar("stock", await stock(tx, a.id), "8.5");
    const mov = await tx.movimientoStock.findFirstOrThrow({ where: { materialId: a.id, tipo: "AJUSTE" } });
    comprobar("movimiento", `${num(mov.cantidad)} → ${num(mov.stockResultante)}`, "-1.5 → 8.5");
    await rechaza("conteo igual al sistema", "no hay nada que ajustar", () =>
      ajustarStockEnTx(tx, { materialId: a.id, stockContado: d("8.5"), motivo: "Otra vez" }),
    );
  });

  console.log("");
  console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
}

main()
  .catch((error) => {
    console.error(error);
    fallos += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fallos === 0 ? 0 : 1);
  });
