/**
 * Prueba la administracion de usuarios (tarea 4.4) contra Postgres real, sin Next.
 *
 *   npm run test:usuarios
 *
 * Sin rastro: casi todo corre en transacciones que se deshacen al final. Las
 * pruebas de concurrencia necesitan transacciones de verdad (committed) y por
 * eso crean usuarios temporales `test44.*` que se borran al terminar. Esas
 * pruebas ademas necesitan que los unicos duenos activos sean los temporales:
 * mientras corren, los duenos activos que ya existan quedan unos segundos como
 * EMPLEADO y se restauran en el `finally` (solo cambia su `actualizadoEn`; sus
 * sesiones y demas datos no se tocan). Es una prueba para la base de desarrollo
 * o de prueba: se niega a correr con NODE_ENV=production.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ErrorDeNegocio } from "../src/lib/acciones";
import * as reglasCliente from "../src/app/usuarios/_componentes/reglas";
import {
  CLAVE_MIN,
  hashDeToken,
  hashearClave,
  normalizarUsuario,
  problemaDeUsuario,
  verificarClave,
  type Rol,
  type UsuarioSesion,
} from "../src/lib/auth-pura";
import { crearSesion, iniciarSesion, resolverSesion, verificarCredenciales } from "../src/lib/dominio/auth";
import {
  cambiarActivoUsuarioEnTx,
  cambiarClavePropia,
  cambiarRolUsuarioEnTx,
  crearUsuarioComoDuenoEnTx,
  ERROR_CLAVE_ACTUAL,
  resetearClaveUsuarioEnTx,
  SIN_PERMISO_USUARIOS,
} from "../src/lib/dominio/usuarios";
import type { Tx } from "../src/lib/dominio/tx";
import { getUsuario, getUsuarios } from "../src/lib/queries/usuarios";
import { PERMISOS, puede } from "../src/lib/permisos-pura";

if (process.env.NODE_ENV === "production") {
  console.error("Esta prueba no corre con NODE_ENV=production.");
  process.exit(1);
}

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
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (!(error instanceof Deshacer)) {
      fallos += 1;
      console.log("FALLA error inesperado:", error);
    }
  }
}

const CLAVE = "clave-de-prueba-123";
const CLAVE_NUEVA = "otra-clave-distinta-456";
let hashDeCLAVE = "";

/** Usuario de prueba con un hash ya calculado (scrypt cuesta ~0,3 s: no se repite por cada fixture). */
async function crear(db: Tx | PrismaClient, usuario: string, rol: Rol, activo = true): Promise<UsuarioSesion> {
  const u = await db.usuario.create({
    data: { usuario, nombre: `Prueba ${usuario}`, rol, hashClave: hashDeCLAVE, activo },
  });
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
}

/** Deja como unicos duenos activos a `ids` (en una transaccion que se deshace). */
async function soloDuenosActivos(tx: Tx, ids: string[]) {
  await tx.usuario.updateMany({ where: { rol: "DUENO", activo: true, id: { notIn: ids } }, data: { activo: false } });
}

async function sesiones(tx: Tx, usuarioId: string) {
  return tx.sesion.count({ where: { usuarioId } });
}

