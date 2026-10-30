/**
 * Prueba "Facturar desde la venta" (5.5) contra Postgres real, invocando las
 * server actions `emitirFactura` y `resolverComprobantePendiente` DE VERDAD con
 * la sesion de un dueno, de un empleado y sin sesion.
 *
 *   npm run test:facturar:db
 *
 * Mismo mecanismo que `scripts/test-permisos.ts`: se intercepta `require` de
 * `next/headers`, `next/cache` y `next/navigation` (solo en este script) y la
 * accion recibe la cookie con el token de una sesion REAL creada en la base. Todo
 * lo demas es codigo de produccion.
 *
 * Plan: permiso (dueno y empleado pueden; sin sesion, token falso y baja no),
 * datos invalidos, venta anulada, venta ya facturada, doble pedido simultaneo
 * (una sola factura vigente), facturacion deshabilitada en produccion sin
 * `PERMITIR_EMISOR_SIMULADO`, factura C con advertencia de IVA, reintento tras un
 * rechazo, resolver un PENDIENTE, y que la pantalla de la venta y el listado no
 * traen costos. NO deja rastro: ventas del anio ficticio 2099, punto de venta
 * propio y datos con prefijo; al final borra todo, restaura la configuracion
 * fiscal y compara una foto de TODAS las tablas.
 */
import "dotenv/config";
import Module from "node:module";
import { randomBytes } from "node:crypto";

class Redireccion extends Error {
  constructor(public destino: string) {
    super(`redirect ${destino}`);
  }
}

let cookieActual: string | undefined;
let nombreCookie = "";

