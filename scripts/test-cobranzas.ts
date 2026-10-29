/**
 * Prueba la logica de cobranzas (registrar y anular pagos, marcar entregada)
 * contra Postgres real, sin Next.
 *
 *   npx tsx scripts/test-cobranzas.ts
 *
 * Usa la base de DATABASE_URL. Cada escenario corre dentro de una transaccion
 * que se deshace al final. El de cobros simultaneos necesita dos transacciones
 * reales: crea sus propios datos, los confirma y los borra al terminar.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d, type Dinero } from "../src/lib/money";
import { ErrorDeNegocio, hoyArgentinaISO } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import { anularVentaEnTx, registrarVentaEnTx } from "../src/lib/dominio/ventas";
import { anularPagoEnTx, marcarEntregadaEnTx, registrarPagoEnTx } from "../src/lib/dominio/pagos";
import { pagadoDe, saldoDeVenta } from "../src/lib/cobranzas";

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

const num = (v: Dinero) => v.toFixed(2);

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

const hoy = new Date(`${hoyArgentinaISO()}T00:00:00Z`);

/** Un cliente y una venta de $1.000 (un servicio: no toca stock), sin pago inicial. */
async function ventaDePrueba(tx: Tx, conPagoInicial?: Dinero) {
  const cliente = await tx.cliente.create({ data: { nombre: "Cliente de cobranzas" } });
  const servicio = await tx.articulo.create({
    data: { nombre: "Servicio de cobranzas", precioVenta: d(1000), ivaPct: d(0), esServicio: true },
  });
  const venta = await registrarVentaEnTx(tx, {
    clienteId: cliente.id,
    fecha: hoy,
    observaciones: null,
    entregada: false,
    items: [{ articuloId: servicio.id, cantidad: d(1) }],
    pago: conPagoInicial ? { monto: conPagoInicial, metodo: "EFECTIVO" } : null,
  });
  return { cliente, servicio, venta };
}

async function saldo(tx: Tx, ventaId: string): Promise<string> {
  const v = await tx.venta.findUniqueOrThrow({ where: { id: ventaId }, include: { pagos: true } });
  return num(saldoDeVenta(v.totalBruto, pagadoDe(v.pagos)));
}

const pago = (ventaId: string, monto: string, notas: string | null = null) => ({
  ventaId,
  fecha: hoy,
  monto: d(monto),
  metodo: "TRANSFERENCIA" as const,
  notas,
});