async function main() {
  hashDeCLAVE = await hashearClave(CLAVE);

  // ─── Reglas copiadas para los formularios ───────────────────────────────────
  console.log("--- Las reglas de los formularios coinciden con auth-pura ---");
  comprobar("largo minimo de clave", String(reglasCliente.CLAVE_MIN), String(CLAVE_MIN));
  for (const u of ["dueno", "  Laura.TEST ", "ab", "con espacio", "ñandu", "a".repeat(40), "a".repeat(41), "x-y_z.9", "", "UPPER"]) {
    comprobar(
      `usuario ${JSON.stringify(u)}`,
      `${reglasCliente.normalizarUsuario(u)}|${reglasCliente.usuarioValido(u)}`,
      `${normalizarUsuario(u)}|${problemaDeUsuario(u) === null}`,
    );
  }
  comprobar("mensaje de usuario", reglasCliente.AVISO_USUARIO, problemaDeUsuario("ab") ?? "");

  // ─── Alta ───────────────────────────────────────────────────────────────────
  await escenario("Alta: normalizacion, duplicados, roles y claves", async (tx) => {
    const d = await crear(tx, "test44.dueno", "DUENO");

    const e = await crearUsuarioComoDuenoEnTx(tx, d, { usuario: "  Laura.TEST44 ", nombre: "  Laura  ", rol: "EMPLEADO", clave: CLAVE });
    comprobar("usuario normalizado a minusculas y sin espacios", e.usuario, "laura.test44");
    comprobar("nombre sin espacios sobrantes", e.nombre, "Laura");
    comprobar("rol empleado", e.rol, "EMPLEADO");
    const fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("activo por defecto", String(fila.activo), "true");
    comprobar("la clave se guarda con scrypt (no en claro)", String(fila.hashClave.startsWith("scrypt$") && !fila.hashClave.includes(CLAVE)), "true");
    comprobar("el hash verifica", String(await verificarClave(CLAVE, fila.hashClave)), "true");
    comprobar("el nuevo usuario puede entrar", String((await iniciarSesion(tx, "LAURA.test44", CLAVE)).ok), "true");

    await rechaza("duplicado (otra mayuscula)", "Ya existe un usuario", () =>
      crearUsuarioComoDuenoEnTx(tx, d, { usuario: "LAURA.test44", nombre: "Otra", rol: "EMPLEADO", clave: CLAVE }),
    );
    await rechaza("duplicado de un dueno existente", "Ya existe un usuario", () =>
      crearUsuarioComoDuenoEnTx(tx, d, { usuario: "test44.dueno", nombre: "Otra", rol: "EMPLEADO", clave: CLAVE }),
    );

    for (const rol of ["ADMIN", "dueno", "Empleado", "", "DUENO ", null, undefined, 1, {}, ["DUENO"]]) {
      await rechaza(`rol invalido ${JSON.stringify(rol) ?? "undefined"}`, "rol válido", () =>
        crearUsuarioComoDuenoEnTx(tx, d, { usuario: "test44.rolmalo", nombre: "X", rol, clave: CLAVE }),
      );
    }
    comprobar("ninguno de esos se creo", String(await tx.usuario.count({ where: { usuario: "test44.rolmalo" } })), "0");

    await rechaza("clave corta (9)", "al menos 10", () =>
      crearUsuarioComoDuenoEnTx(tx, d, { usuario: "test44.corta", nombre: "X", rol: "EMPLEADO", clave: "123456789" }),
    );
    await rechaza("clave de solo espacios", "no puede ser solo espacios", () =>
      crearUsuarioComoDuenoEnTx(tx, d, { usuario: "test44.espacios", nombre: "X", rol: "EMPLEADO", clave: "          " }),
    );
    await rechaza("usuario muy corto", "entre 3 y 40", () =>
      crearUsuarioComoDuenoEnTx(tx, d, { usuario: "ab", nombre: "X", rol: "EMPLEADO", clave: CLAVE }),
    );
    await rechaza("usuario con espacios/acentos", "entre 3 y 40", () =>
      crearUsuarioComoDuenoEnTx(tx, d, { usuario: "con espacio", nombre: "X", rol: "EMPLEADO", clave: CLAVE }),
    );
    await rechaza("nombre vacio", "nombre debe tener", () =>
      crearUsuarioComoDuenoEnTx(tx, d, { usuario: "test44.sinnombre", nombre: "   ", rol: "EMPLEADO", clave: CLAVE }),
    );
    comprobar("las altas rechazadas no dejaron nada", String(await tx.usuario.count({ where: { usuario: { startsWith: "test44." } } })), "1");

    const otroDueno = await crearUsuarioComoDuenoEnTx(tx, d, { usuario: "test44.dueno2", nombre: "Segundo", rol: "DUENO", clave: CLAVE });
    comprobar("se puede crear otro dueno desde la app", otroDueno.rol, "DUENO");
  });

  // ─── Permisos ───────────────────────────────────────────────────────────────
  await escenario("Un EMPLEADO (o nadie) no puede administrar usuarios", async (tx) => {
    comprobar("la tabla: gestionarUsuarios es solo del dueno", PERMISOS.gestionarUsuarios.join(","), "DUENO");
    comprobar("puede(EMPLEADO, gestionarUsuarios)", String(puede({ rol: "EMPLEADO" }, "gestionarUsuarios")), "false");

    const d = await crear(tx, "test44.dueno", "DUENO");
    const e = await crear(tx, "test44.empleado", "EMPLEADO");
    const otro = await crear(tx, "test44.otro", "EMPLEADO");
    await soloDuenosActivos(tx, [d.id]);

    for (const [quien, actor] of [["empleado", e], ["sin sesion", null]] as const) {
      await rechaza(`${quien}: crear usuario`, SIN_PERMISO_USUARIOS, () =>
        crearUsuarioComoDuenoEnTx(tx, actor, { usuario: "test44.nuevo", nombre: "X", rol: "EMPLEADO", clave: CLAVE }),
      );
      await rechaza(`${quien}: crear un dueno`, SIN_PERMISO_USUARIOS, () =>
        crearUsuarioComoDuenoEnTx(tx, actor, { usuario: "test44.nuevo", nombre: "X", rol: "DUENO", clave: CLAVE }),
      );
      await rechaza(`${quien}: dar de baja a otro`, SIN_PERMISO_USUARIOS, () => cambiarActivoUsuarioEnTx(tx, actor, otro.id, false));
      await rechaza(`${quien}: cambiar el rol de otro`, SIN_PERMISO_USUARIOS, () => cambiarRolUsuarioEnTx(tx, actor, otro.id, "DUENO"));
      await rechaza(`${quien}: resetear la clave de otro`, SIN_PERMISO_USUARIOS, () =>
        resetearClaveUsuarioEnTx(tx, actor, otro.id, CLAVE_NUEVA),
      );
      await rechaza(`${quien}: resetear la clave del dueno`, SIN_PERMISO_USUARIOS, () =>
        resetearClaveUsuarioEnTx(tx, actor, d.id, CLAVE_NUEVA),
      );
      await rechaza(`${quien}: leer la lista`, SIN_PERMISO_USUARIOS, () => getUsuarios(actor));
      await rechaza(`${quien}: leer un usuario`, SIN_PERMISO_USUARIOS, () => getUsuario(actor, d.id));
    }
    await rechaza("empleado: subirse el rol a si mismo", SIN_PERMISO_USUARIOS, () => cambiarRolUsuarioEnTx(tx, e, e.id, "DUENO"));
    await rechaza("empleado: dar de baja al dueno", SIN_PERMISO_USUARIOS, () => cambiarActivoUsuarioEnTx(tx, e, d.id, false));

    // El objeto `actor` lo arma la sesion; si dijera DUENO pero la base dice EMPLEADO, manda la base.
    const falso: UsuarioSesion = { ...e, rol: "DUENO" };
    await rechaza("actor que se dice dueno pero en la base es empleado: cambiar rol", "ya no tiene permiso", () =>
      cambiarRolUsuarioEnTx(tx, falso, e.id, "DUENO"),
    );
    await rechaza("idem: dar de baja", "ya no tiene permiso", () => cambiarActivoUsuarioEnTx(tx, falso, d.id, false));
    await rechaza("idem: crear", "ya no tiene permiso", () =>
      crearUsuarioComoDuenoEnTx(tx, falso, { usuario: "test44.nuevo", nombre: "X", rol: "DUENO", clave: CLAVE }),
    );
    // Un dueno al que dieron de baja mientras tenia la sesion abierta tampoco.
    const baja = await crear(tx, "test44.dueno.baja", "DUENO", false);
    await rechaza("dueno dado de baja: dar de baja a otro", "ya no tiene permiso", () => cambiarActivoUsuarioEnTx(tx, baja, otro.id, false));

    const fila = await tx.usuario.findMany({ where: { id: { in: [d.id, e.id, otro.id] } }, orderBy: { usuario: "asc" } });
    comprobar("nada cambio", fila.map((u) => `${u.usuario}:${u.rol}:${u.activo}`).join(" "), "test44.dueno:DUENO:true test44.empleado:EMPLEADO:true test44.otro:EMPLEADO:true");
    comprobar("las claves tampoco", String(fila.every((u) => u.hashClave === hashDeCLAVE)), "true");
    comprobar("no se creo ningun usuario", String(await tx.usuario.count({ where: { usuario: "test44.nuevo" } })), "0");
  });

  // ─── Baja y reactivacion ────────────────────────────────────────────────────
  await escenario("Baja y reactivacion (logicas) cierran sesiones", async (tx) => {
    const d = await crear(tx, "test44.dueno", "DUENO");
    const e = await crear(tx, "test44.empleado", "EMPLEADO");
    await soloDuenosActivos(tx, [d.id]);
    const s1 = await crearSesion(tx, e.id);
    await crearSesion(tx, e.id);
    comprobar("el empleado tiene 2 sesiones", String(await sesiones(tx, e.id)), "2");

    const baja = await cambiarActivoUsuarioEnTx(tx, d, e.id, false);
    comprobar("la baja cambia", String(baja.cambio), "true");
    const fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("queda inactivo y no se borra", `${fila.activo}`, "false");
    comprobar("se cerraron sus sesiones", String(await sesiones(tx, e.id)), "0");
    comprobar("el token viejo no vale", String(await resolverSesion(tx, s1.token)), "null");
    comprobar("no puede entrar", String((await iniciarSesion(tx, "test44.empleado", CLAVE)).ok), "false");
    comprobar("dar de baja otra vez no hace nada", String((await cambiarActivoUsuarioEnTx(tx, d, e.id, false)).cambio), "false");

    const alta = await cambiarActivoUsuarioEnTx(tx, d, e.id, true);
    comprobar("la reactivacion cambia", String(alta.cambio), "true");
    comprobar("vuelve a entrar con su clave de siempre", String((await iniciarSesion(tx, "test44.empleado", CLAVE)).ok), "true");
    comprobar("el usuario es el mismo (id)", String((await tx.usuario.findUnique({ where: { id: e.id } }))?.usuario), "test44.empleado");

    await rechaza("id inexistente", "no existe", () => cambiarActivoUsuarioEnTx(tx, d, "00000000-0000-4000-8000-000000000000", false));
  });

  await escenario("El ultimo dueno activo no se puede dar de baja", async (tx) => {
    const d = await crear(tx, "test44.dueno", "DUENO");
    const e = await crear(tx, "test44.empleado", "EMPLEADO");
    await soloDuenosActivos(tx, [d.id]);
    const s = await crearSesion(tx, d.id);

    await rechaza("el unico dueno se da de baja a si mismo", "último dueño activo", () => cambiarActivoUsuarioEnTx(tx, d, d.id, false));
    comprobar("sigue activo", String((await tx.usuario.findUniqueOrThrow({ where: { id: d.id } })).activo), "true");
    comprobar("y con su sesion", String((await resolverSesion(tx, s.token))?.usuario.id === d.id), "true");

    // Con un segundo dueno la regla pasa a ser "uno mismo no".
    const d2 = await crear(tx, "test44.dueno2", "DUENO");
    await rechaza("con otro dueno activo, darse de baja a uno mismo", "No podés dar de baja tu propio usuario", () =>
      cambiarActivoUsuarioEnTx(tx, d, d.id, false),
    );
    comprobar("un dueno da de baja a otro dueno", String((await cambiarActivoUsuarioEnTx(tx, d, d2.id, false)).cambio), "true");
    await rechaza("ahora el que queda es el ultimo", "último dueño activo", () => cambiarActivoUsuarioEnTx(tx, d, d.id, false));
    await rechaza("el dueno dado de baja ya no puede administrar", "ya no tiene permiso", () => cambiarActivoUsuarioEnTx(tx, d2, d.id, false));
    comprobar("reactivar al otro dueno", String((await cambiarActivoUsuarioEnTx(tx, d, d2.id, true)).cambio), "true");
    comprobar("el empleado se da de baja sin problema", String((await cambiarActivoUsuarioEnTx(tx, d, e.id, false)).cambio), "true");
  });

  // ─── Cambio de rol ──────────────────────────────────────────────────────────
  await escenario("Cambio de rol cierra sesiones y respeta al ultimo dueno", async (tx) => {
    const d = await crear(tx, "test44.dueno", "DUENO");
    const e = await crear(tx, "test44.empleado", "EMPLEADO");
    await soloDuenosActivos(tx, [d.id]);
    const sE = await crearSesion(tx, e.id);

    comprobar("empleado a dueno", String((await cambiarRolUsuarioEnTx(tx, d, e.id, "DUENO")).cambio), "true");
    comprobar("rol guardado", (await tx.usuario.findUniqueOrThrow({ where: { id: e.id } })).rol, "DUENO");
    comprobar("sus sesiones se cerraron", String(await resolverSesion(tx, sE.token)), "null");
    comprobar("mismo rol: sin cambio", String((await cambiarRolUsuarioEnTx(tx, d, e.id, "DUENO")).cambio), "false");

    // Ahora hay dos duenos: d degrada a e.
    const sE2 = await crearSesion(tx, e.id);
    comprobar("dueno a empleado (hay otro dueno)", String((await cambiarRolUsuarioEnTx(tx, d, e.id, "EMPLEADO")).cambio), "true");
    comprobar("sesiones cerradas tambien al bajar el rol", String(await resolverSesion(tx, sE2.token)), "null");

    await rechaza("el unico dueno no se degrada a si mismo", "último dueño activo", () => cambiarRolUsuarioEnTx(tx, d, d.id, "EMPLEADO"));
    comprobar("sigue siendo dueno", (await tx.usuario.findUniqueOrThrow({ where: { id: d.id } })).rol, "DUENO");

    const d2 = await crear(tx, "test44.dueno2", "DUENO");
    await rechaza("con otro dueno, tampoco cambia su propio rol", "No podés cambiar tu propio rol", () =>
      cambiarRolUsuarioEnTx(tx, d, d.id, "EMPLEADO"),
    );
    for (const rol of ["ADMIN", "dueno", "", null, undefined, 7, {}]) {
      await rechaza(`rol invalido ${JSON.stringify(rol) ?? "undefined"}`, "rol válido", () => cambiarRolUsuarioEnTx(tx, d, d2.id, rol));
    }
    comprobar("d2 no cambio", (await tx.usuario.findUniqueOrThrow({ where: { id: d2.id } })).rol, "DUENO");

    // Un dueno dado de baja no cuenta como "otro dueno activo".
    await cambiarActivoUsuarioEnTx(tx, d, d2.id, false);
    await rechaza("con el otro dueno dado de baja, d vuelve a ser el ultimo", "último dueño activo", () =>
      cambiarRolUsuarioEnTx(tx, d, d.id, "EMPLEADO"),
    );
    comprobar("degradar a un dueno ya dado de baja si se puede", String((await cambiarRolUsuarioEnTx(tx, d, d2.id, "EMPLEADO")).cambio), "true");
    await rechaza("id inexistente", "no existe", () => cambiarRolUsuarioEnTx(tx, d, "00000000-0000-4000-8000-000000000000", "EMPLEADO"));
  });

  // ─── Clave de otro usuario ──────────────────────────────────────────────────
  await escenario("Reseteo de la clave de otro: sesiones y pausa", async (tx) => {
    const d = await crear(tx, "test44.dueno", "DUENO");
    const e = await crear(tx, "test44.empleado", "EMPLEADO");
    await soloDuenosActivos(tx, [d.id]);
    const sE = await crearSesion(tx, e.id);
    const sD = await crearSesion(tx, d.id);

    const t = new Date();
    for (let i = 0; i < 5; i++) await verificarCredenciales(tx, "test44.empleado", `mala-${i}-xxxxxxxx`, new Date(t.getTime() + i * 1000));
    let fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("el empleado quedo en pausa por 5 fallos", `${fila.intentosFallidos}/${fila.bloqueadoHasta !== null}`, "5/true");
    comprobar("en pausa ni la clave correcta entra", String((await verificarCredenciales(tx, "test44.empleado", CLAVE, new Date(t.getTime() + 6000))).ok), "false");

    await rechaza("clave corta", "al menos 10", () => resetearClaveUsuarioEnTx(tx, d, e.id, "corta"));
    await rechaza("clave de solo espacios", "solo espacios", () => resetearClaveUsuarioEnTx(tx, d, e.id, " ".repeat(12)));
    await rechaza("clave enorme", "hasta 200", () => resetearClaveUsuarioEnTx(tx, d, e.id, "x".repeat(201)));
    fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("las rechazadas no tocaron nada", String(fila.hashClave === hashDeCLAVE && fila.intentosFallidos === 5), "true");

    await resetearClaveUsuarioEnTx(tx, d, e.id, CLAVE_NUEVA);
    fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("se limpian intentos, ultimo fallo y pausa", `${fila.intentosFallidos}/${fila.ultimoFalloEn}/${fila.bloqueadoHasta}`, "0/null/null");
    comprobar("la clave guardada es la nueva", String(await verificarClave(CLAVE_NUEVA, fila.hashClave)), "true");
    comprobar("la vieja ya no sirve", String((await iniciarSesion(tx, "test44.empleado", CLAVE)).ok), "false");
    comprobar("la nueva entra enseguida (sin esperar la pausa)", String((await iniciarSesion(tx, "test44.empleado", CLAVE_NUEVA)).ok), "true");
    comprobar("sus sesiones anteriores se cerraron", String(await resolverSesion(tx, sE.token)), "null");
    comprobar("las del dueno no", String((await resolverSesion(tx, sD.token))?.usuario.id === d.id), "true");

    await rechaza("el dueno no se resetea a si mismo por esta via", "Cambiar mi clave", () => resetearClaveUsuarioEnTx(tx, d, d.id, CLAVE_NUEVA));
    await rechaza("id inexistente", "no existe", () => resetearClaveUsuarioEnTx(tx, d, "00000000-0000-4000-8000-000000000000", CLAVE_NUEVA));

    const baja = await crear(tx, "test44.baja", "EMPLEADO", false);
    await resetearClaveUsuarioEnTx(tx, d, baja.id, CLAVE_NUEVA);
    comprobar("a un usuario dado de baja tambien se le puede resetear (sigue de baja)", String((await tx.usuario.findUniqueOrThrow({ where: { id: baja.id } })).activo), "false");
  });

  // ─── Clave propia ───────────────────────────────────────────────────────────
  await escenario("Cambiar la clave propia: pide la actual, valida, cierra sesiones", async (tx) => {
    const e = await crear(tx, "test44.empleado", "EMPLEADO");
    const s1 = await crearSesion(tx, e.id);
    const s2 = await crearSesion(tx, e.id);
    const datos = { actual: CLAVE, nueva: CLAVE_NUEVA, repetir: CLAVE_NUEVA };

    await rechaza("sin clave actual", "Escribí tu clave actual", () => cambiarClavePropia(tx, e, { ...datos, actual: "" }));
    await rechaza("clave actual incorrecta", ERROR_CLAVE_ACTUAL, () => cambiarClavePropia(tx, e, { ...datos, actual: "no-es-esta-clave-1" }));
    let fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("el intento fallido cuenta para la pausa", String(fila.intentosFallidos), "1");
    comprobar("la clave no cambio", String(fila.hashClave === hashDeCLAVE), "true");
    comprobar("las sesiones siguen", String(await sesiones(tx, e.id)), "2");

    await rechaza("nueva corta", "al menos 10", () => cambiarClavePropia(tx, e, { ...datos, nueva: "corta", repetir: "corta" }));
    await rechaza("nueva de 9 caracteres", "al menos 10", () => cambiarClavePropia(tx, e, { ...datos, nueva: "123456789", repetir: "123456789" }));
    await rechaza("las dos nuevas no coinciden", "no coinciden", () => cambiarClavePropia(tx, e, { ...datos, repetir: `${CLAVE_NUEVA}x` }));
    await rechaza("nueva igual a la actual", "distinta de la actual", () => cambiarClavePropia(tx, e, { ...datos, nueva: CLAVE, repetir: CLAVE }));
    fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("nada de eso toco la base ni conto como fallo", `${fila.intentosFallidos}/${fila.hashClave === hashDeCLAVE}`, "1/true");

    const ahora = new Date();
    const nueva = await cambiarClavePropia(tx, e, datos, ahora);
    fila = await tx.usuario.findUniqueOrThrow({ where: { id: e.id } });
    comprobar("la clave nueva queda guardada", String(await verificarClave(CLAVE_NUEVA, fila.hashClave)), "true");
    comprobar("el contador de fallos vuelve a cero", String(fila.intentosFallidos), "0");
    comprobar("entra con la nueva", String((await iniciarSesion(tx, "test44.empleado", CLAVE_NUEVA)).ok), "true");
    comprobar("no entra con la vieja", String((await iniciarSesion(tx, "test44.empleado", CLAVE)).ok), "false");
    comprobar("ambas sesiones anteriores quedaron invalidas", `${await resolverSesion(tx, s1.token)}/${await resolverSesion(tx, s2.token)}`, "null/null");
    comprobar("se devuelve una sesion nueva y vale", String((await resolverSesion(tx, nueva.token))?.usuario.id === e.id), "true");
    comprobar("el token nuevo es otro", String(hashDeToken(nueva.token) !== hashDeToken(s1.token)), "true");
    comprobar("la base guarda solo el hash del token", String((await tx.sesion.findFirst({ where: { tokenHash: hashDeToken(nueva.token) } })) !== null), "true");
  });

  await escenario("Cambiar la clave propia respeta la pausa por intentos fallidos", async (tx) => {
    const e = await crear(tx, "test44.empleado", "EMPLEADO");
    const datos = { actual: CLAVE, nueva: CLAVE_NUEVA, repetir: CLAVE_NUEVA };
    const t = new Date();
    for (let i = 0; i < 5; i++) {
      await rechaza(`intento ${i + 1} con la actual mal`, ERROR_CLAVE_ACTUAL, () =>
        cambiarClavePropia(tx, e, { ...datos, actual: `mala-${i}-xxxxxxxx` }, new Date(t.getTime() + i * 1000)),
      );
    }
    await rechaza("en pausa, ni la actual correcta sirve", ERROR_CLAVE_ACTUAL, () => cambiarClavePropia(tx, e, datos, new Date(t.getTime() + 6000)));
    comprobar("la clave sigue siendo la vieja", String((await tx.usuario.findUniqueOrThrow({ where: { id: e.id } })).hashClave === hashDeCLAVE), "true");
    const luego = new Date(t.getTime() + 20 * 60_000);
    await cambiarClavePropia(tx, e, datos, luego);
    comprobar("pasada la pausa, con la actual correcta cambia", String(await verificarClave(CLAVE_NUEVA, (await tx.usuario.findUniqueOrThrow({ where: { id: e.id } })).hashClave)), "true");
  });

  await escenario("Lectura: nunca sale el hash de la clave", async (tx) => {
    const d = await crear(tx, "test44.dueno", "DUENO");
    const lista = await getUsuarios(d);
    comprobar("hay usuarios", String(lista.usuarios.length > 0 && !lista.esDemo), "true");
    const json = JSON.stringify(lista);
    comprobar("el hash no esta en el resultado", String(json.includes("scrypt$") || json.includes("hashClave")), "false");
    comprobar("campos del listado", Object.keys(lista.usuarios[0] ?? {}).sort().join(","), "activo,creadoEn,enPausa,id,nombre,rol,usuario");
    // `getUsuario` lee con el cliente global (fuera de esta transaccion): se usa un usuario ya guardado.
    const uno = await getUsuario(d, lista.usuarios[0]!.id);
    comprobar("detalle sin hash ni sesiones", String(JSON.stringify(uno).includes("scrypt$") || JSON.stringify(uno).includes("tokenHash")), "false");
    comprobar("campos del detalle", Object.keys(uno ?? {}).sort().join(","), "activo,creadoEn,enPausa,esUltimoDuenoActivo,id,nombre,rol,usuario");
    comprobar("usuario inexistente: null", String(await getUsuario(d, "00000000-0000-4000-8000-000000000000")), "null");
  });

  await probarConcurrencia();

  console.log("");
  if (fallos > 0) {
    console.log(`${fallos} comprobacion(es) fallaron.`);
    process.exit(1);
  }
  console.log("Todas las comprobaciones pasaron.");
}

