/**
 * Prueba la administracion de negocios del SUPERADMIN (multi-tenant F4.3) contra Postgres LOCAL, con el
 * rol de la app (`ventas_app`, sujeto a RLS) y el migrador (`ventas_migrador`) solo para sembrar, verificar y limpiar.
 *
 *   npm run test:negocios
 *
 *   DATABASE_URL="postgresql://ventas_app:ventas_app@localhost:5477/ventas?host=/tmp/pgsock7" \
 *   DATABASE_URL_MIGRACIONES="postgresql://ventas_migrador:ventas_migrador@localhost:5477/ventas?host=/tmp/pgsock7" \
 *   npm run test:negocios
 *
 * Llama a las server actions de verdad (con `next/headers` y `next/cache` simulados, como `test-login-negocios`),
 * con la cookie de cada rol:
 *   - el SUPERADMIN crea un negocio (nombre + identificador unico, normalizado) y se insertan sus claves de
 *     `Configuracion` por defecto; identificadores repetidos, reservados o mal formados se rechazan; dos altas
 *     simultaneas con el mismo identificador dejan una sola;
 *   - crea su primer dueno (clave inicial con cambio obligatorio); no se crea un segundo; ese dueno entra, tiene que
 *     cambiar la clave y ve un sistema vacio con la configuracion por defecto;
 *   - baja logica y reactivacion: el negocio dado de baja no deja entrar y no se borra nada;
 *   - un DUENO, un EMPLEADO y quien no tiene sesion reciben "no tenes permiso" en TODAS las acciones y no cambian nada;
 *   - el SUPERADMIN ve de cada negocio nombre, estado y cantidad de usuarios y nada mas, y no accede a sus datos;
 *   - los scripts `usuarios:crear-superadmin` y `usuarios:crear-dueno --negocio` (con el rol de la app).
 * Limpia todo lo que siembra en un `finally`.
 */
import "dotenv/config";
import Module from "node:module";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
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
const { hashearClave } = require("../src/lib/auth-pura") as typeof import("../src/lib/auth-pura");
const dominio = require("../src/lib/dominio/auth") as typeof import("../src/lib/dominio/auth");
const usuariosDominio = require("../src/lib/dominio/usuarios") as typeof import("../src/lib/dominio/usuarios");
const negociosDominio = require("../src/lib/dominio/negocios") as typeof import("../src/lib/dominio/negocios");
const { conNegocio, conSuperadmin } = require("../src/lib/negocio") as typeof import("../src/lib/negocio");
const { CLAVES, POR_DEFECTO } = require("../src/lib/configuracion") as typeof import("../src/lib/configuracion");
const { getNegocios } = require("../src/lib/queries/negocios") as typeof import("../src/lib/queries/negocios");
const acciones = require("../src/app/admin/negocios/actions") as typeof import("../src/app/admin/negocios/actions");
const accionesUsuarios = require("../src/app/usuarios/actions") as typeof import("../src/app/usuarios/actions");
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

const MARCA = `zz-f43-${randomBytes(3).toString("hex")}`;
const CLAVE_S = "clave-del-superadmin-789";
const CLAVE_X = "clave-del-negocio-x-123";
const CLAVE_NUEVO = "clave-inicial-del-dueno-456";
const CLAVE_NUEVA = "clave-nueva-del-dueno-789";
const USUARIO_S = `${MARCA}-root`;

type Res = { ok: boolean; error?: string; id?: string };
const comoTexto = (r: Res) => (r.ok ? "ok" : `error: ${r.error}`);

async function conCookie<T>(valor: string | undefined, fn: () => Promise<T>): Promise<T> {
  cookieActual = valor;
  try {
    return await fn();
  } finally {
    cookieActual = undefined;
  }
}

