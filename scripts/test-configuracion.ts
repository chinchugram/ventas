/**
 * Prueba la logica de configuracion y maquinas contra Postgres real, sin Next.
 *
 *   npx tsx scripts/test-configuracion.ts
 *
 * Usa la base de DATABASE_URL pero no deja rastro: cada escenario corre dentro
 * de una transaccion que se deshace al final.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { ErrorDeNegocio } from "../src/lib/acciones";
import { esquemaConfiguracion, esquemaMaquina, leerConfiguracion } from "../src/lib/configuracion";
import { recetaResuelta } from "../src/lib/receta";
import type { Tx } from "../src/lib/dominio/tx";
import {
  cambiarActivoMaquinaEnTx,
  contarRecetasConMaquina,
  crearMaquinaEnTx,
  editarMaquinaEnTx,
  guardarConfiguracionEnTx,
} from "../src/lib/dominio/configuracion";

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

const configDe = async (tx: Tx) =>
  Object.fromEntries((await tx.configuracion.findMany()).map((f) => [f.clave, f.valor]));

const maquina = (nombre: string, costoHora: string, notas = "") => esquemaMaquina.parse({ nombre, costoHora, notas });

async function main() {
  await escenario("Guardar configuración (upsert, crea ivaPorDefecto si falta)", async (tx) => {
    await tx.configuracion.deleteMany({ where: { clave: "ivaPorDefecto" } });
    comprobar("sin clave → IVA por defecto", leerConfiguracion(await configDe(tx)).ivaPorDefecto.toString(), "21");

    await guardarConfiguracionEnTx(
      tx,
      esquemaConfiguracion.parse({
        nombreNegocio: "Taller de Prueba",
        costoHoraManoObra: "4000,50",
        ivaPorDefecto: "10,5",
        margenObjetivo: "35",
      }),
    );
    const config = await configDe(tx);
    comprobar("nombre", String(config.nombreNegocio), "Taller de Prueba");
    comprobar("costo/hora guardado con punto", String(config.costoHoraManoObra), "4000.5");
    comprobar("IVA creado", String(config.ivaPorDefecto), "10.5");
    comprobar("margen", String(config.margenObjetivo), "35");
  });

  await escenario("El costo/hora cambia el costo de las recetas con mano de obra", async (tx) => {
    const articulo = await tx.articulo.create({
      data: {
        nombre: "Artículo con mano de obra",
        precioVenta: d(10000),
        receta: { create: { componentes: { create: [{ tipo: "MANO_OBRA", cantidad: d("0.5") }] } } },
      },
      include: { receta: { include: { componentes: { include: { material: true, maquina: true } } } } },
    });
    const costo = (costoHora: string) =>
      recetaResuelta(articulo.receta!.componentes, d(costoHora)).costoTotal.toString();
    comprobar("a $1.000/h", costo("1000"), "500");
    comprobar("a $3.000/h", costo("3000"), "1500");
  });

  await escenario("Alta y edición de máquina", async (tx) => {
    const { id } = await crearMaquinaEnTx(tx, maquina("Fresadora de prueba", "1234,5", "Prueba"));
    const creada = await tx.maquina.findUniqueOrThrow({ where: { id } });
    comprobar("costo/hora", creada.costoHora.toString(), "1234.5");
    comprobar("notas", String(creada.notas), "Prueba");
    comprobar("activa", String(creada.activo), "true");

    await rechaza("nombre repetido (sin mayúsculas)", "Ya hay una máquina", () =>
      crearMaquinaEnTx(tx, maquina("FRESADORA DE PRUEBA", "1")),
    );

    await editarMaquinaEnTx(tx, id, maquina("Fresadora de prueba 2", "2000"));
    const editada = await tx.maquina.findUniqueOrThrow({ where: { id } });
    comprobar("nombre editado", editada.nombre, "Fresadora de prueba 2");
    comprobar("costo editado", editada.costoHora.toString(), "2000");
    comprobar("notas vacías → null", String(editada.notas), "null");

    // Editar sin cambiar el nombre no choca consigo misma.
    await editarMaquinaEnTx(tx, id, maquina("Fresadora de prueba 2", "2100"));
    comprobar("se puede guardar con su mismo nombre", "ok", "ok");

    await rechaza("editar una que no existe", "no existe", () =>
      editarMaquinaEnTx(tx, "00000000-0000-0000-0000-000000000000", maquina("X", "1")),
    );
  });

  await escenario("Baja lógica y reactivación (nunca se borra)", async (tx) => {
    const { id } = await crearMaquinaEnTx(tx, maquina("Láser de prueba", "5000"));
    for (const nombre of ["Uno", "Dos"]) {
      await tx.articulo.create({
        data: {
          nombre: `Artículo ${nombre}`,
          precioVenta: d(1000),
          receta: {
            create: {
              componentes: {
                create: [
                  { tipo: "MAQUINA", maquinaId: id, cantidad: d("0.1") },
                  { tipo: "MAQUINA", maquinaId: id, cantidad: d("0.2") },
                ],
              },
            },
          },
        },
      });
    }
    comprobar("recetas distintas (dos componentes por receta)", String(await contarRecetasConMaquina(tx, id)), "2");

    const baja = await cambiarActivoMaquinaEnTx(tx, id, false);
    comprobar("baja avisa las recetas", String(baja.recetas), "2");
    comprobar("queda inactiva", String((await tx.maquina.findUniqueOrThrow({ where: { id } })).activo), "false");
    comprobar("sigue en recetas", String(await tx.recetaComponente.count({ where: { maquinaId: id } })), "4");

    await rechaza("alta con el nombre de una de baja", "reactivala", () =>
      crearMaquinaEnTx(tx, maquina("láser de prueba", "1")),
    );

    await cambiarActivoMaquinaEnTx(tx, id, true);
    comprobar("reactivada", String((await tx.maquina.findUniqueOrThrow({ where: { id } })).activo), "true");
  });

  await prisma.$disconnect();
  console.log("");
  console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
}

main();