// ─── Concurrencia (transacciones de verdad) ───────────────────────────────────

const PREFIJO = "test44.";

async function limpiarTemporales() {
  const temporales = await prisma.usuario.findMany({ where: { usuario: { startsWith: PREFIJO } }, select: { id: true } });
  const ids = temporales.map((u) => u.id);
  await prisma.sesion.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
}

type Resultado = PromiseSettledResult<unknown>;
const cuantosOk = (rs: Resultado[]) => rs.filter((r) => r.status === "fulfilled").length;
const todosNegocio = (rs: Resultado[]) =>
  rs.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ErrorDeNegocio);

async function duenosActivosTemporales() {
  return prisma.usuario.count({ where: { usuario: { startsWith: PREFIJO }, rol: "DUENO", activo: true } });
}

/**
 * Operaciones simultaneas en transacciones separadas. Los duenos activos que ya
 * existan se pasan a EMPLEADO mientras dura la prueba y se restauran al final.
 */
async function probarConcurrencia() {
  console.log("--- Concurrencia: dos operaciones a la vez no dejan cero duenos ---");
  await limpiarTemporales();
  const ajenos = await prisma.usuario.findMany({
    where: { rol: "DUENO", activo: true, NOT: { usuario: { startsWith: PREFIJO } } },
    select: { id: true },
  });
  if (ajenos.length > 0) console.log(`     (se estacionan ${ajenos.length} dueño(s) existentes como EMPLEADO y se restauran al final)`);

  const op = <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn, { timeout: 60_000, maxWait: 30_000 });

  try {
    if (ajenos.length > 0) {
      await prisma.usuario.updateMany({ where: { id: { in: ajenos.map((a) => a.id) } }, data: { rol: "EMPLEADO" } });
    }

    // 1. Dos duenos se dan de baja entre si, varias veces.
    for (let i = 1; i <= 4; i++) {
      const a = await crear(prisma, `${PREFIJO}a${i}`, "DUENO");
      const b = await crear(prisma, `${PREFIJO}b${i}`, "DUENO");
      const rs = await Promise.allSettled([
        op((tx) => cambiarActivoUsuarioEnTx(tx, a, b.id, false)),
        op((tx) => cambiarActivoUsuarioEnTx(tx, b, a.id, false)),
      ]);
      comprobar(`ronda ${i}: A y B se dan de baja a la vez, solo una prospera`, `${cuantosOk(rs)}`, "1");
      comprobar(`ronda ${i}: la otra recibe un mensaje de negocio`, String(todosNegocio(rs)), "true");
      comprobar(`ronda ${i}: queda 1 dueño activo`, String(await duenosActivosTemporales()), "1");
      await limpiarTemporales();
    }

    // 2. Uno degrada al otro mientras el otro lo da de baja.
    for (let i = 1; i <= 4; i++) {
      const a = await crear(prisma, `${PREFIJO}c${i}`, "DUENO");
      const b = await crear(prisma, `${PREFIJO}d${i}`, "DUENO");
      const rs = await Promise.allSettled([
        op((tx) => cambiarRolUsuarioEnTx(tx, a, b.id, "EMPLEADO")),
        op((tx) => cambiarActivoUsuarioEnTx(tx, b, a.id, false)),
      ]);
      comprobar(`ronda ${i}: degradar y dar de baja a la vez, solo una prospera`, `${cuantosOk(rs)}`, "1");
      comprobar(`ronda ${i}: queda 1 dueño activo`, String(await duenosActivosTemporales()), "1");
      await limpiarTemporales();
    }

    // 3. Dos degradaciones cruzadas.
    {
      const a = await crear(prisma, `${PREFIJO}e1`, "DUENO");
      const b = await crear(prisma, `${PREFIJO}f1`, "DUENO");
      const rs = await Promise.allSettled([
        op((tx) => cambiarRolUsuarioEnTx(tx, a, b.id, "EMPLEADO")),
        op((tx) => cambiarRolUsuarioEnTx(tx, b, a.id, "EMPLEADO")),
      ]);
      comprobar("degradaciones cruzadas: solo una prospera", `${cuantosOk(rs)}`, "1");
      comprobar("degradaciones cruzadas: queda 1 dueño activo", String(await duenosActivosTemporales()), "1");
      await limpiarTemporales();
    }

    // 4. Muchas operaciones juntas sobre tres duenos: nunca cero.
    {
      const [a, b, c] = [
        await crear(prisma, `${PREFIJO}g1`, "DUENO"),
        await crear(prisma, `${PREFIJO}g2`, "DUENO"),
        await crear(prisma, `${PREFIJO}g3`, "DUENO"),
      ];
      const rs = await Promise.allSettled([
        op((tx) => cambiarActivoUsuarioEnTx(tx, a, b.id, false)),
        op((tx) => cambiarActivoUsuarioEnTx(tx, b, c.id, false)),
        op((tx) => cambiarActivoUsuarioEnTx(tx, c, a.id, false)),
        op((tx) => cambiarRolUsuarioEnTx(tx, a, c.id, "EMPLEADO")),
        op((tx) => cambiarRolUsuarioEnTx(tx, b, a.id, "EMPLEADO")),
        op((tx) => cambiarRolUsuarioEnTx(tx, c, b.id, "EMPLEADO")),
      ]);
      const quedan = await duenosActivosTemporales();
      comprobar("6 operaciones cruzadas sobre 3 dueños: queda al menos 1", String(quedan >= 1), "true");
      comprobar("las que no prosperaron fueron errores de negocio", String(todosNegocio(rs)), "true");
      console.log(`     (prosperaron ${cuantosOk(rs)} de 6; quedan ${quedan} dueño(s) activo(s))`);
      await limpiarTemporales();
    }

    // 5. Dos altas del mismo usuario a la vez: una sola.
    {
      const d = await crear(prisma, `${PREFIJO}h1`, "DUENO");
      const alta = () => op((tx) => crearUsuarioComoDuenoEnTx(tx, d, { usuario: `${PREFIJO}igual`, nombre: "Igual", rol: "EMPLEADO", clave: CLAVE }));
      const rs = await Promise.allSettled([alta(), alta()]);
      comprobar("dos altas simultaneas del mismo usuario: una prospera", `${cuantosOk(rs)}`, "1");
      comprobar("y queda un solo usuario", String(await prisma.usuario.count({ where: { usuario: `${PREFIJO}igual` } })), "1");
      await limpiarTemporales();
    }

    // 6. Cambio de clave propia con la verificacion fuera de la transaccion: el fallo queda contado.
    {
      const e = await crear(prisma, `${PREFIJO}i1`, "EMPLEADO");
      const vieja = await crearSesion(prisma, e.id);
      const datos = { actual: CLAVE, nueva: CLAVE_NUEVA, repetir: CLAVE_NUEVA };
      await rechaza("clave actual mala con el cliente real", ERROR_CLAVE_ACTUAL, () => cambiarClavePropia(prisma, e, { ...datos, actual: "mala-mala-mala" }));
      comprobar("el intento fallido quedo anotado (no se deshizo)", String((await prisma.usuario.findUniqueOrThrow({ where: { id: e.id } })).intentosFallidos), "1");
      const nueva = await cambiarClavePropia(prisma, e, datos);
      comprobar("con el cliente real tambien cambia", String(await verificarClave(CLAVE_NUEVA, (await prisma.usuario.findUniqueOrThrow({ where: { id: e.id } })).hashClave)), "true");
      comprobar("queda una sola sesion y es la nueva", `${await prisma.sesion.count({ where: { usuarioId: e.id } })}/${(await resolverSesion(prisma, nueva.token))?.usuario.id === e.id}`, "1/true");
      comprobar("la sesion vieja ya no vale", String(await resolverSesion(prisma, vieja.token)), "null");
      await limpiarTemporales();
    }
  } finally {
    await limpiarTemporales();
    if (ajenos.length > 0) {
      await prisma.usuario.updateMany({ where: { id: { in: ajenos.map((a) => a.id) } }, data: { rol: "DUENO" } });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await limpiarTemporales();
    } catch {
      // Sin base no hay nada que limpiar.
    }
    await prisma.$disconnect();
  });
