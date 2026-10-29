/**
 * Prueba el nucleo de autenticacion contra Postgres real, sin Next.
 *
 *   npm run test:auth:db
 *
 * Usa la base de DATABASE_URL pero no deja rastro: cada escenario corre dentro
 * de una transaccion que se deshace al final. La prueba del script
 * `usuarios:crear-dueno` corre el comando de verdad; si la base no tiene ningun
 * dueno, crea uno temporal y lo borra al terminar.
 */
import "dotenv/config";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ErrorDeNegocio } from "../src/lib/acciones";
import { formatoDeTokenValido, hashDeToken, hashearClave, SCRYPT_ACTUAL } from "../src/lib/auth-pura";
import {
  cerrarSesion,
  cerrarSesionesDeUsuario,
  crearDuenoEnTx,
  crearSesion,
  crearUsuarioEnTx,
  hayUsuarios,
  iniciarSesion,
  resolverSesion,
  verificarCredenciales,
} from "../src/lib/dominio/auth";
import type { Tx } from "../src/lib/dominio/tx";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
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
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (!(error instanceof Deshacer)) {
      fallos += 1;
      console.log("FALLA error inesperado:", error);
    }
  }
}

/** La base tiene que rechazar `fn` con la restriccion `restriccion` (CHECK o indice unico). */
async function rechazaLaBase(etiqueta: string, restriccion: string, fn: (tx: Tx) => Promise<unknown>) {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Deshacer();
    });
    comprobar(etiqueta, "aceptada", "rechazada");
  } catch (error) {
    const texto = String(error instanceof Error ? error.message : error);
    comprobar(etiqueta, error instanceof Deshacer ? "aceptada" : texto.includes(restriccion) ? "rechazada" : texto, "rechazada");
  }
}

const CLAVE = "clave-de-prueba-123";
const DIA = 24 * 60 * 60 * 1000;
const ahora = () => new Date();
const mas = (ms: number, desde: Date) => new Date(desde.getTime() + ms);

async function usuarioDePrueba(tx: Tx, rol: "DUENO" | "EMPLEADO" = "EMPLEADO", usuario = "prueba.auth") {
  return crearUsuarioEnTx(tx, { usuario, nombre: "Prueba Auth", rol, clave: CLAVE });
}