async function main() {
  const rol = await app.$queryRaw<{ rolname: string; omite: boolean }[]>`SELECT rolname, (rolsuper OR rolbypassrls) AS omite FROM pg_roles WHERE rolname = current_user`;
  comprobar("DATABASE_URL es el rol de la app (sin SUPERUSER ni BYPASSRLS)", String(rol[0]?.omite), "false");

  // ─── Siembra (migrador): un negocio existente con su dueno, un empleado y datos ──────────────
  const SLUG_X = `${MARCA}-x`;
  const negX = await admin.negocio.create({ data: { nombre: "Negocio existente", slug: SLUG_X }, select: { id: true } });
  const hashX = await hashearClave(CLAVE_X);
  const duenoX = await admin.usuario.create({ data: { negocioId: negX.id, usuario: "dueno.x", nombre: "Dueño X", rol: "DUENO", hashClave: hashX }, select: { id: true } });
  await admin.usuario.create({ data: { negocioId: negX.id, usuario: "empleado.x", nombre: "Empleado X", rol: "EMPLEADO", hashClave: hashX } });
  await admin.cliente.create({ data: { negocioId: negX.id, nombre: "Cliente secreto de X" } });
  const cuenta = (where: object) => admin.negocio.count({ where });
  const negociosAntes = await cuenta({ slug: { startsWith: MARCA } });

  // ─── El SUPERADMIN: se crea con el dominio (bajo RLS, con el rol de la app) y entra con «admin» ──────
  console.log("--- SUPERADMIN: alta y login ---");
  const sup = await dominio.conSuperadminEn(app, (tx) => dominio.crearSuperadminEnTx(tx, { usuario: USUARIO_S, nombre: "Super", clave: CLAVE_S }));
  comprobar("el SUPERADMIN se crea sin negocio", `${sup.rol}/${sup.negocioId}`, "SUPERADMIN/null");
  let repetido = "";
  try {
    await dominio.conSuperadminEn(app, (tx) => dominio.crearSuperadminEnTx(tx, { usuario: USUARIO_S, nombre: "Otro", clave: CLAVE_S }));
  } catch (e) {
    repetido = e instanceof Error ? e.message : String(e);
  }
  comprobar("un segundo con el mismo usuario se rechaza", repetido, `Ya existe un superadmin "${USUARIO_S}".`);
  const enS = await dominio.iniciarSesion(app, "admin", USUARIO_S, CLAVE_S);
  if (!enS.ok) throw new Error("no entro el SUPERADMIN");
  const cookieS = enS.valorCookie;
  const enDuenoX = await dominio.iniciarSesion(app, SLUG_X, "dueno.x", CLAVE_X);
  const enEmpX = await dominio.iniciarSesion(app, SLUG_X, "empleado.x", CLAVE_X);
  if (!enDuenoX.ok || !enEmpX.ok) throw new Error("no entraron los usuarios de X");

  // ─── Permisos: solo el SUPERADMIN ───────────────────────────────────────────
  console.log("--- Solo el SUPERADMIN administra negocios ---");
  const intentos: [string, () => Promise<Res>][] = [
    ["crearNegocio", () => acciones.crearNegocio({ nombre: "Intruso", slug: `${MARCA}-intruso` })],
    ["crearPrimerDueno", () => acciones.crearPrimerDueno({ negocioId: negX.id, usuario: "intruso", nombre: "Intruso", clave: CLAVE_NUEVO })],
    ["cambiarActivoNegocio", () => acciones.cambiarActivoNegocio({ id: negX.id, activo: false })],
  ];
  for (const [nombre, hacer] of intentos) {
    const dueno = await conCookie(enDuenoX.valorCookie, hacer);
    comprobar(`DUENO: ${nombre} → sin permiso`, comoTexto(dueno), "error: No tenés permiso para administrar los negocios.");
    const empleado = await conCookie(enEmpX.valorCookie, hacer);
    comprobar(`EMPLEADO: ${nombre} → sin permiso`, comoTexto(empleado), "error: No tenés permiso para administrar los negocios.");
    const nadie = await conCookie(undefined, hacer);
    comprobar(`sin sesion: ${nombre} → sesion`, comoTexto(nadie), "error: Tu sesión terminó. Volvé a entrar para seguir.");
  }
  comprobar("nada cambio (ni negocios nuevos ni X dado de baja)", `${await cuenta({ slug: { startsWith: MARCA } })}/${(await admin.negocio.findUniqueOrThrow({ where: { id: negX.id } })).activo}`, `${negociosAntes}/true`);
  comprobar(
    "el SUPERADMIN tampoco usa las acciones de un negocio",
    comoTexto(await conCookie(cookieS, () => accionesUsuarios.crearUsuario({ usuario: "colado", nombre: "Colado", rol: "DUENO", clave: CLAVE_NUEVO }))),
    "error: No tenés permiso para administrar usuarios.",
  );
  comprobar("...y no creo nada", String(await admin.usuario.count({ where: { usuario: "colado" } })), "0");
  let lanza = "";
  try {
    await getNegocios({ rol: "DUENO" });
  } catch (e) {
    lanza = e instanceof Error ? e.message : String(e);
  }
  comprobar("getNegocios exige el permiso", lanza, "No tenés permiso para administrar los negocios.");

  // ─── Alta de un negocio ─────────────────────────────────────────────────────
  console.log("--- Crear un negocio ---");
  const SLUG_N = `${MARCA}-nuevo`;
  const alta = await conCookie(cookieS, () => acciones.crearNegocio({ nombre: "  Mi Negocio Nuevo  ", slug: ` ${SLUG_N.toUpperCase()} ` }));
  comprobar("el SUPERADMIN crea el negocio", alta.ok ? "ok" : comoTexto(alta), "ok");
  if (!alta.ok || !alta.id) throw new Error("no se creo el negocio");
  const negN = alta.id;
  const filaN = await admin.negocio.findUniqueOrThrow({ where: { id: negN } });
  comprobar("nombre y slug normalizados, activo", `${filaN.nombre}|${filaN.slug}|${filaN.activo}`, `Mi Negocio Nuevo|${SLUG_N}|true`);
  const config = await admin.configuracion.findMany({ where: { negocioId: negN }, orderBy: { clave: "asc" } });
  const esperadaConfig = Object.values(CLAVES)
    .map((c) => `${c}=${c === CLAVES.nombreNegocio ? "Mi Negocio Nuevo" : POR_DEFECTO[c as keyof typeof POR_DEFECTO]}`)
    .sort();
  comprobar("sus claves de configuracion por defecto", config.map((c) => `${c.clave}=${c.valor}`).sort().join(","), esperadaConfig.join(","));
  const tablasDeDatos = ["cliente", "material", "maquina", "articulo", "listaPrecio", "venta", "compra", "presupuesto", "comprobante", "trabajoProduccion", "movimientoStock", "pago", "contactoCobranza", "usuario", "sesion"] as const;
  let conDatos = 0;
  for (const t of tablasDeDatos) conDatos += await (admin[t] as unknown as { count: (a: object) => Promise<number> }).count({ where: { negocioId: negN } });
  comprobar("el negocio nuevo esta vacio (sin usuarios, sesiones ni datos)", String(conDatos), "0");

  const rechazos: [string, DatosAlta, RegExp][] = [
    ["identificador repetido", { nombre: "Otro", slug: SLUG_N }, /Ya existe un negocio con el identificador/],
    ["identificador repetido con mayusculas", { nombre: "Otro", slug: SLUG_N.toUpperCase() }, /Ya existe un negocio con el identificador/],
    ["identificador reservado «admin»", { nombre: "Otro", slug: "admin" }, /reservado/],
    ["identificador reservado «login»", { nombre: "Otro", slug: "Login" }, /reservado/],
    ["identificador muy corto", { nombre: "Otro", slug: "ab" }, /3 a 30/],
    ["identificador con espacios", { nombre: "Otro", slug: "con espacios" }, /3 a 30/],
    ["identificador con acentos", { nombre: "Otro", slug: "ñandú-uno" }, /3 a 30/],
    ["identificador de 31 caracteres", { nombre: "Otro", slug: "a".repeat(31) }, /3 a 30/],
    ["sin nombre", { nombre: "   ", slug: `${MARCA}-sinnombre` }, /Falta el nombre/],
    ["nombre larguisimo", { nombre: "x".repeat(81), slug: `${MARCA}-largo` }, /Máximo 80/],
  ];
  type DatosAlta = { nombre: string; slug: string };
  for (const [etiqueta, datos, patron] of rechazos) {
    const r = await conCookie(cookieS, () => acciones.crearNegocio(datos));
    comprobar(`se rechaza: ${etiqueta}`, String(!r.ok && patron.test(r.error ?? "")), "true");
  }
  comprobar("y no quedo ningun negocio de mas", String(await cuenta({ slug: { startsWith: MARCA } })), String(negociosAntes + 1));

  console.log("--- Dos altas simultaneas con el mismo identificador ---");
  const SLUG_C = `${MARCA}-carrera`;
  const carrera = await conCookie(cookieS, () => Promise.all([1, 2, 3].map((n) => acciones.crearNegocio({ nombre: `Carrera ${n}`, slug: SLUG_C }))));
  comprobar("una sola gana", String(carrera.filter((r) => r.ok).length), "1");
  comprobar("las otras reciben el aviso de identificador repetido", String(carrera.filter((r) => !r.ok).every((r) => /Ya existe un negocio/.test(r.error ?? ""))), "true");
  const delC = await admin.negocio.findMany({ where: { slug: SLUG_C }, select: { id: true } });
  comprobar("un negocio y una sola tanda de configuracion", `${delC.length}/${await admin.configuracion.count({ where: { negocioId: delC[0]?.id } })}`, `1/${Object.keys(CLAVES).length}`);

  // ─── Primer dueno ───────────────────────────────────────────────────────────
  console.log("--- Primer dueno con clave inicial ---");
  const dueno = (datos: Partial<{ negocioId: string; usuario: string; nombre: string; clave: string }> = {}) =>
    conCookie(cookieS, () => acciones.crearPrimerDueno({ negocioId: negN, usuario: "Duena.Nueva", nombre: "Dueña Nueva", clave: CLAVE_NUEVO, ...datos }));
  comprobar("clave corta → error y nada creado", comoTexto(await dueno({ clave: "corta" })).startsWith("error:") ? "error" : "ok", "error");
  comprobar("negocio inexistente", comoTexto(await dueno({ negocioId: "11111111-1111-4111-8111-111111111111" })), "error: Ese negocio no existe.");
  comprobar("negocioId que no es UUID", comoTexto(await dueno({ negocioId: "no-es-uuid" })), "error: Negocio inválido");
  comprobar("usuario con formato invalido", String(!(await dueno({ usuario: "con espacios" })).ok), "true");
  comprobar("sin usuarios hasta ahora", String(await admin.usuario.count({ where: { negocioId: negN } })), "0");
  const creado = await dueno();
  comprobar("crea el dueno", comoTexto(creado), "ok");
  const filaD = await admin.usuario.findFirstOrThrow({ where: { negocioId: negN } });
  comprobar("DUENO de ese negocio, usuario en minusculas, con cambio obligatorio", `${filaD.rol}|${filaD.usuario}|${filaD.debeCambiarClave}|${filaD.activo}`, "DUENO|duena.nueva|true|true");
  comprobar("la clave quedo hasheada (nunca en claro)", String(filaD.hashClave.startsWith("scrypt$") && !filaD.hashClave.includes(CLAVE_NUEVO)), "true");
  comprobar("no se crea un segundo dueno", String(comoTexto(await dueno({ usuario: "otro.dueno" })).startsWith("error: Ya existe un dueño")), "true");
  comprobar("...y sigue habiendo uno", String(await admin.usuario.count({ where: { negocioId: negN } })), "1");

  console.log("--- El dueno entra: sistema vacio con la configuracion por defecto ---");
  const entra = await dominio.iniciarSesion(app, SLUG_N, "duena.nueva", CLAVE_NUEVO);
  comprobar("entra con el negocio y la clave inicial", String(entra.ok && entra.negocioId === negN && entra.usuario.rol === "DUENO"), "true");
  if (!entra.ok) throw new Error("no entro el dueno nuevo");
  comprobar("la sesion le exige cambiar la clave", String((await dominio.resolverSesion(app, entra.valorCookie))?.debeCambiarClave), "true");
  const vacio = await conNegocio(negN, async (tx) => ({
    clientes: await tx.cliente.count(),
    ventas: await tx.venta.count(),
    articulos: await tx.articulo.count(),
    materiales: await tx.material.count(),
    config: (await tx.configuracion.findMany({ orderBy: { clave: "asc" } })).map((c) => `${c.clave}=${c.valor}`).sort().join(","),
  }));
  comprobar("ve 0 clientes, ventas, articulos y materiales", `${vacio.clientes}/${vacio.ventas}/${vacio.articulos}/${vacio.materiales}`, "0/0/0/0");
  comprobar("y su configuracion por defecto", vacio.config, esperadaConfig.join(","));
  comprobar("no ve nada de X", String(await conNegocio(negN, (tx) => tx.cliente.count({ where: { negocioId: negX.id } }))), "0");
  const nueva = await usuariosDominio.cambiarClavePropia(app, { ...(entra.usuario as import("../src/lib/auth-pura").UsuarioSesion) }, { actual: CLAVE_NUEVO, nueva: CLAVE_NUEVA, repetir: CLAVE_NUEVA });
  comprobar("al cambiar la clave se apaga el cambio obligatorio", String((await dominio.resolverSesion(app, nueva.valorCookie))?.debeCambiarClave), "false");
  comprobar("la clave inicial ya no sirve", JSON.stringify(await dominio.iniciarSesion(app, SLUG_N, "duena.nueva", CLAVE_NUEVO)), '{"ok":false}');

  // ─── Lo que ve el SUPERADMIN ────────────────────────────────────────────────
  console.log("--- El SUPERADMIN ve nombre, estado y cantidad de usuarios, nada mas ---");
  const lista = await getNegocios(enS.usuario);
  const deX = lista.negocios.find((n) => n.id === negX.id);
  const deN = lista.negocios.find((n) => n.id === negN);
  comprobar("no es modo demo", String(lista.esDemo), "false");
  comprobar("X: 2 usuarios (2 activos)", `${deX?.usuarios}/${deX?.usuariosActivos}`, "2/2");
  comprobar("el nuevo: 1 usuario", `${deN?.usuarios}/${deN?.usuariosActivos}`, "1/1");
  comprobar("los campos que viajan", Object.keys(deX ?? {}).sort().join(","), "activo,creadoEn,id,nombre,slug,usuarios,usuariosActivos");
  const sinDueno = lista.negocios.find((n) => n.id === delC[0]?.id);
  comprobar("un negocio sin dueno aparece con 0 usuarios", String(sinDueno?.usuarios), "0");
  const accesoDatos = await conSuperadmin(async (tx) => ({
    clientes: await tx.cliente.count(),
    usuariosDeNegocios: await tx.usuario.count({ where: { negocioId: { not: null } } }),
    sesionesDeNegocios: await tx.sesion.count({ where: { negocioId: { not: null } } }),
    config: await tx.configuracion.count(),
  }));
  comprobar("el contexto del SUPERADMIN no lee clientes, usuarios, sesiones ni configuracion de ningun negocio", JSON.stringify(accesoDatos), '{"clientes":0,"usuariosDeNegocios":0,"sesionesDeNegocios":0,"config":0}');
  comprobar("(control: el migrador si los ve)", String((await admin.cliente.count({ where: { negocioId: negX.id } })) > 0), "true");

  // ─── Baja logica y reactivacion ─────────────────────────────────────────────
  console.log("--- Baja logica y reactivacion ---");
  comprobar("id que no es UUID", comoTexto(await conCookie(cookieS, () => acciones.cambiarActivoNegocio({ id: "x", activo: false }))), "error: Negocio inválido");
  comprobar("negocio inexistente", comoTexto(await conCookie(cookieS, () => acciones.cambiarActivoNegocio({ id: "11111111-1111-4111-8111-111111111111", activo: false }))), "error: Ese negocio no existe.");
  comprobar("baja", comoTexto(await conCookie(cookieS, () => acciones.cambiarActivoNegocio({ id: negN, activo: false }))), "ok");
  comprobar("queda inactivo y NO se borra nada", `${(await admin.negocio.findUniqueOrThrow({ where: { id: negN } })).activo}/${await admin.usuario.count({ where: { negocioId: negN } })}/${await admin.configuracion.count({ where: { negocioId: negN } })}`, `false/1/${Object.keys(CLAVES).length}`);
  comprobar("nadie entra a un negocio dado de baja", JSON.stringify(await dominio.iniciarSesion(app, SLUG_N, "duena.nueva", CLAVE_NUEVA)), '{"ok":false}');
  comprobar("su sesion abierta deja de valer", String(await dominio.resolverSesion(app, nueva.valorCookie)), "null");
  comprobar("el listado lo muestra dado de baja", String((await getNegocios(enS.usuario)).negocios.find((n) => n.id === negN)?.activo), "false");
  comprobar("baja repetida: sin error", comoTexto(await conCookie(cookieS, () => acciones.cambiarActivoNegocio({ id: negN, activo: false }))), "ok");
  comprobar("reactivacion", comoTexto(await conCookie(cookieS, () => acciones.cambiarActivoNegocio({ id: negN, activo: true }))), "ok");
  comprobar("vuelve a entrar", String((await dominio.iniciarSesion(app, SLUG_N, "duena.nueva", CLAVE_NUEVA)).ok), "true");
  comprobar("la sesion de antes vuelve a valer", String((await dominio.resolverSesion(app, nueva.valorCookie)) !== null), "true");
  let borrar = "";
  try {
    await conSuperadmin((tx) => tx.negocio.delete({ where: { id: negN } }));
  } catch (e) {
    borrar = e instanceof Error ? e.message : String(e);
  }
  comprobar("ni siquiera el SUPERADMIN puede borrar un negocio", String(/permission denied|Foreign key|violates|denegado/i.test(borrar)), "true");
  comprobar("...sigue ahi", String((await admin.negocio.count({ where: { id: negN } })) === 1), "true");

  // ─── Scripts ────────────────────────────────────────────────────────────────
  console.log("--- Scripts crear-superadmin y crear-dueno --negocio (con el rol de la app) ---");
  // Sin DATABASE_URL_MIGRACIONES: el script usa DATABASE_URL (ventas_app) y tiene que funcionar igual bajo RLS.
  const entorno = (extra: Record<string, string>): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    delete env.DATABASE_URL_MIGRACIONES;
    return env;
  };
  const correr = (script: string, args: string[], extra: Record<string, string>) =>
    spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), [join("scripts", script), ...args], { env: entorno(extra), encoding: "utf8", cwd: process.cwd(), input: "" });
  const salida = (r: ReturnType<typeof correr>) => `${r.stdout}${r.stderr}`;

  const SLUG_CLI = `${MARCA}-cli`;
  const negCli = await admin.negocio.create({ data: { nombre: "Negocio CLI", slug: SLUG_CLI }, select: { id: true } });
  const sinNegocio = correr("crear-dueno.ts", [], { DUENO_USUARIO: "cli", DUENO_CLAVE: CLAVE_NUEVO });
  comprobar("crear-dueno sin --negocio: se niega y lo dice", String(sinNegocio.status === 1 && /falta el negocio/.test(salida(sinNegocio))), "true");
  const inexistente = correr("crear-dueno.ts", ["--negocio", "no-existe-zz"], { DUENO_USUARIO: "cli", DUENO_CLAVE: CLAVE_NUEVO });
  comprobar("crear-dueno con un negocio inexistente: se niega", String(inexistente.status === 1 && /no hay un negocio activo/.test(salida(inexistente))), "true");
  const ok1 = correr("crear-dueno.ts", ["--negocio", SLUG_CLI.toUpperCase()], { DUENO_USUARIO: "Cli.Dueno", DUENO_CLAVE: CLAVE_NUEVO, DUENO_NOMBRE: "Dueño CLI" });
  comprobar("crear-dueno --negocio crea el dueno en ESE negocio", String(ok1.status === 0 && /Listo/.test(salida(ok1))), "true");
  const filaCli = await admin.usuario.findFirst({ where: { usuario: "cli.dueno" } });
  comprobar("quedo en el negocio indicado como DUENO", `${filaCli?.negocioId === negCli.id}/${filaCli?.rol}`, "true/DUENO");
  const ok2 = correr("crear-dueno.ts", [`--negocio=${SLUG_CLI}`], { DUENO_USUARIO: "segundo", DUENO_CLAVE: CLAVE_NUEVO });
  comprobar("no crea un segundo dueno en ese negocio", String(ok2.status === 1 && /ya existe un dueño/.test(salida(ok2))), "true");
  const otroNegocio = correr("crear-dueno.ts", ["--negocio", SLUG_N], { DUENO_USUARIO: "cli.dueno", DUENO_CLAVE: CLAVE_NUEVO });
  comprobar("ni en otro que ya tiene dueno", String(otroNegocio.status === 1 && /ya existe un dueño/.test(salida(otroNegocio))), "true");
  comprobar("el dueno del CLI entra", String((await dominio.iniciarSesion(app, SLUG_CLI, "cli.dueno", CLAVE_NUEVO)).ok), "true");

  const hayOtroSuper = (await admin.usuario.count({ where: { rol: "SUPERADMIN", NOT: { usuario: USUARIO_S } } })) > 0;
  if (hayOtroSuper) {
    console.log("(hay otro SUPERADMIN en la base: se omite el alta por script del primero)");
  } else {
    // El script solo crea el PRIMERO: se aparta el de la prueba mientras corre.
    await admin.usuario.update({ where: { id: sup.id }, data: { rol: "DUENO", negocioId: negX.id, usuario: `${MARCA}-aparte` } });
    const s1 = correr("crear-superadmin.ts", [], { SUPERADMIN_USUARIO: `${MARCA}-cli`, SUPERADMIN_CLAVE: CLAVE_S, SUPERADMIN_NOMBRE: "Super CLI" });
    comprobar("crear-superadmin crea la cuenta sin negocio", String(s1.status === 0 && /Listo/.test(salida(s1))), "true");
    const filaS = await admin.usuario.findFirst({ where: { usuario: `${MARCA}-cli`, rol: "SUPERADMIN" } });
    comprobar("...SUPERADMIN, sin negocio", `${filaS?.rol}/${filaS?.negocioId}`, "SUPERADMIN/null");
    comprobar("...y entra con «admin»", String((await dominio.iniciarSesion(app, "admin", `${MARCA}-cli`, CLAVE_S)).ok), "true");
    const s2 = correr("crear-superadmin.ts", [], { SUPERADMIN_USUARIO: `${MARCA}-otro`, SUPERADMIN_CLAVE: CLAVE_S });
    comprobar("no crea un segundo", String(s2.status === 1 && /ya existe un superadmin/.test(salida(s2))), "true");
    await admin.sesion.deleteMany({ where: { usuarioId: filaS?.id } });
    await admin.usuario.delete({ where: { id: filaS!.id } });
    await admin.usuario.update({ where: { id: sup.id }, data: { rol: "SUPERADMIN", negocioId: null, usuario: USUARIO_S } });
  }
  void duenoX;
}

async function limpiar() {
  const negocios = await admin.negocio.findMany({ where: { slug: { startsWith: MARCA } }, select: { id: true } });
  const ids = negocios.map((n) => n.id);
  const sups = (await admin.usuario.findMany({ where: { negocioId: null, usuario: { startsWith: MARCA } }, select: { id: true } })).map((u) => u.id);
  await admin.sesion.deleteMany({ where: { usuarioId: { in: sups } } });
  await admin.usuario.deleteMany({ where: { id: { in: sups } } });
  await admin.sesion.deleteMany({ where: { negocioId: { in: ids } } });
  await admin.cliente.deleteMany({ where: { negocioId: { in: ids } } });
  await admin.configuracion.deleteMany({ where: { negocioId: { in: ids } } });
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
