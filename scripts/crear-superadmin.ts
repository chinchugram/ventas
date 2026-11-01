/**
 * Alta del primer SUPERADMIN (quien da de alta los negocios y sus dueños en /admin/negocios).
 *
 *   npm run usuarios:crear-superadmin
 *
 * No se puede crear desde la web: solo con este comando, en el servidor. Pide usuario, nombre y clave por la
 * terminal (la clave no se ve al tipearla). Sin terminal acepta variables de entorno:
 *
 *   SUPERADMIN_USUARIO=root SUPERADMIN_CLAVE='...' SUPERADMIN_NOMBRE='Admin' npm run usuarios:crear-superadmin
 *
 * Se niega si ya existe algun SUPERADMIN (aunque este dado de baja): este comando solo crea el primero.
 * Entra en /login escribiendo `admin` en «Negocio». No tiene negocio ni ve datos de ninguno.
 *
 * Conexion: `DATABASE_URL_MIGRACIONES` si esta definida, si no `DATABASE_URL`; funciona con cualquiera de
 * los dos roles (declara el contexto de SUPERADMIN antes de escribir: RLS).
 */
import "dotenv/config";
import * as readline from "node:readline/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ErrorDeNegocio } from "../src/lib/acciones";
import { CLAVE_MIN, normalizarUsuario, problemaDeClave, problemaDeUsuario } from "../src/lib/auth-pura";
import { conSuperadminEn, crearSuperadminEnTx } from "../src/lib/dominio/auth";

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
  console.error(`\nNo se creó el superadmin: ${mensaje}`);
  process.exit(1);
}

async function main() {
  const conexion = process.env.DATABASE_URL_MIGRACIONES ?? process.env.DATABASE_URL;
  if (!conexion) fallar("falta DATABASE_URL (copiá .env.example a .env).");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: conexion }) });

  try {
    // Antes de pedir nada: si ya hay un superadmin, no tiene sentido tipear una clave.
    const existente = await conSuperadminEn(prisma, (tx) => tx.usuario.findFirst({ where: { rol: "SUPERADMIN" }, select: { usuario: true } }));
    if (existente) {
      fallar(`ya existe un superadmin (usuario "${existente.usuario}"). Este comando solo crea el primero.`);
    }

    const interactivo = process.stdin.isTTY === true;
    const desdeEntorno = process.env.SUPERADMIN_USUARIO !== undefined || process.env.SUPERADMIN_CLAVE !== undefined;
    if (!interactivo && !desdeEntorno) {
      fallar("no hay terminal para preguntar. Definí SUPERADMIN_USUARIO y SUPERADMIN_CLAVE (y opcionalmente SUPERADMIN_NOMBRE).");
    }

    console.log("Alta del primer superadmin.\n");

    const usuario = normalizarUsuario(process.env.SUPERADMIN_USUARIO ?? (await preguntar("Usuario (ej. root): ")));
    const problemaUsuario = problemaDeUsuario(usuario);
    if (problemaUsuario) fallar(problemaUsuario);

    const nombre =
      (process.env.SUPERADMIN_NOMBRE ?? (desdeEntorno ? "" : await preguntar("Nombre para mostrar [Superadmin]: "))).trim() ||
      "Superadmin";

    let clave = process.env.SUPERADMIN_CLAVE;
    if (clave === undefined) {
      if (!interactivo) fallar("falta SUPERADMIN_CLAVE.");
      clave = await preguntarOculto(`Clave (mínimo ${CLAVE_MIN} caracteres, no se ve al escribir): `);
      const problema = problemaDeClave(clave);
      if (problema) fallar(problema);
      if ((await preguntarOculto("Repetí la clave: ")) !== clave) fallar("las claves no coinciden.");
    }
    const problemaClave = problemaDeClave(clave);
    if (problemaClave) fallar(problemaClave);

    const creado = await conSuperadminEn(prisma, (tx) => crearSuperadminEnTx(tx, { usuario, nombre, clave: clave! }));
    console.log(`\nListo: el superadmin "${creado.usuario}" (${creado.nombre}) ya puede entrar en /login con el negocio «admin».`);
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