async function main() {
  await escenario("Login correcto", async (tx) => {
    const u = await usuarioDePrueba(tx);
    const r = await iniciarSesion(tx, "  Prueba.AUTH ", CLAVE);
    comprobar("entra (usuario normalizado)", String(r.ok), "true");
    if (!r.ok) return;
    comprobar("token con formato", String(formatoDeTokenValido(r.token)), "true");
    comprobar("vence en 30 dias", String(Math.round((r.expiraEn.getTime() - Date.now()) / DIA)), "30");

    const filas = await tx.sesion.findMany({ where: { usuarioId: u.id } });
    comprobar("una sesion en base", String(filas.length), "1");
    comprobar("la base guarda el hash del token", String(filas[0]?.tokenHash === hashDeToken(r.token)), "true");
    comprobar("y nunca el token", String(filas.some((f) => f.tokenHash.includes(r.token))), "false");

    const sesion = await resolverSesion(tx, r.token);
    comprobar("la sesion resuelve al usuario", String(sesion?.usuario.id === u.id), "true");
    comprobar("solo id, usuario, nombre y rol", Object.keys(sesion?.usuario ?? {}).sort().join(","), "id,nombre,rol,usuario");
    comprobar("token inventado no", String(await resolverSesion(tx, r.token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))), "null");
    comprobar("token vacio no", String(await resolverSesion(tx, "")), "null");

    const otra = await iniciarSesion(tx, "prueba.auth", CLAVE);
    comprobar("cada login estrena token", String(otra.ok && otra.token !== r.token), "true");
  });

  await escenario("Clave mala, usuario inexistente y usuario dado de baja: misma respuesta", async (tx) => {
    const u = await usuarioDePrueba(tx);
    const t1 = performance.now();
    const mala = await iniciarSesion(tx, "prueba.auth", "otra-clave-cualquiera");
    const t2 = performance.now();
    const inexistente = await iniciarSesion(tx, "no.existe.nadie", "otra-clave-cualquiera");
    const t3 = performance.now();
    comprobar("clave mala", JSON.stringify(mala), '{"ok":false}');
    comprobar("inexistente: identica", JSON.stringify(inexistente), JSON.stringify(mala));
    const razon = (t3 - t2) / (t2 - t1);
    console.log(`     (clave mala ${(t2 - t1).toFixed(0)} ms, inexistente ${(t3 - t2).toFixed(0)} ms)`);
    comprobar("inexistente tarda parecido (hace scrypt igual)", String(razon > 0.5 && razon < 2), "true");

    await tx.usuario.update({ where: { id: u.id }, data: { activo: false } });
    const baja = await iniciarSesion(tx, "prueba.auth", CLAVE);
    comprobar("dado de baja con la clave correcta: identica", JSON.stringify(baja), JSON.stringify(mala));
    comprobar("no se abrio ninguna sesion", String(await tx.sesion.count({ where: { usuarioId: u.id } })), "0");
  });

  await escenario("Vencimiento y renovacion", async (tx) => {
    const u = await usuarioDePrueba(tx);
    const hoy = ahora();

    const vieja = await crearSesion(tx, u.id, mas(-31 * DIA, hoy));
    comprobar("sesion de hace 31 dias no vale", String(await resolverSesion(tx, vieja.token, hoy)), "null");
    comprobar("y se borra", String(await tx.sesion.count({ where: { tokenHash: hashDeToken(vieja.token) } })), "0");

    const casi = await crearSesion(tx, u.id, mas(-29 * DIA, hoy));
    comprobar("de hace 29 dias todavia vale", String((await resolverSesion(tx, casi.token, hoy))?.usuario.id === u.id), "true");
    comprobar("un segundo despues del vencimiento no", String(await resolverSesion(tx, casi.token, mas(1000, casi.expiraEn))), "null");

    const reciente = await crearSesion(tx, u.id, mas(-2 * DIA, hoy));
    const sinRenovar = await resolverSesion(tx, reciente.token, hoy);
    comprobar("sin pedir renovacion no renueva", String(sinRenovar?.renovadaHasta), "null");
    const renovada = await resolverSesion(tx, reciente.token, hoy, { renovar: true });
    comprobar("renueva a 30 dias desde ahora", String(renovada?.renovadaHasta?.getTime()), String(mas(30 * DIA, hoy).getTime()));
    const fila = await tx.sesion.findUnique({ where: { tokenHash: hashDeToken(reciente.token) } });
    comprobar("el vencimiento se guarda en base", String(fila?.expiraEn.getTime()), String(mas(30 * DIA, hoy).getTime()));
    const otraVez = await resolverSesion(tx, reciente.token, mas(60_000, hoy), { renovar: true });
    comprobar("en el mismo dia no vuelve a escribir", String(otraVez?.renovadaHasta), "null");
    comprobar("...pero sigue valiendo", String(otraVez?.usuario.id === u.id), "true");

    const nueva = await crearSesion(tx, u.id, hoy);
    const sinTocar = await resolverSesion(tx, nueva.token, mas(1000, hoy), { renovar: true });
    comprobar("una sesion recien abierta no se renueva", String(sinTocar?.renovadaHasta), "null");
  });

  await escenario("La baja de un usuario corta su sesion al instante", async (tx) => {
    const u = await usuarioDePrueba(tx);
    const r = await iniciarSesion(tx, "prueba.auth", CLAVE);
    if (!r.ok) return comprobar("login", "fallo", "ok");
    comprobar("antes de la baja vale", String((await resolverSesion(tx, r.token))?.usuario.id === u.id), "true");
    await tx.usuario.update({ where: { id: u.id }, data: { activo: false } });
    comprobar("despues de la baja no", String(await resolverSesion(tx, r.token)), "null");
    comprobar("y la fila se borra", String(await tx.sesion.count({ where: { usuarioId: u.id } })), "0");
  });

  await escenario("Cerrar sesion borra la fila", async (tx) => {
    const u = await usuarioDePrueba(tx);
    const a = await iniciarSesion(tx, "prueba.auth", CLAVE);
    const b = await iniciarSesion(tx, "prueba.auth", CLAVE);
    if (!a.ok || !b.ok) return comprobar("login", "fallo", "ok");
    await cerrarSesion(tx, a.token);
    comprobar("la fila ya no esta", String(await tx.sesion.count({ where: { tokenHash: hashDeToken(a.token) } })), "0");
    comprobar("el token cerrado no vale", String(await resolverSesion(tx, a.token)), "null");
    comprobar("la otra sesion sigue", String((await resolverSesion(tx, b.token))?.usuario.id === u.id), "true");
    await cerrarSesion(tx, a.token); // dos veces: no falla
    comprobar("cerrar todas las del usuario", String(await cerrarSesionesDeUsuario(tx, u.id)), "1");
    comprobar("ya no vale ninguna", String(await resolverSesion(tx, b.token)), "null");
  });

  await escenario("Pausa creciente tras intentos fallidos", async (tx) => {
    const u = await usuarioDePrueba(tx);
    let t = ahora();
    for (let i = 1; i <= 4; i++) {
      await verificarCredenciales(tx, "prueba.auth", `mala-${i}-xxxxxxx`, t);
      t = mas(1000, t);
    }
    let fila = await tx.usuario.findUniqueOrThrow({ where: { id: u.id } });
    comprobar("4 fallos: contados y sin pausa", `${fila.intentosFallidos}/${fila.bloqueadoHasta}`, "4/null");
    comprobar("con la clave correcta todavia entra", String((await verificarCredenciales(tx, "prueba.auth", CLAVE, t)).ok), "true");
    fila = await tx.usuario.findUniqueOrThrow({ where: { id: u.id } });
    comprobar("el login correcto resetea la cuenta", `${fila.intentosFallidos}/${fila.bloqueadoHasta}`, "0/null");

    for (let i = 1; i <= 5; i++) {
      await verificarCredenciales(tx, "prueba.auth", `mala-${i}-xxxxxxx`, t);
      t = mas(1000, t);
    }
    fila = await tx.usuario.findUniqueOrThrow({ where: { id: u.id } });
    comprobar("5 fallos: pausa", String(fila.bloqueadoHasta !== null && fila.bloqueadoHasta > t), "true");
    comprobar("en pausa ni la clave correcta entra", String((await verificarCredenciales(tx, "prueba.auth", CLAVE, t)).ok), "false");
    await verificarCredenciales(tx, "prueba.auth", "mala-en-pausa-xxxx", t);
    fila = await tx.usuario.findUniqueOrThrow({ where: { id: u.id } });
    comprobar("lo que llega en pausa no suma", String(fila.intentosFallidos), "5");
    const despues = mas(1000, fila.bloqueadoHasta!);
    comprobar("pasada la pausa, la clave correcta entra", String((await verificarCredenciales(tx, "prueba.auth", CLAVE, despues)).ok), "true");
  });

  await escenario("Intentos en paralelo: no se puede probar muchas claves a la vez", async (tx) => {
    const u = await usuarioDePrueba(tx);
    const t = ahora();
    const intentos = Array.from({ length: 9 }, (_, i) => `mala-paralela-${i}-xx`).concat(CLAVE);
    const resultados = await Promise.all(intentos.map((c) => verificarCredenciales(tx, "prueba.auth", c, t)));
    const fila = await tx.usuario.findUniqueOrThrow({ where: { id: u.id } });
    comprobar("solo un intento llego a verificarse", String(fila.intentosFallidos), "1");
    comprobar("la clave correcta en la rafaga no entra", String(resultados.at(-1)?.ok), "false");
  });

  await escenario("Cambio de parametros de scrypt: rehash en el login", async (tx) => {
    const u = await usuarioDePrueba(tx);
    await tx.usuario.update({ where: { id: u.id }, data: { hashClave: await hashearClave(CLAVE, { ln: 14, r: 8, p: 1 }) } });
    comprobar("el hash viejo sigue entrando", String((await iniciarSesion(tx, "prueba.auth", CLAVE)).ok), "true");
    const fila = await tx.usuario.findUniqueOrThrow({ where: { id: u.id } });
    const { ln, r, p } = SCRYPT_ACTUAL;
    comprobar("quedo rehasheado con los actuales", String(fila.hashClave.startsWith(`scrypt$ln=${ln},r=${r},p=${p}$`)), "true");
    comprobar("y sigue entrando", String((await iniciarSesion(tx, "prueba.auth", CLAVE)).ok), "true");
  });

  await escenario("Alta del dueno", async (tx) => {
    comprobar("hay usuarios (seed)", String(await hayUsuarios(tx)), "true");
    // Sin duenos en esta transaccion: se pasan a empleado (no se borran: pueden tener historial).
    await tx.usuario.updateMany({ where: { rol: "DUENO" }, data: { rol: "EMPLEADO" } });
    const d = await crearDuenoEnTx(tx, { usuario: "Primer.Dueno", nombre: "Primero", clave: CLAVE });
    comprobar("crea el primero, en minusculas", `${d.usuario}/${d.rol}`, "primer.dueno/DUENO");
    await rechaza("un segundo dueno", "Ya existe un dueño", () =>
      crearDuenoEnTx(tx, { usuario: "segundo.dueno", nombre: "Segundo", clave: CLAVE }),
    );
    await tx.usuario.update({ where: { id: d.id }, data: { activo: false } });
    await rechaza("tampoco si el primero esta dado de baja", "dado de baja", () =>
      crearDuenoEnTx(tx, { usuario: "segundo.dueno", nombre: "Segundo", clave: CLAVE }),
    );
    await rechaza("usuario repetido", "Ya existe un usuario", () =>
      crearUsuarioEnTx(tx, { usuario: "PRIMER.DUENO", nombre: "Otro", rol: "EMPLEADO", clave: CLAVE }),
    );
    await rechaza("clave corta", "al menos 10", () =>
      crearUsuarioEnTx(tx, { usuario: "corta", nombre: "Corta", rol: "EMPLEADO", clave: "123456789" }),
    );
    await rechaza("usuario invalido", "entre 3 y 40", () =>
      crearUsuarioEnTx(tx, { usuario: "con espacio", nombre: "X", rol: "EMPLEADO", clave: CLAVE }),
    );
  });

  console.log("--- La base rechaza datos invalidos (CHECK) ---");
  const hashValido = await hashearClave(CLAVE);
  const usuarioCrudo = (usuario: string, hashClave = hashValido) => (tx: Tx) =>
    tx.$executeRaw`INSERT INTO usuarios (id, usuario, nombre, rol, "hashClave", "actualizadoEn")
                   VALUES (gen_random_uuid(), ${usuario}, 'X', 'EMPLEADO', ${hashClave}, now())`;
  // La rechaza el CHECK de minusculas o el de formato (el primero que evalue Postgres).
  await rechazaLaBase("usuario con mayusculas", "check constraint \"usuarios_usuario_", usuarioCrudo("Mayus"));
  await rechazaLaBase("usuario con espacios", "usuarios_usuario_formato_check", usuarioCrudo("con espacio"));
  await rechazaLaBase("usuario de 2 letras", "usuarios_usuario_formato_check", usuarioCrudo("ab"));
  await rechazaLaBase("hash vacio", "usuarios_hash_clave_check", usuarioCrudo("sin.hash", ""));
  await rechazaLaBase("clave en texto plano", "usuarios_hash_clave_check", usuarioCrudo("plano", CLAVE));
  await rechazaLaBase("usuario repetido", "usuarios_usuario_key", async (tx) => {
    await usuarioCrudo("repetido")(tx);
    await usuarioCrudo("repetido")(tx);
  });
  await rechazaLaBase("rol inexistente", "Rol", (tx) =>
    tx.$executeRawUnsafe(`INSERT INTO usuarios (id, usuario, nombre, rol, "hashClave", "actualizadoEn")
                          VALUES (gen_random_uuid(), 'rol.raro', 'X', 'ADMIN', '${hashValido}', now())`),
  );
  await rechazaLaBase("nombre vacio", "usuarios_nombre_check", (tx) =>
    tx.$executeRaw`INSERT INTO usuarios (id, usuario, nombre, rol, "hashClave", "actualizadoEn")
                   VALUES (gen_random_uuid(), 'sin.nombre', '  ', 'EMPLEADO', ${hashValido}, now())`,
  );
  await rechazaLaBase("intentos negativos", "usuarios_intentos_fallidos_check", async (tx) => {
    const u = await usuarioDePrueba(tx);
    await tx.usuario.update({ where: { id: u.id }, data: { intentosFallidos: -1 } });
  });
  await rechazaLaBase("token guardado en claro (no es SHA-256 hex)", "sesiones_token_hash_check", async (tx) => {
    const u = await usuarioDePrueba(tx);
    await tx.sesion.create({ data: { tokenHash: "x".repeat(43), usuarioId: u.id, expiraEn: mas(DIA, ahora()) } });
  });
  await rechazaLaBase("sesion que vence antes de crearse", "sesiones_vencimiento_check", async (tx) => {
    const u = await usuarioDePrueba(tx);
    await tx.sesion.create({ data: { tokenHash: "a".repeat(64), usuarioId: u.id, expiraEn: mas(-DIA, ahora()) } });
  });
  await rechazaLaBase("borrar un usuario con sesiones", "sesiones_usuarioId_fkey", async (tx) => {
    const u = await usuarioDePrueba(tx);
    await crearSesion(tx, u.id);
    await tx.usuario.delete({ where: { id: u.id } });
  });

  await probarComandoCrearDueno();

  console.log("");
  if (fallos > 0) {
    console.log(`${fallos} comprobacion(es) fallaron.`);
    process.exit(1);
  }
  console.log("Todas las comprobaciones pasaron.");
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

