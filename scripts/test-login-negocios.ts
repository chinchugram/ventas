/**
 * Prueba el login por negocio (multi-tenant F4.1) contra Postgres LOCAL, con el rol de la app
 * (`ventas_app`, sujeto a RLS) y el dueño (`ventas_migrador`) solo para sembrar y limpiar.
 *
 *   DATABASE_URL="postgresql://ventas_app:ventas_app@localhost:5477/ventas_vta15?host=/tmp/pgsock7" \
 *   DATABASE_URL_MIGRACIONES="postgresql://ventas_migrador:ventas_migrador@localhost:5477/ventas_vta15?host=/tmp/pgsock7" \
 *   npx tsx scripts/test-login-negocios.ts
 *
 * Comprueba, con el rol sujeto a RLS y sin Next (salvo el proxy, que se llama como funcion con un
 * `NextRequest` armado a mano):
 *   - sin contexto de negocio `usuarios` y `sesiones` no muestran nada (por eso el login declara el negocio);
 *   - login por slug: el usuario de A no entra en B ni con la clave correcta; mismo nombre de usuario
 *     en dos negocios; slug inexistente / reservado / invalido = misma respuesta que clave mala;
 *   - la cookie `<negocioId>.<token>`: cambiar el negocio, usar el token solo o inventar uno no da acceso;
 *   - negocio suspendido: no se entra y las sesiones abiertas dejan de valer;
 *   - el alta de usuarios escribe `negocioId` (y RLS rechaza un negocio ajeno);
 *   - el dueño administra solo los usuarios de su negocio;
 *   - `getNegocioId()` sale de la sesion y no de lo que mande el cliente;
 *   - el proxy: sin sesion → /login, cookie trucha → /login y se borra, `/admin/**` responde 403 a los roles de un negocio;
 *   - el SUPERADMIN (F4.3): entra con el "negocio" `admin`, su cookie es `admin.<token>`, su sesion no tiene negocio,
 *     no entra a un negocio ni un usuario de negocio entra como `admin`, no ve ni toca usuarios/sesiones de un
 *     negocio (ni al reves), el proxy lo encierra en `/admin/**` y `getNegocioId()` lanza con su cookie;
 *   - la clave inicial con cambio obligatorio (`debeCambiarClave`): el proxy solo deja entrar a `/usuarios/mi-clave`.
 * Limpia todo lo que siembra en un `finally`.
 */
import "dotenv/config";
import Module from "node:module";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

// ─── Contexto de pedido falso (solo en este script) ───────────────────────────
let cookieActual: string | undefined;
const falsos: Record<string, unknown> = {
  "next/headers": {
    cookies: async () => ({
      get: (nombre: string) => (nombre === "ventas_sesion" && cookieActual !== undefined ? { name: nombre, value: cookieActual } : undefined),
      set: () => undefined,
      delete: () => undefined,
    }),
  },
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "next/navigation": {
    redirect: (destino: string) => {
      throw new Error(`redirect ${destino}`);
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  },
};
const modulo = Module as unknown as { _load: (request: string, ...resto: unknown[]) => unknown };
const cargarOriginal = modulo._load;
modulo._load = function (this: unknown, request: string, ...resto: unknown[]) {
  if (request in falsos) return falsos[request];
  return cargarOriginal.call(this, request, ...resto);
} as typeof modulo._load;

/* eslint-disable @typescript-eslint/no-require-imports */
const { ErrorDeNegocio } = require("../src/lib/acciones") as typeof import("../src/lib/acciones");
const { armarValorDeCookie, hashearClave } = require("../src/lib/auth-pura") as typeof import("../src/lib/auth-pura");
const dominio = require("../src/lib/dominio/auth") as typeof import("../src/lib/dominio/auth");
const usuariosDominio = require("../src/lib/dominio/usuarios") as typeof import("../src/lib/dominio/usuarios");
const { conNegocio, getNegocioId, negocioActual } = require("../src/lib/negocio") as typeof import("../src/lib/negocio");
const { getUsuarios } = require("../src/lib/queries/usuarios") as typeof import("../src/lib/queries/usuarios");
const { NextRequest } = require("next/server") as typeof import("next/server");
/* eslint-enable @typescript-eslint/no-require-imports */

let fallos = 0;
function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK   " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

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
const URL_APP = process.env.DATABASE_URL ?? "";
const URL_MIG = process.env.DATABASE_URL_MIGRACIONES ?? "";
if (!URL_APP || !URL_MIG || !esLocal(URL_APP) || !esLocal(URL_MIG)) {
  console.error("Hacen falta DATABASE_URL (ventas_app) y DATABASE_URL_MIGRACIONES (ventas_migrador), ambas LOCALES. Nunca contra Neon.");
  process.exit(1);
}
const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL_MIG }) });
const app = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL_APP }) });