async function main() {
  await escenario("Pagos parciales hasta saldar", async (tx) => {
    const { cliente, venta } = await ventaDePrueba(tx, d(200));
    comprobar("total", num(venta.totalBruto), "1000.00");
    comprobar("saldo tras el pago inicial", await saldo(tx, venta.id), "800.00");

    const r1 = await registrarPagoEnTx(tx, pago(venta.id, "300", "Seña"));
    comprobar("saldo devuelto", num(r1.saldo), "500.00");
    comprobar("saldo recalculado", await saldo(tx, venta.id), "500.00");
    const creado = await tx.pago.findUniqueOrThrow({ where: { id: r1.id } });
    comprobar("cliente sale de la venta", creado.clienteId, cliente.id);
    comprobar("método y notas", `${creado.metodo} ${creado.notas}`, "TRANSFERENCIA Seña");

    await rechaza("más que el saldo", "supera el saldo", () => registrarPagoEnTx(tx, pago(venta.id, "500.02")));
    // Tolerancia de 1 centavo, como al crear la venta.
    await registrarPagoEnTx(tx, pago(venta.id, "500.01"));
    comprobar("saldada", await saldo(tx, venta.id), "0.00");
    await rechaza("venta saldada", "ya está saldada", () => registrarPagoEnTx(tx, pago(venta.id, "1")));
    comprobar("pagos", String(await tx.pago.count({ where: { ventaId: venta.id } })), "3");
  });

  await escenario("Anular un pago: vuelve el saldo, el pago queda", async (tx) => {
    const { venta } = await ventaDePrueba(tx);
    const { id } = await registrarPagoEnTx(tx, pago(venta.id, "1000"));
    comprobar("saldada", await saldo(tx, venta.id), "0.00");

    await rechaza("motivo vacío", "motivo", () => anularPagoEnTx(tx, id, "   "));
    const r = await anularPagoEnTx(tx, id, "Transferencia rechazada");
    comprobar("devuelve la venta", r.ventaId, venta.id);
    comprobar("saldo vuelve", await saldo(tx, venta.id), "1000.00");
    const anulado = await tx.pago.findUniqueOrThrow({ where: { id } });
    comprobar("no se borra", String(anulado.anuladoEn !== null), "true");
    comprobar("motivo", String(anulado.motivoAnulacion), "Transferencia rechazada");
    await rechaza("anular dos veces", "ya estaba anulado", () => anularPagoEnTx(tx, id, "Otra vez"));
    await rechaza("pago inexistente", "no existe", () =>
      anularPagoEnTx(tx, "00000000-0000-4000-8000-000000000000", "X"),
    );

    // Con el pago anulado se puede volver a cobrar el total.
    await registrarPagoEnTx(tx, pago(venta.id, "1000"));
    comprobar("saldada de nuevo", await saldo(tx, venta.id), "0.00");
  });

  await escenario("Venta anulada: no admite pagos ni entrega", async (tx) => {
    const { venta } = await ventaDePrueba(tx, d(400));
    await anularVentaEnTx(tx, venta.id);
    await rechaza("pago sobre anulada", "anulada", () => registrarPagoEnTx(tx, pago(venta.id, "1")));
    await rechaza("entregar anulada", "anulada", () => marcarEntregadaEnTx(tx, venta.id));
    // Su pago se conserva (se muestra pero no cuenta) y se puede anular igual.
    const inicial = await tx.pago.findFirstOrThrow({ where: { ventaId: venta.id } });
    comprobar("pago inicial conservado", num(inicial.monto), "400.00");
    await anularPagoEnTx(tx, inicial.id, "Se devolvió la plata");
    comprobar("anulado", String((await tx.pago.findUniqueOrThrow({ where: { id: inicial.id } })).anuladoEn !== null), "true");
    await rechaza("venta inexistente", "no existe", () =>
      registrarPagoEnTx(tx, pago("00000000-0000-4000-8000-000000000000", "1")),
    );
  });

  await escenario("PENDIENTE → ENTREGADA", async (tx) => {
    const { venta } = await ventaDePrueba(tx);
    await marcarEntregadaEnTx(tx, venta.id);
    comprobar("estado", (await tx.venta.findUniqueOrThrow({ where: { id: venta.id } })).estado, "ENTREGADA");
    comprobar("entregar no cobra", await saldo(tx, venta.id), "1000.00");
    await rechaza("entregar dos veces", "ya estaba entregada", () => marcarEntregadaEnTx(tx, venta.id));
    // Una venta entregada se sigue cobrando.
    await registrarPagoEnTx(tx, pago(venta.id, "250"));
    comprobar("cobro sobre entregada", await saldo(tx, venta.id), "750.00");
  });

  await escenario("La base rechaza anular sin motivo", async (tx) => {
    const { venta } = await ventaDePrueba(tx);
    const { id } = await registrarPagoEnTx(tx, pago(venta.id, "10"));
    // SAVEPOINT: el error de la base no aborta la transaccion del escenario.
    await tx.$executeRaw`SAVEPOINT sin_motivo`;
    let rechazo = "aceptó";
    try {
      await tx.$executeRaw`UPDATE pagos SET "anuladoEn" = NOW() WHERE id = ${id}::uuid`;
    } catch (error) {
      rechazo = String(error).includes("pagos_anulacion_con_motivo_check") ? "CHECK" : String(error);
    }
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT sin_motivo`;
    comprobar("CHECK anulación con motivo", rechazo, "CHECK");
  });

  await cobrosSimultaneos();

  console.log("");
  console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
}

/**
 * Dos cobros de $600 a la vez sobre una venta de $1.000: el bloqueo de la venta
 * hace que el segundo espere, vea el primero y se rechace.
 */
async function cobrosSimultaneos() {
  console.log("--- Cobros simultáneos no superan el saldo ---");
  const { cliente, servicio, venta } = await prisma.$transaction((tx) => ventaDePrueba(tx));
  try {
    const intentos = await Promise.allSettled(
      [0, 1].map(() =>
        prisma.$transaction(async (tx) => {
          const r = await registrarPagoEnTx(tx, pago(venta.id, "600"));
          // Demora con el bloqueo tomado, para que el otro cobro llegue a esperar.
          await tx.$executeRaw`SELECT pg_sleep(0.3)`;
          return r;
        }),
      ),
    );
    const ok = intentos.filter((i) => i.status === "fulfilled").length;
    const rechazados = intentos.filter(
      (i) => i.status === "rejected" && i.reason instanceof ErrorDeNegocio && i.reason.message.includes("supera el saldo"),
    ).length;
    comprobar("uno pasa, el otro se rechaza", `${ok} ok, ${rechazados} rechazado`, "1 ok, 1 rechazado");
    const pagado = await prisma.pago.aggregate({ where: { ventaId: venta.id, anuladoEn: null }, _sum: { monto: true } });
    comprobar("cobrado", num(d(pagado._sum.monto)), "600.00");
  } finally {
    // Datos de esta prueba solamente (borrado fisico: no son datos de negocio).
    await prisma.$transaction([
      prisma.pago.deleteMany({ where: { ventaId: venta.id } }),
      prisma.ventaItem.deleteMany({ where: { ventaId: venta.id } }),
      prisma.venta.delete({ where: { id: venta.id } }),
      prisma.articulo.delete({ where: { id: servicio.id } }),
      prisma.cliente.delete({ where: { id: cliente.id } }),
    ]);
  }
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
