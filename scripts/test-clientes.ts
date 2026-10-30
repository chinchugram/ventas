/**
 * Prueba el alta, la edicion y la baja logica de clientes contra Postgres
 * real, sin Next.
 *
 *   npx tsx scripts/test-clientes.ts
 *
 * Como `test-acciones.ts`: cada escenario corre en una transaccion que se
 * deshace al final, asi que no deja rastro en la base.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ErrorDeNegocio } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import { cambiarActivoClienteEnTx, crearClienteEnTx, editarClienteEnTx, type DatosCliente } from "../src/lib/dominio/clientes";

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

const datos = (extra: Partial<DatosCliente> = {}): DatosCliente => ({
  nombre: "Cliente de prueba",
  cuit: null,
  telefono: null,
  email: null,
  direccion: null,
  notas: null,
  ...extra,
});

// CUIT validos que el seed no usa.
const CUIT_A = "20-00000006-0";
const CUIT_B = "33-69345023-9";

async function main() {
  await escenario("Alta: normaliza el CUIT y rechaza invalidos y duplicados", async (tx) => {
    const { id } = await crearClienteEnTx(tx, datos({ nombre: "  Prueba Uno  ", cuit: ` ${CUIT_A} `, telefono: "351 000" }));
    const c = await tx.cliente.findUniqueOrThrow({ where: { id } });
    comprobar("nombre sin espacios", c.nombre, "Prueba Uno");
    comprobar("CUIT normalizado", String(c.cuit), "20000000060");
    comprobar("activo", String(c.activo), "true");

    const sinCuit = await crearClienteEnTx(tx, datos({ nombre: "Sin CUIT" }));
    const otroSinCuit = await crearClienteEnTx(tx, datos({ nombre: "Otro sin CUIT", cuit: "   " }));
    comprobar("varios sin CUIT", String(sinCuit.id !== otroSinCuit.id), "true");
    comprobar(
      "CUIT vacio se guarda null",
      String((await tx.cliente.findUniqueOrThrow({ where: { id: otroSinCuit.id } })).cuit),
      "null",
    );

    await rechaza("verificador equivocado", "dígito verificador", () =>
      crearClienteEnTx(tx, datos({ cuit: "20-00000006-1" })),
    );
    await rechaza("corto", "11 dígitos", () => crearClienteEnTx(tx, datos({ cuit: "2000000" })));
    await rechaza("duplicado con otro formato", "Ya hay un cliente con ese CUIT: Prueba Uno", () =>
      crearClienteEnTx(tx, datos({ cuit: "20000000060" })),
    );

    await cambiarActivoClienteEnTx(tx, id, false);
    await rechaza("duplicado de uno dado de baja", "(dado de baja)", () =>
      crearClienteEnTx(tx, datos({ cuit: CUIT_A })),
    );
  });

  await escenario("Edicion: valida CUIT nuevo, conserva el viejo si no se toca", async (tx) => {
    const uno = await crearClienteEnTx(tx, datos({ nombre: "Uno", cuit: CUIT_A }));
    const dos = await crearClienteEnTx(tx, datos({ nombre: "Dos", cuit: CUIT_B }));

    await editarClienteEnTx(tx, uno.id, datos({ nombre: "Uno editado", cuit: CUIT_A, email: "uno@prueba.com" }));
    const editado = await tx.cliente.findUniqueOrThrow({ where: { id: uno.id } });
    comprobar("nombre", editado.nombre, "Uno editado");
    comprobar("email", String(editado.email), "uno@prueba.com");
    comprobar("su propio CUIT no choca", String(editado.cuit), "20000000060");

    await rechaza("CUIT de otro cliente", "Ya hay un cliente con ese CUIT: Dos", () =>
      editarClienteEnTx(tx, uno.id, datos({ nombre: "Uno", cuit: CUIT_B })),
    );
    await rechaza("CUIT nuevo invalido", "dígito verificador", () =>
      editarClienteEnTx(tx, uno.id, datos({ nombre: "Uno", cuit: "20-00000006-9" })),
    );

    await editarClienteEnTx(tx, dos.id, datos({ nombre: "Dos", cuit: null }));
    comprobar(
      "quitar el CUIT",
      String((await tx.cliente.findUniqueOrThrow({ where: { id: dos.id } })).cuit),
      "null",
    );

    // Dato viejo, cargado antes de la validacion: CUIT con verificador equivocado.
    const viejo = await tx.cliente.create({ data: { nombre: "Viejo", cuit: "30-11111111-1" } });
    await editarClienteEnTx(tx, viejo.id, datos({ nombre: "Viejo", cuit: "30-11111111-1", telefono: "351 111" }));
    const v = await tx.cliente.findUniqueOrThrow({ where: { id: viejo.id } });
    comprobar("CUIT viejo sin tocar se conserva (normalizado)", String(v.cuit), "30111111111");
    comprobar("y el resto se guarda", String(v.telefono), "351 111");
    await rechaza("CUIT viejo modificado se valida", "dígito verificador", () =>
      editarClienteEnTx(tx, viejo.id, datos({ nombre: "Viejo", cuit: "30-11111111-2" })),
    );

    await rechaza("cliente inexistente", "no existe", () =>
      editarClienteEnTx(tx, "00000000-0000-0000-0000-000000000000", datos()),
    );
  });

  await escenario("Condicion frente al IVA y DNI: alta, edicion y validacion", async (tx) => {
    const sinDatos = await crearClienteEnTx(tx, datos({ nombre: "Sin datos fiscales" }));
    const base = await tx.cliente.findUniqueOrThrow({ where: { id: sinDatos.id } });
    comprobar("alta sin condicion: consumidor final", base.condicionIva, "CONSUMIDOR_FINAL");
    comprobar("alta sin DNI: null", String(base.dni), "null");

    const empresa = await crearClienteEnTx(tx, datos({ nombre: "Empresa", cuit: CUIT_A, condicionIva: "RESPONSABLE_INSCRIPTO" }));
    comprobar(
      "responsable inscripto guardado",
      (await tx.cliente.findUniqueOrThrow({ where: { id: empresa.id } })).condicionIva,
      "RESPONSABLE_INSCRIPTO",
    );

    const persona = await crearClienteEnTx(tx, datos({ nombre: "Persona", dni: " 12.345.678 " }));
    comprobar(
      "DNI con puntos se guarda normalizado",
      String((await tx.cliente.findUniqueOrThrow({ where: { id: persona.id } })).dni),
      "12345678",
    );
    await rechaza("DNI de 6 digitos", "7 u 8 dígitos", () => crearClienteEnTx(tx, datos({ dni: "123456" })));
    await rechaza("DNI con letras", "7 u 8 dígitos", () => crearClienteEnTx(tx, datos({ dni: "12A45678" })));

    await editarClienteEnTx(tx, persona.id, datos({ nombre: "Persona", dni: "30.111.222", condicionIva: "MONOTRIBUTO" }));
    const editada = await tx.cliente.findUniqueOrThrow({ where: { id: persona.id } });
    comprobar("editar cambia DNI y condicion", `${editada.dni} ${editada.condicionIva}`, "30111222 MONOTRIBUTO");

    // Sin informar (undefined) no se tocan: el formulario siempre los manda, pero otros llamados no.
    await editarClienteEnTx(tx, persona.id, datos({ nombre: "Persona renombrada" }));
    const sinTocar = await tx.cliente.findUniqueOrThrow({ where: { id: persona.id } });
    comprobar("sin informar, DNI y condicion se conservan", `${sinTocar.dni} ${sinTocar.condicionIva}`, "30111222 MONOTRIBUTO");

    await editarClienteEnTx(tx, persona.id, datos({ nombre: "Persona", dni: "" }));
    comprobar("DNI vacio lo quita", String((await tx.cliente.findUniqueOrThrow({ where: { id: persona.id } })).dni), "null");
    await rechaza("editar con DNI invalido", "7 u 8 dígitos", () =>
      editarClienteEnTx(tx, persona.id, datos({ dni: "1234" })),
    );
  });

  await escenario("Baja logica y reactivacion: no se borra nada", async (tx) => {
    const { id } = await crearClienteEnTx(tx, datos({ nombre: "Para dar de baja" }));
    await cambiarActivoClienteEnTx(tx, id, false);
    const baja = await tx.cliente.findUniqueOrThrow({ where: { id } });
    comprobar("de baja", String(baja.activo), "false");
    const activos = await tx.cliente.count({ where: { id, activo: true } });
    comprobar("no figura entre los activos", String(activos), "0");

    await cambiarActivoClienteEnTx(tx, id, true);
    comprobar("reactivado", String((await tx.cliente.findUniqueOrThrow({ where: { id } })).activo), "true");

    await rechaza("baja de inexistente", "no existe", () =>
      cambiarActivoClienteEnTx(tx, "00000000-0000-0000-0000-000000000000", false),
    );
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