const falsos: Record<string, unknown> = {
  "next/headers": {
    cookies: async () => ({
      get: (nombre: string) => (nombre === nombreCookie && cookieActual !== undefined ? { name: nombre, value: cookieActual } : undefined),
      set: () => undefined,
      delete: () => undefined,
    }),
  },
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "next/navigation": {
    redirect: (destino: string) => {
      throw new Redireccion(destino);
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
const { prisma } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
const { COOKIE_SESION } = require("../src/lib/auth") as typeof import("../src/lib/auth");
const { crearSesion, crearUsuarioEnTx } = require("../src/lib/dominio/auth") as typeof import("../src/lib/dominio/auth");
const { registrarVentaEnTx, anularVentaEnTx } = require("../src/lib/dominio/ventas") as typeof import("../src/lib/dominio/ventas");
const { accesoSimulado, emitirFactura: emitirDeDominio } = require("../src/lib/dominio/comprobantes") as typeof import("../src/lib/dominio/comprobantes");
const { crearEmisorSimulado } = require("../src/lib/fiscal/emisor-simulado") as typeof import("../src/lib/fiscal/emisor-simulado");
const { MENSAJE_SIMULADO_EN_PRODUCCION, MENSAJE_ARCA_NO_IMPLEMENTADO } = require("../src/lib/fiscal") as typeof import("../src/lib/fiscal");
const { CLAVES_FISCALES } = require("../src/lib/datos-fiscales") as typeof import("../src/lib/datos-fiscales");
const { d } = require("../src/lib/money") as typeof import("../src/lib/money");
const { fechaDesdeISO } = require("../src/lib/acciones") as typeof import("../src/lib/acciones");
const { generarToken } = require("../src/lib/auth-pura") as typeof import("../src/lib/auth-pura");
const { parseFiltrosComprobantes } = require("../src/lib/facturacion") as typeof import("../src/lib/facturacion");
const comprobantesA = require("../src/app/comprobantes/actions") as typeof import("../src/app/comprobantes/actions");
const qComprobantes = require("../src/lib/queries/comprobantes") as typeof import("../src/lib/queries/comprobantes");
const { FacturarPanel } = require("../src/app/ventas/[id]/_componentes/factur-panel") as typeof import("../src/app/ventas/[id]/_componentes/factur-panel");
type Pagina = (props?: unknown) => Promise<unknown>;
const paginaListado = (require("../src/app/comprobantes/page") as { default: Pagina }).default;
/* eslint-enable @typescript-eslint/no-require-imports */

nombreCookie = COOKIE_SESION;

// Las acciones registran con console.error los rechazos de negocio que prueba este script (esperados): no ensuciar la salida.
const errorOriginal = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && /^\[(emitirFactura|resolverComprobantePendiente)\]/.test(args[0]) && args[1] instanceof Error && args[1].constructor.name === "ErrorDeNegocio") return;
  errorOriginal(...args);
};

let fallos = 0;
function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const MARCA = `zz-t55-${randomBytes(3).toString("hex")}`;
const PREFIJO = "zz-t55-";
const CLAVE = "clave-de-prueba-123";
const PV = 4355;
const FECHA_VENTA = fechaDesdeISO("2099-06-15");
const env = process.env as Record<string, string | undefined>;

type Foto = Map<string, string>;
async function foto(): Promise<Foto> {
  const tablas = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  const resultado: Foto = new Map();
  for (const { table_name } of tablas) {
    const [fila] = await prisma.$queryRawUnsafe<{ n: bigint; h: string }[]>(
      `SELECT count(*) AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${table_name}" t`,
    );
    resultado.set(table_name, `${fila?.n}:${fila?.h}`);
  }
  return resultado;
}

type Respuesta = { ok?: boolean; error?: string; estado?: string; mensaje?: string; advertencias?: string[]; comprobanteId?: string; lanzo?: boolean };

async function invocar(token: string | undefined, accion: unknown, datos: unknown): Promise<Respuesta> {
  cookieActual = token;
  try {
    return (await (accion as (x: unknown) => Promise<Respuesta>)(datos)) ?? {};
  } catch (error) {
    return { ok: false, lanzo: true, error: error instanceof Error ? error.message : String(error) };
  } finally {
    cookieActual = undefined;
  }
}

/** Varias invocaciones a la vez con la MISMA sesion (la cookie se suelta cuando terminan todas). */
async function invocarJuntas(token: string, n: number, accion: unknown, datos: unknown): Promise<Respuesta[]> {
  cookieActual = token;
  try {
    return await Promise.all(
      Array.from({ length: n }, async () => {
        try {
          return ((await (accion as (x: unknown) => Promise<Respuesta>)(datos)) ?? {}) as Respuesta;
        } catch (error) {
          return { ok: false, lanzo: true, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
  } finally {
    cookieActual = undefined;
  }
}

async function conSesion<T>(token: string | undefined, fn: () => Promise<T>): Promise<T> {
  cookieActual = token;
  try {
    return await fn();
  } finally {
    cookieActual = undefined;
  }
}

const texto = (valor: unknown) => {
  const visto = new WeakSet<object>();
  return JSON.stringify(valor, (_c, v) => {
    if (v && typeof v === "object") {
      if (visto.has(v)) return undefined;
      visto.add(v);
    }
    return v;
  });
};

let configOriginal: { clave: string; valor: string }[] | null = null;

async function limpiar() {
  const like = `${PREFIJO}%`;
  const ventas = `SELECT id FROM ventas WHERE "clienteId" IN (SELECT id FROM clientes WHERE nombre LIKE '${like}')`;
  await prisma.$executeRawUnsafe(`DELETE FROM comprobantes WHERE "ventaId" IN (${ventas}) AND "comprobanteAsociadoId" IS NOT NULL`);
  await prisma.$executeRawUnsafe(`DELETE FROM comprobantes WHERE "ventaId" IN (${ventas})`);
  await prisma.$executeRawUnsafe(`DELETE FROM movimientos_stock WHERE "ventaId" IN (${ventas})`);
  await prisma.$executeRawUnsafe(`DELETE FROM pagos WHERE "ventaId" IN (${ventas})`);
  await prisma.$executeRawUnsafe(`DELETE FROM ventas WHERE id IN (${ventas})`);
  await prisma.$executeRaw`DELETE FROM articulos WHERE nombre LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM clientes WHERE nombre LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM sesiones WHERE "usuarioId" IN (SELECT id FROM usuarios WHERE usuario LIKE ${like})`;
  await prisma.$executeRaw`DELETE FROM usuarios WHERE usuario LIKE ${like}`;
  await prisma.$executeRawUnsafe(`ALTER TABLE comprobantes ENABLE TRIGGER comprobantes_validar_cambio`);
  if (configOriginal) {
    await prisma.configuracion.deleteMany({ where: { clave: { startsWith: "fiscal" } } });
    for (const c of configOriginal) await prisma.configuracion.create({ data: c });
  }
}

async function configurarFiscal(valores: Partial<Record<keyof typeof CLAVES_FISCALES, string>> = {}) {
  const todos: Record<string, string> = {
    razonSocial: "Prueba Facturar S.R.L.",
    cuit: "20333333334",
    condicionIva: "RESPONSABLE_INSCRIPTO",
    domicilio: "Calle de Prueba 55, Córdoba",
    inicioActividades: "2020-03-02",
    puntoVenta: String(PV),
    ...valores,
  };
  await prisma.configuracion.deleteMany({ where: { clave: { startsWith: "fiscal" } } });
  for (const [campo, valor] of Object.entries(todos)) {
    if (valor === "") continue;
    await prisma.configuracion.create({ data: { clave: CLAVES_FISCALES[campo as keyof typeof CLAVES_FISCALES], valor } });
  }
}

async function main() {
  const { dbDisponible } = require("../src/lib/prisma") as typeof import("../src/lib/prisma"); // eslint-disable-line @typescript-eslint/no-require-imports
  if (!(await dbDisponible())) {
    console.error("No hay base de datos: esta prueba necesita Postgres (DATABASE_URL).");
    process.exit(1);
  }

  console.log("--- Preparacion ---");
  configOriginal = await prisma.configuracion.findMany({ where: { clave: { startsWith: "fiscal" } } });
  await limpiar(); // restos de una corrida interrumpida
  const base = await foto();
  console.log(`     foto inicial de ${base.size} tablas`);

  const emp = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `${MARCA}-emp`, nombre: "Empleado de prueba", rol: "EMPLEADO", clave: CLAVE }));
  const due = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `${MARCA}-due`, nombre: "Dueno de prueba", rol: "DUENO", clave: CLAVE }));
  const baja = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `${MARCA}-baja`, nombre: "Empleado dado de baja", rol: "EMPLEADO", clave: CLAVE }));
  const tEmp = (await crearSesion(prisma, emp.id)).token;
  const tDue = (await crearSesion(prisma, due.id)).token;
  const tBaja = (await crearSesion(prisma, baja.id)).token;
  await prisma.usuario.update({ where: { id: baja.id }, data: { activo: false } });
  const tFalso = generarToken();

  await configurarFiscal();
  const articulo = await prisma.articulo.create({ data: { nombre: `${PREFIJO}${MARCA} servicio`, precioVenta: "1210", ivaPct: "21", esServicio: true } });
  const cliente = await prisma.cliente.create({ data: { nombre: `${PREFIJO}${MARCA} cliente`, direccion: "Mostrador" } });
  const nuevaVenta = () =>
    prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, { clienteId: cliente.id, fecha: FECHA_VENTA, observaciones: MARCA, entregada: false, items: [{ articuloId: articulo.id, cantidad: d("1") }], pago: null }),
    );
  const comprobantesDe = (ventaId: string) => prisma.comprobante.findMany({ where: { ventaId }, orderBy: { creadoEn: "asc" } });
  const vigentes = (ventaId: string) => prisma.comprobante.count({ where: { ventaId, estado: { in: ["PENDIENTE", "EMITIDO"] } } });
  const total = () => prisma.comprobante.count();

  // ── Permisos ────────────────────────────────────────────────────────────────
  console.log("--- Permisos de emitirFactura ---");
  const vPerm = await nuevaVenta();
  const antes = await total();
  for (const [nombre, token] of [["sin sesión", undefined], ["token falso", tFalso], ["empleado dado de baja", tBaja]] as const) {
    const r = await invocar(token, comprobantesA.emitirFactura, { ventaId: vPerm.id });
    comprobar(`${nombre}: rechazada`, `${r.ok} ${/Tu sesión terminó|No tenés permiso/.test(r.error ?? "")}`, "false true");
    const basura = await invocar(token, comprobantesA.emitirFactura, { ventaId: "no-es-un-uuid" });
    comprobar(`${nombre} con datos basura: el error es de permiso, no de validación`, String(/Tu sesión terminó|No tenés permiso/.test(basura.error ?? "")), "true");
  }
  comprobar("sin permiso: no se creó ningún comprobante", String((await total()) - antes), "0");
  const sinSesionResolver = await invocar(undefined, comprobantesA.resolverComprobantePendiente, { comprobanteId: "x" });
  comprobar("resolverComprobantePendiente sin sesión: rechazada", `${sinSesionResolver.ok} ${/Tu sesión terminó/.test(sinSesionResolver.error ?? "")}`, "false true");

  console.log("--- Datos invalidos ---");
  const mal = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: "no-es-un-uuid" });
  comprobar("ventaId inválido (empleado)", `${mal.ok} ${mal.error}`, "false Venta inválida");
  const inexistente = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: "00000000-0000-4000-8000-000000000000" });
  comprobar("venta inexistente", `${inexistente.ok} ${inexistente.error}`, "false La venta no existe.");
  const vacio = await invocar(tEmp, comprobantesA.emitirFactura, {});
  comprobar("sin ventaId", String(vacio.ok), "false");

  // ── El empleado factura ─────────────────────────────────────────────────────
  console.log("--- El empleado factura ---");
  const rEmp = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vPerm.id });
  comprobar("empleado: ok y EMITIDO", `${rEmp.ok} ${rEmp.estado}`, "true EMITIDO");
  comprobar("empleado: mensaje de la emisión", String(/Factura B 4355-\d{8} emitida \(CAE \d{14}\)/.test(rEmp.mensaje ?? "")), "true");
  comprobar("empleado: sin advertencias", String(rEmp.advertencias?.length), "0");
  const [cEmp] = await comprobantesDe(vPerm.id);
  comprobar("empleado: comprobante SIMULADO, factura B, a su nombre", `${cEmp?.ambiente} ${cEmp?.tipo} ${cEmp?.usuarioId === emp.id} ${cEmp?.estado}`, "SIMULADO FACTURA_B true EMITIDO");
  comprobar("empleado: una factura vigente", String(await vigentes(vPerm.id)), "1");

  const rYa = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vPerm.id });
  comprobar("venta ya facturada: error claro", `${rYa.ok} ${(rYa.error ?? "").includes("ya está facturada")}`, "false true");
  comprobar("venta ya facturada: sigue habiendo una sola", String((await comprobantesDe(vPerm.id)).length), "1");

  // ── El dueño factura ────────────────────────────────────────────────────────
  console.log("--- El dueño factura ---");
  const vDue = await nuevaVenta();
  const rDue = await invocar(tDue, comprobantesA.emitirFactura, { ventaId: vDue.id });
  comprobar("dueño: ok y EMITIDO", `${rDue.ok} ${rDue.estado}`, "true EMITIDO");
  const [cDue] = await comprobantesDe(vDue.id);
  comprobar("dueño: número correlativo al del empleado", String((cDue?.numero ?? 0) - (cEmp?.numero ?? 0)), "1");
  comprobar("dueño: a su nombre", String(cDue?.usuarioId === due.id), "true");

  // ── Venta anulada ───────────────────────────────────────────────────────────
  console.log("--- Venta anulada ---");
  const vAnulada = await nuevaVenta();
  await prisma.$transaction((tx) => anularVentaEnTx(tx, vAnulada.id));
  const rAn = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vAnulada.id });
  comprobar("venta anulada: no se factura", `${rAn.ok} ${rAn.error}`, "false No se factura una venta anulada.");
  comprobar("venta anulada: sin comprobantes", String((await comprobantesDe(vAnulada.id)).length), "0");

  // ── Doble pedido simultaneo ─────────────────────────────────────────────────
  console.log("--- Doble pedido simultáneo ---");
  for (const ronda of [1, 2, 3]) {
    const v = await nuevaVenta();
    const n = ronda === 3 ? 4 : 2;
    const res = await invocarJuntas(ronda === 2 ? tDue : tEmp, n, comprobantesA.emitirFactura, { ventaId: v.id });
    const ok = res.filter((r) => r.ok);
    const mal = res.filter((r) => !r.ok);
    comprobar(`simultáneo ${ronda} (${n} pedidos): uno solo sale`, String(ok.length), "1");
    comprobar(
      `simultáneo ${ronda}: los demás con error claro`,
      String(mal.length === n - 1 && mal.every((r) => /ya está facturada|esperando respuesta|Otra persona está facturando/.test(r.error ?? ""))),
      "true",
    );
    comprobar(`simultáneo ${ronda}: una sola factura vigente`, String(await vigentes(v.id)), "1");
  }
  const numeros = (await prisma.comprobante.findMany({ where: { puntoVenta: PV, estado: "EMITIDO" }, select: { numero: true } })).map((c) => c.numero).sort((a, b) => a - b);
  comprobar("la numeración no tiene huecos ni repetidos", numeros.join(","), numeros.map((_, i) => i + 1).join(","));

  // ── Facturación deshabilitada ───────────────────────────────────────────────
  console.log("--- Facturación deshabilitada ---");
  const vProd = await nuevaVenta();
  const guardado = { NODE_ENV: env.NODE_ENV, PERMITIR: env.PERMITIR_EMISOR_SIMULADO, EMISOR: env.EMISOR_FISCAL };
  try {
    const cuenta = await total();
    env.NODE_ENV = "production";
    delete env.PERMITIR_EMISOR_SIMULADO;
    const rProd = await invocar(tDue, comprobantesA.emitirFactura, { ventaId: vProd.id });
    comprobar("producción sin PERMITIR_EMISOR_SIMULADO: error claro", `${rProd.ok} ${rProd.error === MENSAJE_SIMULADO_EN_PRODUCCION}`, "false true");
    const rProdEmp = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vProd.id });
    comprobar("producción sin la variable (empleado): igual de deshabilitada", `${rProdEmp.ok} ${rProdEmp.error === MENSAJE_SIMULADO_EN_PRODUCCION}`, "false true");
    env.PERMITIR_EMISOR_SIMULADO = "0";
    const rCero = await invocar(tDue, comprobantesA.emitirFactura, { ventaId: vProd.id });
    comprobar("PERMITIR_EMISOR_SIMULADO=0: deshabilitada", String(rCero.error === MENSAJE_SIMULADO_EN_PRODUCCION), "true");
    comprobar("deshabilitada: no se creó nada", String((await total()) - cuenta), "0");
    // La pantalla de la venta lo avisa ANTES de apretar el boton.
    const panelProd = texto(await conSesion(tEmp, () => FacturarPanel({ ventaId: vProd.id })));
    comprobar("el panel de la venta muestra el aviso de facturación deshabilitada", String(panelProd.includes("Facturación deshabilitada")), "true");
    comprobar("y no ofrece el botón", String(panelProd.includes('"visible":true')), "false");

    delete env.PERMITIR_EMISOR_SIMULADO;
    env.NODE_ENV = guardado.NODE_ENV;
    env.EMISOR_FISCAL = "arca";
    const rArca = await invocar(tDue, comprobantesA.emitirFactura, { ventaId: vProd.id });
    comprobar("EMISOR_FISCAL=arca: no implementado", `${rArca.ok} ${rArca.error === MENSAJE_ARCA_NO_IMPLEMENTADO}`, "false true");
    delete env.EMISOR_FISCAL;

    env.NODE_ENV = "production";
    env.PERMITIR_EMISOR_SIMULADO = "1";
    const rDemo = await invocar(tDue, comprobantesA.emitirFactura, { ventaId: vProd.id });
    comprobar("producción CON PERMITIR_EMISOR_SIMULADO=1: se factura (sigue SIMULADO, sin validez fiscal)", `${rDemo.ok} ${rDemo.estado}`, "true EMITIDO");
    comprobar("...y queda en ambiente SIMULADO", String((await comprobantesDe(vProd.id))[0]?.ambiente), "SIMULADO");
  } finally {
    if (guardado.NODE_ENV === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = guardado.NODE_ENV;
    if (guardado.PERMITIR === undefined) delete env.PERMITIR_EMISOR_SIMULADO;
    else env.PERMITIR_EMISOR_SIMULADO = guardado.PERMITIR;
    if (guardado.EMISOR === undefined) delete env.EMISOR_FISCAL;
    else env.EMISOR_FISCAL = guardado.EMISOR;
  }

  // ── Datos fiscales incompletos ──────────────────────────────────────────────
  console.log("--- Datos fiscales incompletos ---");
  await configurarFiscal({ cuit: "" });
  const vSinDatos = await nuevaVenta();
  const rSin = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vSinDatos.id });
  comprobar("sin CUIT del negocio: no se factura", `${rSin.ok} ${(rSin.error ?? "").includes("datos fiscales")}`, "false true");
  const panelEmp = texto(await conSesion(tEmp, () => FacturarPanel({ ventaId: vSinDatos.id })));
  comprobar("panel del empleado: avisa sin enlace a Configuración", `${panelEmp.includes("Pedile al dueño")} ${panelEmp.includes('"/configuracion"')}`, "true false");
  const panelDue = texto(await conSesion(tDue, () => FacturarPanel({ ventaId: vSinDatos.id })));
  comprobar("panel del dueño: avisa CON enlace a Configuración", `${panelDue.includes("Ir a Configuración")} ${panelDue.includes('"/configuracion"')}`, "true true");

  // ── Monotributo: Factura C con IVA ──────────────────────────────────────────
  console.log("--- Monotributo ---");
  await configurarFiscal({ condicionIva: "MONOTRIBUTO" });
  const vMono = await nuevaVenta();
  const panelMono = texto(await conSesion(tEmp, () => FacturarPanel({ ventaId: vMono.id })));
  comprobar("panel: advierte de la Factura C con IVA antes de emitir", String(panelMono.includes("no discrimina IVA")), "true");
  const rMono = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vMono.id });
  comprobar("Factura C: emitida", `${rMono.ok} ${rMono.estado}`, "true EMITIDO");
  comprobar("Factura C: la acción devuelve la advertencia de IVA", String(rMono.advertencias?.length === 1 && rMono.advertencias[0]!.includes("no discrimina IVA")), "true");
  comprobar("Factura C: tipo C", String((await comprobantesDe(vMono.id))[0]?.tipo), "FACTURA_C");
  await configurarFiscal();

  // ── Reintento tras un rechazo ───────────────────────────────────────────────
  console.log("--- Reintento tras un rechazo ---");
  const vRech = await nuevaVenta();
  const rechazo = await emitirDeDominio(prisma, vRech.id, null, { emisor: crearEmisorSimulado(accesoSimulado(prisma), { rechazar: () => ["[10016] prueba de rechazo"] }) });
  comprobar("preparación: la factura quedó RECHAZADA", rechazo.estado, "RECHAZADO");
  const panelRech = texto(await conSesion(tEmp, () => FacturarPanel({ ventaId: vRech.id })));
  comprobar("panel: muestra las observaciones del rechazo y ofrece reintentar", `${panelRech.includes("prueba de rechazo")} ${panelRech.includes('"reintento":true')} ${panelRech.includes('"visible":true')}`, "true true true");
  const reint = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vRech.id });
  comprobar("reintento (empleado): EMITIDO", `${reint.ok} ${reint.estado}`, "true EMITIDO");
  const trasReint = await comprobantesDe(vRech.id);
  comprobar("reintento: el rechazo queda como registro, el número se reusa", `${trasReint.map((c) => c.estado).join(",")} ${trasReint[0]?.numero === trasReint[1]?.numero}`, "RECHAZADO,EMITIDO true");
  comprobar("reintento: una sola vigente", String(await vigentes(vRech.id)), "1");

  // ── Resolver un PENDIENTE ───────────────────────────────────────────────────
  console.log("--- Resolver un PENDIENTE ---");
  const vPend = await nuevaVenta();
  const cortado = await emitirDeDominio(prisma, vPend.id, null, { emisor: crearEmisorSimulado(accesoSimulado(prisma), { cortar: () => true }) });
  comprobar("preparación: la factura quedó PENDIENTE", cortado.estado, "PENDIENTE");
  const vOtra = await nuevaVenta();
  const rBloq = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vOtra.id });
  comprobar("con un PENDIENTE en la serie, otra venta espera", `${rBloq.ok} ${(rBloq.error ?? "").includes("esperando respuesta del emisor")}`, "false true");
  const rReFact = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vPend.id });
  comprobar("la venta con PENDIENTE no se vuelve a facturar", `${rReFact.ok} ${(rReFact.error ?? "").includes("esperando respuesta")}`, "false true");
  const panelPend = texto(await conSesion(tEmp, () => FacturarPanel({ ventaId: vPend.id })));
  comprobar("panel: PENDIENTE reciente → todavía no se resuelve", `${panelPend.includes("está pendiente")} ${panelPend.includes(`"comprobanteId":"${cortado.id}"`)} ${panelPend.includes("Probá de nuevo en unos minutos")}`, "true false true");

  const rTemprano = await invocar(tEmp, comprobantesA.resolverComprobantePendiente, { comprobanteId: cortado.id });
  comprobar("resolver un PENDIENTE recién creado: todavía no", `${rTemprano.ok} ${(rTemprano.error ?? "").includes("probá en unos minutos")}`, "false true");
  const rPermiso = await invocar(tBaja, comprobantesA.resolverComprobantePendiente, { comprobanteId: cortado.id });
  comprobar("resolver sin permiso (usuario de baja): rechazada", `${rPermiso.ok} ${/Tu sesión terminó|No tenés permiso/.test(rPermiso.error ?? "")}`, "false true");
  const rBasura = await invocar(tEmp, comprobantesA.resolverComprobantePendiente, { comprobanteId: "x" });
  comprobar("resolver con id inválido", `${rBasura.ok} ${rBasura.error}`, "false Comprobante inválido");

  // Se envejece el PENDIENTE (el trigger de la base impide tocar `creadoEn`: se lo suspende un instante).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE comprobantes DISABLE TRIGGER comprobantes_validar_cambio`);
    await tx.$executeRaw`UPDATE comprobantes SET "creadoEn" = now() - interval '1 hour' WHERE id = ${cortado.id}::uuid`;
    await tx.$executeRawUnsafe(`ALTER TABLE comprobantes ENABLE TRIGGER comprobantes_validar_cambio`);
  });
  const panelViejo = texto(await conSesion(tEmp, () => FacturarPanel({ ventaId: vPend.id })));
  comprobar("panel: PENDIENTE viejo → ofrece resolver", String(panelViejo.includes(`"comprobanteId":"${cortado.id}"`)), "true");
  const listado = texto(await conSesion(tEmp, () => paginaListado({ searchParams: Promise.resolve({ estado: "PENDIENTE" }) })));
  // El aviso es un componente hijo (`PendientesViejos`): en el arbol se ven sus props, que traen el PENDIENTE y si puede resolverlo.
  comprobar("listado: el PENDIENTE viejo va al aviso de pendientes, con el botón para quien puede emitir", `${listado.includes(`"id":"${cortado.id}"`)} ${listado.includes('"puedeResolver":true')}`, "true true");
  const rRes = await invocar(tEmp, comprobantesA.resolverComprobantePendiente, { comprobanteId: cortado.id });
  comprobar("resolver un PENDIENTE viejo (empleado): el simulador no lo autorizó → RECHAZADO", `${rRes.ok} ${rRes.estado}`, "true RECHAZADO");
  const rRes2 = await invocar(tEmp, comprobantesA.resolverComprobantePendiente, { comprobanteId: cortado.id });
  comprobar("resolverlo otra vez: ya no está pendiente", `${rRes2.ok} ${(rRes2.error ?? "").includes("ya estaba RECHAZADO")}`, "false true");
  const rFin = await invocar(tEmp, comprobantesA.emitirFactura, { ventaId: vPend.id });
  comprobar("tras resolver, la venta se puede facturar y toma el número", `${rFin.ok} ${rFin.estado}`, "true EMITIDO");

  // ── Pantallas ───────────────────────────────────────────────────────────────
  console.log("--- Pantallas ---");
  const estado = await conSesion(tEmp, () => qComprobantes.estadoFacturacionDeVenta(vPerm.id));
  comprobar("estado de la venta facturada", `${estado?.resumen.situacion} puedeEmitir=${estado?.resumen.puedeEmitir}`, "EMITIDA puedeEmitir=false");
  const estadoSin = await qComprobantes.estadoFacturacionDeVenta(vAnulada.id);
  comprobar("estado de la venta anulada", String(estadoSin?.resumen.situacion), "VENTA_ANULADA");
  const panelEmitida = texto(await conSesion(tEmp, () => FacturarPanel({ ventaId: vPerm.id })));
  comprobar("panel de una venta facturada: lleva la marca de ambiente SIMULADO", String(panelEmitida.includes('"ambiente":"SIMULADO"')), "true");
  comprobar("panel de una venta facturada: sin botón", String(panelEmitida.includes('"visible":true')), "false");
  comprobar("panel sin sesión: no se pinta nada", String(await conSesion(undefined, () => FacturarPanel({ ventaId: vPerm.id }))), "null");

  const pagina = await conSesion(tEmp, () => qComprobantes.getComprobantes(parseFiltrosComprobantes({ ambiente: "SIMULADO", tipo: "FACTURA_B" })));
  comprobar("listado: filtra por tipo y ambiente", String(pagina.filas.length > 0 && pagina.filas.every((c) => c.tipo === "FACTURA_B" && c.ambiente === "SIMULADO")), "true");
  const orden = pagina.filas.map((c) => c.fecha.getTime());
  comprobar("listado: más nuevos primero", String(orden.every((f, i) => i === 0 || orden[i - 1]! >= f)), "true");
  const rango = await qComprobantes.getComprobantes(parseFiltrosComprobantes({ desde: "2001-01-01", hasta: "2001-01-31" }));
  comprobar("listado: rango sin comprobantes → vacío", `${rango.total} ${rango.filas.length}`, "0 0");
  const pEstado = await qComprobantes.getComprobantes(parseFiltrosComprobantes({ estado: "RECHAZADO" }));
  comprobar("listado: filtra por estado", String(pEstado.filas.every((c) => c.estado === "RECHAZADO")), "true");

  const listadoEmp = texto(await conSesion(tEmp, () => paginaListado({ searchParams: Promise.resolve({}) })));
  comprobar("listado: cada fila lleva la marca de ambiente (MarcaAmbiente SIMULADO → SIN VALIDEZ FISCAL)", String(listadoEmp.includes('"ambiente":"SIMULADO"')), "true");
  comprobar("listado (empleado): sin costos ni márgenes", String(/costo|margen|ganancia/i.test(listadoEmp) || /costo|margen/i.test(texto(pagina))), "false");
  comprobar("panel (empleado): sin costos ni márgenes", String(/costo|margen|ganancia/i.test(panelEmitida + panelPend + panelRech)), "false");
  let redirigio = "no";
  try {
    await conSesion(undefined, () => paginaListado({ searchParams: Promise.resolve({}) }));
  } catch (error) {
    redirigio = error instanceof Redireccion ? error.destino : String(error);
  }
  comprobar("listado sin sesión: redirige al login", redirigio, "/login");

  // ── Limpieza ────────────────────────────────────────────────────────────────
  console.log("--- Limpieza ---");
  await limpiar();
  const despues = await foto();
  const cambiadas = [...despues].filter(([t, v]) => base.get(t) !== v).map(([t]) => t);
  comprobar("la base quedó idéntica a la foto inicial (sin rastro)", cambiadas.join(",") || "idéntica", "idéntica");

  await prisma.$disconnect();
  if (fallos > 0) {
    console.log(`\n${fallos} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("\nTodo OK.");
}

main().catch(async (error) => {
  console.error(error);
  try {
    await limpiar();
  } catch (e) {
    console.error("No se pudo limpiar:", e);
  }
  await prisma.$disconnect();
  process.exit(1);
});
