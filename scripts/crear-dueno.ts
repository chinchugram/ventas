/**
 * Alta del primer dueño del sistema.
 *
 *   npm run usuarios:crear-dueno
 *
 * Pide usuario, nombre y clave por la terminal (la clave no se ve al tipearla).
 * Para usarlo sin terminal (scripts, pruebas) acepta variables de entorno:
 *
 *   DUENO_USUARIO=laura DUENO_CLAVE='...' DUENO_NOMBRE='Laura' npm run usuarios:crear-dueno
 *
 * (Ojo: una clave pasada en la linea de comandos puede quedar en el historial
 * de la terminal.) Se niega si ya existe algun dueño, aunque este dado de baja:
 * por esta via no se crea un segundo. Los demas usuarios se administran en la app.
 */
import "dotenv/config";
import * as readline from "node:readline/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ErrorDeNegocio } from "../src/lib/acciones";
import { CLAVE_MIN, normalizarUsuario, problemaDeClave, problemaDeUsuario } from "../src/lib/auth-pura";
import { crearDuenoEnTx } from "../src/lib/dominio/auth";

class Cancelado extends Error {}

async function preguntar(texto: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(texto);
  } finally {
    rl.close();
  }
}

/** Lee una linea sin mostrarla (modo crudo de la terminal). Ctrl+C cancela. */
function preguntarOculto(texto: string): Promise<string> {
  const entrada = process.stdin;
  return new Promise((resolve, reject) => {
    process.stdout.write(texto);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding("utf8");
    let valor = "";
    const terminar = () => {
      entrada.off("data", alDato);
      entrada.setRawMode(false);
      entrada.pause();
      process.stdout.write("\n");
    };
    function alDato(trozo: string) {
      for (const c of trozo) {
        if (c === "\r" || c === "\n") {
          terminar();
          resolve(valor);
          return;
        }
        if (c === "\u0003" || c === "\u0004") {
          terminar();
          reject(new Cancelado("Cancelado."));
          return;
        }
        if (c === "\u007f" || c === "\b") valor = [...valor].slice(0, -1).join("");
        else if (c >= " ") valor += c;
      }
    }
    entrada.on("data", alDato);
  });
}

function fallar(mensaje: string): never {
  console.error(`\nNo se creó el dueño: ${mensaje}`);
  process.exit(1);
}

async function main() {
  if (!process.env.DATABASE_URL) fallar("falta DATABASE_URL (copiá .env.example a .env).");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  try {
    // Antes de pedir nada: si ya hay dueño, no tiene sentido tipear una clave.
    const existente = await prisma.usuario.findFirst({ where: { rol: "DUENO" }, select: { usuario: true } });
    if (existente) {
      fallar(
        `ya existe un dueño (usuario "${existente.usuario}"). Este comando solo crea el primero; ` +
          "los demás usuarios se administran desde la app.",
      );
    }

    const interactivo = process.stdin.isTTY === true;
    const desdeEntorno = process.env.DUENO_USUARIO !== undefined || process.env.DUENO_CLAVE !== undefined;
    if (!interactivo && !desdeEntorno) {
      fallar("no hay terminal para preguntar. Definí DUENO_USUARIO y DUENO_CLAVE (y opcionalmente DUENO_NOMBRE).");
    }

    console.log("Alta del primer dueño del sistema.\n");

    const usuario = normalizarUsuario(process.env.DUENO_USUARIO ?? (await preguntar("Usuario (ej. laura): ")));
    const problemaUsuario = problemaDeUsuario(usuario);
    if (problemaUsuario) fallar(problemaUsuario);

    const nombre =
      (process.env.DUENO_NOMBRE ?? (desdeEntorno ? "" : await preguntar("Nombre para mostrar [Dueño]: "))).trim() ||
      "Dueño";

    let clave = process.env.DUENO_CLAVE;
    if (clave === undefined) {
      if (!interactivo) fallar("falta DUENO_CLAVE.");
      clave = await preguntarOculto(`Clave (mínimo ${CLAVE_MIN} caracteres, no se ve al escribir): `);
      const problema = problemaDeClave(clave);
      if (problema) fallar(problema);
      if ((await preguntarOculto("Repetí la clave: ")) !== clave) fallar("las claves no coinciden.");
    }
    const problemaClave = problemaDeClave(clave);
    if (problemaClave) fallar(problemaClave);

    const creado = await prisma.$transaction((tx) => crearDuenoEnTx(tx, { usuario, nombre, clave: clave! }), {
      timeout: 30_000,
    });
    console.log(`\nListo: el dueño "${creado.usuario}" (${creado.nombre}) ya puede entrar en /login.`);
  } catch (error) {
    if (error instanceof ErrorDeNegocio || error instanceof Cancelado) fallar(error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
