/**
 * Prueba la logica de dominio del ABM de materiales (alta con stock inicial,
 * edicion, baja y reactivacion) contra Postgres real, sin Next.
 *
 *   npx tsx scripts/test-materiales.ts
 *
 * Usa la base de DATABASE_URL pero no deja rastro: cada escenario corre dentro
 * de una transaccion que se deshace al final.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { ErrorDeNegocio } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import {
  cambiarEstadoMaterialEnTx,
  crearMaterialEnTx,
  editarMaterialEnTx,
  MOTIVO_STOCK_INICIAL,
  type MaterialNuevo,
} from "../src/lib/dominio/materiales";
import { registrarCompraEnTx } from "../src/lib/dominio/compras";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

async function rechaza(etiqueta: string, fragmento: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "no lanzó error", `error "${fragmento}"`);
  } catch (error) {
    const ok = error instanceof ErrorDeNegocio && error.message.includes(fragmento);
    comprobar(etiqueta, ok ? "rechazada" : String(error), "rechazada");
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

class Deshacer extends Error {}

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

// Nombre unico para no chocar con los materiales del seed.
const sufijo = Date.now().toString(36);
const nuevo = (extra: Partial<MaterialNuevo> = {}): MaterialNuevo => ({
  nombre: `Prueba materiales ${sufijo}`,
  unidad: "M2",
  stockInicial: d(0),
  stockMinimo: d(5),
  costoUnitario: d("1200.5"),
  precioVenta: null,
  notas: null,
  ...extra,
});

async function main() {
  await escenario("Alta con stock inicial: deja un AJUSTE y el libro cuadra", async (tx) => {
    const { id } = await crearMaterialEnTx(tx, nuevo({ stockInicial: d("12.5"), precioVenta: d(3000) }));
    const m = await tx.material.findUniqueOrThrow({ where: { id } });
    const movs = await tx.movimientoStock.findMany({ where: { materialId: id } });
    comprobar("stock", m.stockActual.toString(), "12.5");
    comprobar("costo", m.costoUnitario.toString(), "1200.5");
    comprobar("precio", String(m.precioVenta), "3000");
    comprobar("movimientos", String(movs.length), "1");
    comprobar(
      "movimiento",
      `${movs[0]!.tipo} ${movs[0]!.cantidad} → ${movs[0]!.stockResultante} (${movs[0]!.motivo})`,
      `AJUSTE 12.5 → 12.5 (${MOTIVO_STOCK_INICIAL})`,
    );
  });

  await escenario("Alta sin stock: no deja movimiento", async (tx) => {
    const { id } = await crearMaterialEnTx(tx, nuevo());
    comprobar("movimientos", String(await tx.movimientoStock.count({ where: { materialId: id } })), "0");
  });

  await escenario("Nombre repetido (sin mirar mayusculas ni tildes)", async (tx) => {
    await crearMaterialEnTx(tx, nuevo({ nombre: `Acrílico ${sufijo}` }));
    await rechaza("alta repetida", "Ya hay un material", () =>
      crearMaterialEnTx(tx, nuevo({ nombre: `  ACRILICO   ${sufijo} ` })),
    );
  });

  await escenario("Edicion: no toca el stock y el costo solo si cambio", async (tx) => {
    const { id } = await crearMaterialEnTx(tx, nuevo({ stockInicial: d(10) }));
    const base = { id, nombre: `Renombrado ${sufijo}`, unidad: "M2" as const, stockMinimo: d(3), precioVenta: d(2500), notas: "nota" };

    const r1 = await editarMaterialEnTx(tx, { ...base, costoOriginal: d("1200.5"), costoUnitario: d("1200.5") });
    let m = await tx.material.findUniqueOrThrow({ where: { id } });
    comprobar("sin cambio de costo", String(r1.cambioCosto), "false");
    comprobar("nombre", m.nombre, `Renombrado ${sufijo}`);
    comprobar("minimo", m.stockMinimo.toString(), "3");
    comprobar("stock intacto", m.stockActual.toString(), "10");

    const r2 = await editarMaterialEnTx(tx, { ...base, costoOriginal: d("1200.5"), costoUnitario: d(1500) });
    m = await tx.material.findUniqueOrThrow({ where: { id } });
    comprobar("cambio de costo", `${r2.cambioCosto} ${m.costoUnitario}`, "true 1500");

    const r3 = await editarMaterialEnTx(tx, { ...base, precioVenta: null, costoOriginal: d(1500), costoUnitario: d(1500) });
    m = await tx.material.findUniqueOrThrow({ where: { id } });
    comprobar("precio vaciado = solo insumo", `${r3.cambioCosto} ${m.precioVenta}`, "false null");
  });

  await escenario("Edicion: una compra cambio el costo mientras se editaba", async (tx) => {
    const { id } = await crearMaterialEnTx(tx, nuevo());
    await registrarCompraEnTx(tx, {
      fecha: new Date("2026-01-20T00:00:00Z"),
      proveedor: "Proveedor",
      comprobante: null,
      notas: null,
      actualizarCosto: true,
      items: [{ materialId: id, cantidad: d(1), costoUnitario: d(1300) }],
    });
    const base = { id, nombre: `Prueba materiales ${sufijo}`, unidad: "M2" as const, stockMinimo: d(5), precioVenta: null, notas: null };
    await rechaza("costo pisado", "cambió mientras editabas", () =>
      editarMaterialEnTx(tx, { ...base, costoOriginal: d("1200.5"), costoUnitario: d(1400) }),
    );
    // Sin tocar el costo, la edicion pasa y no pisa el de la compra.
    await editarMaterialEnTx(tx, { ...base, stockMinimo: d(8), costoOriginal: d("1200.5"), costoUnitario: d("1200.5") });
    const m = await tx.material.findUniqueOrThrow({ where: { id } });
    comprobar("conserva el costo de la compra", `${m.costoUnitario} min ${m.stockMinimo}`, "1300 min 8");
  });

  await escenario("Unidad: solo se cambia si no hay movimientos ni recetas", async (tx) => {
    const libre = await crearMaterialEnTx(tx, nuevo());
    const base = { nombre: `Prueba materiales ${sufijo}`, stockMinimo: d(5), precioVenta: null, notas: null, costoOriginal: d("1200.5"), costoUnitario: d("1200.5") };
    await editarMaterialEnTx(tx, { ...base, id: libre.id, unidad: "KG" });
    comprobar("unidad cambiada", (await tx.material.findUniqueOrThrow({ where: { id: libre.id } })).unidad, "KG");

    const conStock = await crearMaterialEnTx(tx, nuevo({ nombre: `Con stock ${sufijo}`, stockInicial: d(1) }));
    await rechaza("con movimientos", "No se puede cambiar la unidad", () =>
      editarMaterialEnTx(tx, { ...base, nombre: `Con stock ${sufijo}`, id: conStock.id, unidad: "KG" }),
    );
  });

  await escenario("Baja y reactivacion", async (tx) => {
    const { id } = await crearMaterialEnTx(tx, nuevo({ stockInicial: d(2) }));
    await cambiarEstadoMaterialEnTx(tx, id, false);
    comprobar("de baja", String((await tx.material.findUniqueOrThrow({ where: { id } })).activo), "false");
    comprobar("conserva movimientos", String(await tx.movimientoStock.count({ where: { materialId: id } })), "1");
    await rechaza("baja dos veces", "ya está dado de baja", () => cambiarEstadoMaterialEnTx(tx, id, false));
    await rechaza("no se edita de baja", "reactivalo", () =>
      editarMaterialEnTx(tx, {
        id,
        nombre: "x",
        unidad: "M2",
        stockMinimo: d(0),
        precioVenta: null,
        notas: null,
        costoOriginal: d(0),
        costoUnitario: d(0),
      }),
    );
    await rechaza("compra de un material de baja", "dado de baja", () =>
      registrarCompraEnTx(tx, {
        fecha: new Date("2026-01-20T00:00:00Z"),
        proveedor: "X",
        comprobante: null,
        notas: null,
        actualizarCosto: false,
        items: [{ materialId: id, cantidad: d(1), costoUnitario: d(1) }],
      }),
    );

    // Mientras estaba de baja se creo otro con el mismo nombre: no se puede reactivar.
    const otro = await crearMaterialEnTx(tx, nuevo());
    await rechaza("reactivar con nombre tomado", "Ya hay un material", () => cambiarEstadoMaterialEnTx(tx, id, true));
    await cambiarEstadoMaterialEnTx(tx, otro.id, false);
    await cambiarEstadoMaterialEnTx(tx, id, true);
    comprobar("reactivado", String((await tx.material.findUniqueOrThrow({ where: { id } })).activo), "true");
  });

  await prisma.$disconnect();
  console.log("");
  console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