const MARCA = `zz-f41-${randomBytes(3).toString("hex")}`;
const SLUG_A = `${MARCA}-a`;
const SLUG_B = `${MARCA}-b`;
const CLAVE_A = "clave-del-negocio-a-123";
const CLAVE_B = "clave-del-negocio-b-456";

async function rechazaConRls(etiqueta: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "aceptada", "rechazada por RLS");
  } catch (error) {
    const texto = String(error instanceof Error ? error.message : error);
    comprobar(etiqueta, /row-level security|violates|usuario que no existe o es de otro negocio/i.test(texto) ? "rechazada por RLS" : texto, "rechazada por RLS");
  }
}

async function main() {
  const rol = await app.$queryRaw<{ rolname: string; omite: boolean }[]>`SELECT rolname, (rolsuper OR rolbypassrls) AS omite FROM pg_roles WHERE rolname = current_user`;
  comprobar("DATABASE_URL es el rol de la app (sin SUPERUSER ni BYPASSRLS)", String(rol[0]?.omite), "false");

  // ─── Siembra (rol migrador) ─────────────────────────────────────────────────
  const hashA = await hashearClave(CLAVE_A);
  const hashB = await hashearClave(CLAVE_B);
  const negA = await admin.negocio.create({ data: { nombre: "Negocio A", slug: SLUG_A }, select: { id: true } });
  const negB = await admin.negocio.create({ data: { nombre: "Negocio B", slug: SLUG_B }, select: { id: true } });
  const sembrar = (negocioId: string, usuario: string, rolU: "DUENO" | "EMPLEADO", hashClave: string) =>
    admin.usuario.create({ data: { negocioId, usuario, nombre: `${usuario} (${negocioId.slice(0, 4)})`, rol: rolU, hashClave }, select: { id: true } });
  const dueA = await sembrar(negA.id, "laura", "DUENO", hashA);
  const empA = await sembrar(negA.id, "mostrador", "EMPLEADO", hashA);
  const dueB = await sembrar(negB.id, "laura", "DUENO", hashB);
  const empB = await sembrar(negB.id, "mostrador", "EMPLEADO", hashB);

  console.log("--- Sin contexto de negocio, usuarios y sesiones no se ven ---");
  comprobar("usuarios sin contexto", String(await app.usuario.count()), "0");
  comprobar("sesiones sin contexto", String(await app.sesion.count()), "0");
  comprobar("negocios si (tabla global)", String((await app.negocio.count({ where: { slug: { in: [SLUG_A, SLUG_B] } } })) === 2), "true");

  // ─── Login ──────────────────────────────────────────────────────────────────
  console.log("--- Login por negocio ---");
  const enA = await dominio.iniciarSesion(app, SLUG_A, "laura", CLAVE_A);
  const enB = await dominio.iniciarSesion(app, ` ${SLUG_B.toUpperCase()} `, "LAURA", CLAVE_B);
  comprobar("laura entra en A", String(enA.ok && enA.negocioId === negA.id && enA.usuario.id === dueA.id), "true");
  comprobar("laura (otra persona) entra en B, aun con mayusculas y espacios", String(enB.ok && enB.negocioId === negB.id && enB.usuario.id === dueB.id), "true");
  if (!enA.ok || !enB.ok) throw new Error("No se pudo iniciar sesion en A o en B: no se sigue.");

  comprobar("el usuario de A no entra en B (clave de A)", JSON.stringify(await dominio.iniciarSesion(app, SLUG_B, "laura", CLAVE_A)), '{"ok":false}');
  comprobar("ni en A con la clave de B", JSON.stringify(await dominio.iniciarSesion(app, SLUG_A, "laura", CLAVE_B)), '{"ok":false}');
  for (const slug of ["no-existe-nada", "admin", "API", "x", "con espacio", "", "a".repeat(60)]) {
    comprobar(`slug ${JSON.stringify(slug.slice(0, 15))}: misma respuesta que una clave mala`, JSON.stringify(await dominio.iniciarSesion(app, slug, "laura", CLAVE_A)), '{"ok":false}');
  }
  comprobar("la sesion de laura/A resuelve al negocio A", String((await dominio.resolverSesion(app, enA.valorCookie))?.usuario.negocioId === negA.id), "true");
  comprobar("la de laura/B al negocio B", String((await dominio.resolverSesion(app, enB.valorCookie))?.usuario.negocioId === negB.id), "true");

  // La cookie: el negocio es una pista, no un permiso.
  console.log("--- Cookie: cambiarla a mano no cambia de negocio ---");
  comprobar("token de A con el negocio de B", String(await dominio.resolverSesion(app, armarValorDeCookie(negB.id, enA.token))), "null");
  comprobar("token de B con el negocio de A", String(await dominio.resolverSesion(app, armarValorDeCookie(negA.id, enB.token))), "null");
  comprobar("negocio inexistente", String(await dominio.resolverSesion(app, armarValorDeCookie("11111111-1111-4111-8111-111111111111", enA.token))), "null");
  comprobar("el token solo, sin negocio", String(await dominio.resolverSesion(app, enA.token)), "null");
  comprobar("la sesion de A sigue intacta tras esos intentos", String((await dominio.resolverSesion(app, enA.valorCookie)) !== null), "true");
  await dominio.cerrarSesion(app, armarValorDeCookie(negB.id, enA.token));
  comprobar("cerrar con el negocio equivocado no cierra la de A", String((await dominio.resolverSesion(app, enA.valorCookie)) !== null), "true");

  // ─── Pausa por fallos por negocio ───────────────────────────────────────────
  console.log("--- La pausa por fallos cuenta por negocio ---");
  let t = new Date();
  for (let i = 1; i <= 5; i++) {
    await dominio.verificarCredenciales(app, negA.id, "mostrador", `mala-${i}-xxxxxxxx`, t);
    t = new Date(t.getTime() + 1000);
  }
  comprobar("5 fallos de mostrador/A: A en pausa", String((await dominio.verificarCredenciales(app, negA.id, "mostrador", CLAVE_A, t)).ok), "false");
  comprobar("mostrador/B (mismo nombre) entra", String((await dominio.verificarCredenciales(app, negB.id, "mostrador", CLAVE_B, t)).ok), "true");

  // ─── Alta bajo RLS ──────────────────────────────────────────────────────────
  console.log("--- Alta de usuarios bajo RLS ---");
  const nuevoA = await conNegocio(negA.id, (tx) =>
    dominio.crearUsuarioEnTx(tx, { negocioId: negA.id, usuario: "nuevo.en.a", nombre: "Nuevo en A", rol: "EMPLEADO", clave: CLAVE_A }),
  );
  comprobar("alta con negocioId explicito", String(nuevoA.negocioId === negA.id), "true");
  const sinIndicar = await conNegocio(negA.id, (tx) =>
    dominio.crearUsuarioEnTx(tx, { usuario: "nuevo.en.a2", nombre: "Nuevo en A 2", rol: "EMPLEADO", clave: CLAVE_A }),
  );
  comprobar("alta sin negocioId: usa el del contexto (antes fallaba bajo RLS)", String(sinIndicar.negocioId === negA.id), "true");
  comprobar("la fila quedo con su negocio", String((await admin.usuario.findUniqueOrThrow({ where: { id: nuevoA.id } })).negocioId === negA.id), "true");
  await rechazaConRls("alta con el negocio de otro: la rechaza RLS", () =>
    conNegocio(negA.id, (tx) => tx.usuario.create({ data: { negocioId: negB.id, usuario: "ajeno", nombre: "Ajeno", rol: "EMPLEADO", hashClave: hashA } })),
  );
  comprobar("el mismo usuario puede repetirse entre negocios (laura en A y B)", String((await admin.usuario.count({ where: { usuario: "laura", negocioId: { in: [negA.id, negB.id] } } })) === 2), "true");

  // ─── Administracion de usuarios del dueno ───────────────────────────────────
  console.log("--- El dueno administra solo los usuarios de su negocio ---");
  const dueñoA = enA.usuario as import("../src/lib/auth-pura").UsuarioSesion;
  const ajeno = async (etiqueta: string, fn: (tx: Parameters<Parameters<typeof conNegocio>[1]>[0]) => Promise<unknown>) => {
    try {
      await conNegocio(negA.id, fn);
      comprobar(etiqueta, "no lanzo error", "no existe");
    } catch (error) {
      comprobar(etiqueta, error instanceof ErrorDeNegocio && error.message.includes("no existe") ? "no existe" : String(error), "no existe");
    }
  };
  await ajeno("baja de un usuario de B", (tx) => usuariosDominio.cambiarActivoUsuarioEnTx(tx, dueñoA, empB.id, false));
  await ajeno("cambio de rol de un usuario de B", (tx) => usuariosDominio.cambiarRolUsuarioEnTx(tx, dueñoA, empB.id, "DUENO"));
  await ajeno("reseteo de clave de un usuario de B", (tx) => usuariosDominio.resetearClaveUsuarioEnTx(tx, dueñoA, empB.id, "una-clave-nueva-789"));
  const filaB = await admin.usuario.findUniqueOrThrow({ where: { id: empB.id } });
  comprobar("el usuario de B quedo intacto", `${filaB.activo}/${filaB.rol}/${filaB.hashClave === hashB}`, "true/EMPLEADO/true");
  const lista = await getUsuarios(dueñoA);
  const ids = lista.usuarios.map((u) => u.id);
  comprobar("el listado de A trae a los de A", String(ids.includes(dueA.id) && ids.includes(empA.id) && ids.includes(nuevoA.id)), "true");
  comprobar("y ninguno de B", String(ids.includes(dueB.id) || ids.includes(empB.id)), "false");
  comprobar("alta como dueno de A queda en A", String((await conNegocio(negA.id, (tx) => usuariosDominio.crearUsuarioComoDuenoEnTx(tx, dueñoA, { usuario: "alta.dueno", nombre: "Alta", rol: "EMPLEADO", clave: CLAVE_A }))).negocioId === negA.id), "true");

  // ─── getNegocioId ───────────────────────────────────────────────────────────
  console.log("--- getNegocioId() sale de la sesion ---");
  const conCookie = async <T>(valor: string | undefined, fn: () => Promise<T>) => {
    cookieActual = valor;
    try {
      return await fn();
    } finally {
      cookieActual = undefined;
    }
  };
  comprobar("cookie de A: negocio A", String((await conCookie(enA.valorCookie, getNegocioId)) === negA.id), "true");
  comprobar("cookie de B: negocio B", String((await conCookie(enB.valorCookie, getNegocioId)) === negB.id), "true");
  comprobar("negocioActual() (alias transitorio) es lo mismo", String((await conCookie(enA.valorCookie, negocioActual)) === negA.id), "true");
  const lanza = async (etiqueta: string, valor: string | undefined) => {
    try {
      await conCookie(valor, getNegocioId);
      comprobar(etiqueta, "devolvio un negocio", "lanza");
    } catch {
      comprobar(etiqueta, "lanza", "lanza");
    }
  };
  await lanza("sin cookie", undefined);
  await lanza("token de A con el negocio de B (cookie trucha)", armarValorDeCookie(negB.id, enA.token));
  await lanza("token solo", enA.token);

  // ─── Proxy ──────────────────────────────────────────────────────────────────
  console.log("--- Proxy: rutas protegidas exigen sesion valida del negocio ---");
  const { proxy } = require("../src/proxy") as typeof import("../src/proxy"); // eslint-disable-line @typescript-eslint/no-require-imports
  const pedir = (ruta: string, valorCookie?: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    proxy(
      new NextRequest(`http://localhost:3000${ruta}`, {
        method: init.method ?? "GET",
        headers: { ...(valorCookie !== undefined ? { cookie: `ventas_sesion=${valorCookie}` } : {}), ...(init.headers ?? {}) },
      }),
    );
  const destino = (r: Response) => {
    const l = r.headers.get("location");
    return l ? `${r.status} ${new URL(l).pathname}${new URL(l).search}` : String(r.status);
  };
  const pasa = (r: Response) => r.headers.get("x-middleware-next") === "1";
  const borraCookie = (r: Response) => /ventas_sesion=;/.test(r.headers.get("set-cookie") ?? "");

  comprobar("sin cookie → /login?siguiente", destino(await pedir("/ventas")), "307 /login?siguiente=%2Fventas");
  comprobar("sin cookie, /login se atiende", String(pasa(await pedir("/login"))), "true");
  comprobar("cookie de A: pasa", String(pasa(await pedir("/ventas", enA.valorCookie))), "true");
  const trucha = await pedir("/ventas", armarValorDeCookie(negB.id, enA.token));
  comprobar("cookie trucha (token de A con negocio de B) → /login", destino(trucha), "307 /login?siguiente=%2Fventas");
  comprobar("...y se borra la cookie", String(borraCookie(trucha)), "true");
  const soloToken = await pedir("/ventas", enA.token);
  comprobar("token sin negocio → /login y se borra", `${destino(soloToken)} ${borraCookie(soloToken)}`, "307 /login?siguiente=%2Fventas true");
  const accionSinSesion = await pedir("/ventas", undefined, { method: "POST", headers: { "next-action": "abc" } });
  comprobar("server action sin sesion → 401", String(accionSinSesion.status), "401");
  const accionTrucha = await pedir("/ventas/nueva", armarValorDeCookie(negB.id, enA.token), { method: "POST", headers: { "next-action": "abc" } });
  comprobar("server action con cookie trucha → 401", String(accionTrucha.status), "401");

  // /admin/** no es de los roles de un negocio.
  comprobar("dueno de A en /admin/negocios → 403", destino(await pedir("/admin/negocios", enA.valorCookie)), "403");
  const enEmp = await dominio.iniciarSesion(app, SLUG_A, "mostrador", CLAVE_A, new Date(Date.now() + 3_600_000));
  if (enEmp.ok) {
    comprobar("empleado de A en /admin → 403", destino(await pedir("/admin", enEmp.valorCookie)), "403");
    comprobar("empleado de A en /ventas/nueva pasa", String(pasa(await pedir("/ventas/nueva", enEmp.valorCookie))), "true");
  } else {
    comprobar("login de mostrador/A (tras su pausa simulada)", "no entro", "entro");
  }
  const accionAdmin = await pedir("/admin/negocios", enA.valorCookie, { method: "POST", headers: { "next-action": "abc" } });
  comprobar("server action sobre /admin/** de un dueno → 403", String(accionAdmin.status), "403");

  // ─── SUPERADMIN ─────────────────────────────────────────────────────────────
  console.log("--- SUPERADMIN: sin negocio, solo /admin/** ---");
  const CLAVE_S = "clave-del-superadmin-789";
  const USUARIO_S = `${MARCA}-root`;
  const sup = await admin.usuario.create({
    data: { negocioId: null, usuario: USUARIO_S, nombre: "Super", rol: "SUPERADMIN", hashClave: await hashearClave(CLAVE_S) },
    select: { id: true },
  });
  const violaCheck = (e: unknown) => {
    throw new Error(/usuarios_superadmin_sin_negocio/.test(String(e)) ? "violates check" : String(e));
  };
  const violaTrigger = (e: unknown) => {
    throw new Error(/tiene que ser el negocio del usuario/.test(String(e)) ? "violates trigger" : String(e));
  };
  await rechazaConRls("un usuario SUPERADMIN con negocio lo rechaza el CHECK", () =>
    admin.usuario.create({ data: { negocioId: negA.id, usuario: `${MARCA}-malo`, nombre: "x", rol: "SUPERADMIN", hashClave: hashA } }).catch(violaCheck),
  );
  await rechazaConRls("un dueno sin negocio lo rechaza el CHECK", () =>
    admin.usuario.create({ data: { negocioId: null, usuario: `${MARCA}-malo2`, nombre: "x", rol: "DUENO", hashClave: hashA } }).catch(violaCheck),
  );
  comprobar("sin contexto, la app no ve al SUPERADMIN", String(await app.usuario.count({ where: { rol: "SUPERADMIN" } })), "0");

  const enS = await dominio.iniciarSesion(app, " Admin ", USUARIO_S.toUpperCase(), CLAVE_S);
  comprobar("el SUPERADMIN entra con el negocio «admin»", String(enS.ok && enS.negocioId === null && enS.usuario.rol === "SUPERADMIN" && enS.usuario.id === sup.id), "true");
  if (!enS.ok) throw new Error("no entro el SUPERADMIN");
  comprobar("su cookie es admin.<token>", String(enS.valorCookie === `admin.${enS.token}`), "true");
  comprobar("su sesion no tiene negocio", String((await admin.sesion.findFirstOrThrow({ where: { usuarioId: sup.id } })).negocioId === null), "true");
  comprobar("clave mala = no entra", JSON.stringify(await dominio.iniciarSesion(app, "admin", USUARIO_S, "clave-mala-0123456789")), '{"ok":false}');
  comprobar("un usuario de un negocio no entra como «admin»", JSON.stringify(await dominio.iniciarSesion(app, "admin", "laura", CLAVE_A)), '{"ok":false}');
  comprobar("el SUPERADMIN no entra a un negocio", JSON.stringify(await dominio.iniciarSesion(app, SLUG_A, USUARIO_S, CLAVE_S)), '{"ok":false}');
  const resS = await dominio.resolverSesion(app, enS.valorCookie);
  comprobar("resolverSesion da un SUPERADMIN sin negocio", `${resS?.usuario.rol}/${resS?.usuario.negocioId}`, "SUPERADMIN/null");
  comprobar("token del SUPERADMIN con un negocio en la cookie → null", String(await dominio.resolverSesion(app, armarValorDeCookie(negA.id, enS.token))), "null");
  comprobar("token de A con «admin» en la cookie → null", String(await dominio.resolverSesion(app, `admin.${enA.token}`)), "null");
  comprobar("cookie «admin.» con basura → null", String(await dominio.resolverSesion(app, "admin.xxxx")), "null");
  comprobar("la sesion del SUPERADMIN no la ve un contexto de negocio", String(await conNegocio(negA.id, (tx) => tx.sesion.count({ where: { usuarioId: sup.id } }))), "0");
  comprobar("ni su cuenta", String(await conNegocio(negA.id, (tx) => tx.usuario.count({ where: { rol: "SUPERADMIN" } }))), "0");
  comprobar(
    "el contexto de SUPERADMIN no ve usuarios ni sesiones de ningun negocio",
    String(await dominio.conSuperadminEn(app, async (tx) => (await tx.usuario.count({ where: { negocioId: { not: null } } })) + (await tx.sesion.count({ where: { negocioId: { not: null } } })))),
    "0",
  );
  await rechazaConRls("el contexto de SUPERADMIN no puede crear un usuario de un negocio", () =>
    dominio.conSuperadminEn(app, (tx) => tx.usuario.create({ data: { negocioId: negA.id, usuario: "no-deberia", nombre: "x", rol: "EMPLEADO", hashClave: hashA } })),
  );
  await rechazaConRls("un contexto de negocio no puede crear un SUPERADMIN", () =>
    conNegocio(negA.id, (tx) => tx.usuario.create({ data: { negocioId: null, usuario: "no-deberia", nombre: "x", rol: "SUPERADMIN", hashClave: hashA } })),
  );
  await rechazaConRls("ni una sesion sin negocio", () =>
    conNegocio(negA.id, (tx) => tx.sesion.create({ data: { negocioId: null, usuarioId: sup.id, tokenHash: randomBytes(32).toString("hex"), expiraEn: new Date(Date.now() + 60_000) } })),
  );
  await rechazaConRls("una sesion de un negocio para el SUPERADMIN la rechaza el trigger", () =>
    admin.sesion.create({ data: { negocioId: negA.id, usuarioId: sup.id, tokenHash: randomBytes(32).toString("hex"), expiraEn: new Date(Date.now() + 60_000) } }).catch(violaTrigger),
  );
  await rechazaConRls("y una sesion sin negocio para un dueno", () =>
    admin.sesion.create({ data: { negocioId: null, usuarioId: dueA.id, tokenHash: randomBytes(32).toString("hex"), expiraEn: new Date(Date.now() + 60_000) } }).catch(violaTrigger),
  );
  await lanza("getNegocioId con la cookie del SUPERADMIN (no tiene negocio)", enS.valorCookie);

  console.log("--- SUPERADMIN: el proxy ---");
  comprobar("SUPERADMIN en /admin/negocios pasa", String(pasa(await pedir("/admin/negocios", enS.valorCookie))), "true");
  comprobar("SUPERADMIN en /ventas → /admin/negocios", destino(await pedir("/ventas", enS.valorCookie)), "307 /admin/negocios");
  comprobar("SUPERADMIN en / → /admin/negocios", destino(await pedir("/", enS.valorCookie)), "307 /admin/negocios");
  comprobar("server action del SUPERADMIN sobre un negocio → 403", String((await pedir("/ventas", enS.valorCookie, { method: "POST", headers: { "next-action": "abc" } })).status), "403");
  comprobar("la cookie del SUPERADMIN, alterada, no entra", destino(await pedir("/admin/negocios", `admin.${enA.token}`)), "307 /login?siguiente=%2Fadmin%2Fnegocios");
  await dominio.cerrarSesion(app, enS.valorCookie);
  comprobar("cerrar sesion la borra", String(await dominio.resolverSesion(app, enS.valorCookie)), "null");

  console.log("--- Clave inicial con cambio obligatorio ---");
  const hashN = await hashearClave(CLAVE_A);
  const nuevoDueno = await admin.usuario.create({
    data: { negocioId: negA.id, usuario: "nuevo.dueno", nombre: "Nuevo", rol: "DUENO", hashClave: hashN, debeCambiarClave: true },
    select: { id: true },
  });
  const enN = await dominio.iniciarSesion(app, SLUG_A, "nuevo.dueno", CLAVE_A);
  if (!enN.ok) throw new Error("no entro nuevo.dueno");
  comprobar("resolverSesion informa debeCambiarClave", String((await dominio.resolverSesion(app, enN.valorCookie))?.debeCambiarClave), "true");
  comprobar("GET /ventas → /usuarios/mi-clave", destino(await pedir("/ventas", enN.valorCookie)), "307 /usuarios/mi-clave");
  comprobar("GET / → /usuarios/mi-clave", destino(await pedir("/", enN.valorCookie)), "307 /usuarios/mi-clave");
  comprobar("/usuarios/mi-clave pasa", String(pasa(await pedir("/usuarios/mi-clave", enN.valorCookie))), "true");
  comprobar("la accion de cambiar la clave (POST a esa ruta) pasa", String(pasa(await pedir("/usuarios/mi-clave", enN.valorCookie, { method: "POST", headers: { "next-action": "abc" } }))), "true");
  comprobar("otra accion (POST a /ventas) → 403", String((await pedir("/ventas", enN.valorCookie, { method: "POST", headers: { "next-action": "abc" } })).status), "403");
  const cambio = await usuariosDominio.cambiarClavePropia(
    app,
    { id: nuevoDueno.id, negocioId: negA.id, usuario: "nuevo.dueno", nombre: "Nuevo", rol: "DUENO" },
    { actual: CLAVE_A, nueva: "otra-clave-nueva-0123", repetir: "otra-clave-nueva-0123" },
  );
  comprobar("al cambiar la clave se apaga el cambio obligatorio", String((await dominio.resolverSesion(app, cambio.valorCookie))?.debeCambiarClave), "false");
  comprobar("y ya navega: /ventas pasa", String(pasa(await pedir("/ventas", cambio.valorCookie))), "true");

  // Negocio suspendido.
  console.log("--- Negocio suspendido ---");
  await admin.negocio.update({ where: { id: negB.id }, data: { activo: false } });
  comprobar("no se puede entrar a un negocio inactivo", JSON.stringify(await dominio.iniciarSesion(app, SLUG_B, "laura", CLAVE_B)), '{"ok":false}');
  comprobar("la sesion abierta deja de valer", String(await dominio.resolverSesion(app, enB.valorCookie)), "null");
  const susp = await pedir("/ventas", enB.valorCookie);
  comprobar("el proxy la manda a /login", `${destino(susp)} ${borraCookie(susp)}`, "307 /login?siguiente=%2Fventas true");
  comprobar("A sigue funcionando", String(pasa(await pedir("/ventas", enA.valorCookie))), "true");
  await admin.negocio.update({ where: { id: negB.id }, data: { activo: true } });
  comprobar("reactivado: la sesion vuelve a valer", String((await dominio.resolverSesion(app, enB.valorCookie)) !== null), "true");
}

async function limpiar() {
  const negocios = await admin.negocio.findMany({ where: { slug: { startsWith: MARCA } }, select: { id: true } });
  const ids = negocios.map((n) => n.id);
  const sups = (await admin.usuario.findMany({ where: { negocioId: null, usuario: { startsWith: MARCA } }, select: { id: true } })).map((u) => u.id);
  await admin.sesion.deleteMany({ where: { usuarioId: { in: sups } } });
  await admin.usuario.deleteMany({ where: { id: { in: sups } } });
  await admin.sesion.deleteMany({ where: { negocioId: { in: ids } } });
  await admin.usuario.deleteMany({ where: { negocioId: { in: ids } } });
  await admin.negocio.deleteMany({ where: { id: { in: ids } } });
}

main()
  .catch((error) => {
    fallos += 1;
    console.error(error);
  })
  .finally(async () => {
    try {
      await limpiar();
    } catch (error) {
      fallos += 1;
      console.error("No se pudo limpiar:", error);
    }
    await app.$disconnect();
    await admin.$disconnect();
    console.log("");
    if (fallos > 0) {
      console.log(`${fallos} comprobacion(es) fallaron.`);
      process.exit(1);
    }
    console.log("Todo OK.");
    process.exit(0);
  });