/** Corre `npm run usuarios:crear-dueno` de verdad (con variables de entorno) y espera que se niegue. */
async function probarComandoCrearDueno() {
  console.log("--- npm run usuarios:crear-dueno con un dueno ya cargado ---");
  let temporal: string | null = null;
  if (!(await prisma.usuario.findFirst({ where: { rol: "DUENO" } }))) {
    const u = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: "dueno.temporal.test", nombre: "Temporal", rol: "DUENO", clave: CLAVE }));
    temporal = u.id;
  }
  try {
    const salida = await new Promise<{ codigo: number; texto: string }>((resolve) => {
      execFile(
        process.execPath,
        [join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs"), join(__dirname, "crear-dueno.ts")],
        { env: { ...process.env, DUENO_USUARIO: "segundo.dueno.test", DUENO_CLAVE: CLAVE }, timeout: 60_000 },
        (error, stdout, stderr) => resolve({ codigo: error ? Number(error.code ?? 1) : 0, texto: `${stdout}${stderr}` }),
      );
    });
    comprobar("termina con error", String(salida.codigo !== 0), "true");
    comprobar("explica que ya hay dueno", String(salida.texto.includes("ya existe un dueño")), "true");
    comprobar("no creo el usuario", String(await prisma.usuario.count({ where: { usuario: "segundo.dueno.test" } })), "0");
  } finally {
    if (temporal) await prisma.usuario.delete({ where: { id: temporal } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
