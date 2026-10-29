/**
 * Prueba los permisos por rol contra Postgres real, invocando las server actions,
 * las paginas (su guarda) y el route handler del CSV DE VERDAD con la sesion de un
 * EMPLEADO de prueba.
 *
 *   npm run test:permisos     (corre antes scripts/verificar-permisos.ts, sin base)
 *
 * Como se llama a una accion fuera de Next: las acciones leen la cookie con
 * `cookies()` de `next/headers`, que solo existe dentro de un pedido. Este script
 * (y solo este script: el mecanismo no existe en `src/`, ni en el bundle de
 * produccion) intercepta `require` de `next/headers`, `next/cache` y
 * `next/navigation` con un gancho de `node:module`, y le entrega a la accion una
 * cookie con el token de una sesion REAL creada en la base. Todo lo demas es
 * codigo de produccion sin tocar: `usuarioActual` consulta la base, `puede` mira
 * el rol, la accion hace lo suyo. No hay variable de entorno ni atajo que se salte
 * permisos. El script usa `require()` (no `import()`) para que el gancho alcance.
 *
 * Plan:
 *  1. Limpia restos de una corrida anterior y toma una foto de TODAS las tablas.
 *  2. Crea fixtures (usuarios, cliente, articulo, material, maquina, ventas, pago).
 *  3. Cada accion prohibida, como empleado / sin sesion / token falso / empleado dado
 *     de baja, con datos validos y con basura: tiene que devolver el error de permiso
 *     (antes de validar nada) y la foto de la base no puede cambiar ni un byte.
 *  4. Las acciones permitidas al empleado funcionan y dejan sus efectos.
 *  5. El dueno puede todo lo que el empleado no.
 *  6. Guarda de paginas, route handler del CSV, y que las consultas recortadas no
 *     traen ni una clave ni un valor de costo.
 *  7. Borra sus datos y comprueba que la base quedo IDENTICA a la foto del paso 1.
 */
import "dotenv/config";
import Module from "node:module";
import { randomBytes } from "node:crypto";

// ─── Contexto de pedido falso (solo en este script) ───────────────────────────

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
  // Sin pedido no hay cache que revalidar.
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
const { registrarVentaEnTx } = require("../src/lib/dominio/ventas") as typeof import("../src/lib/dominio/ventas");
const { registrarPagoEnTx } = require("../src/lib/dominio/pagos") as typeof import("../src/lib/dominio/pagos");
const { d } = require("../src/lib/money") as typeof import("../src/lib/money");
const { hoyArgentina, hoyArgentinaISO } = require("../src/lib/acciones") as typeof import("../src/lib/acciones");
const { requierePermisoPagina } = require("../src/lib/permisos") as typeof import("../src/lib/permisos");
const { generarToken } = require("../src/lib/auth-pura") as typeof import("../src/lib/auth-pura");

const ventasA = require("../src/app/ventas/actions") as typeof import("../src/app/ventas/actions");
const ventasIdA = require("../src/app/ventas/[id]/actions") as typeof import("../src/app/ventas/[id]/actions");
const clientesA = require("../src/app/clientes/actions") as typeof import("../src/app/clientes/actions");
const comprasA = require("../src/app/compras/actions") as typeof import("../src/app/compras/actions");
const catalogoA = require("../src/app/catalogo/actions") as typeof import("../src/app/catalogo/actions");
const materialesA = require("../src/app/materiales/actions") as typeof import("../src/app/materiales/actions");
const materialesIdA = require("../src/app/materiales/[id]/actions") as typeof import("../src/app/materiales/[id]/actions");
const configuracionA = require("../src/app/configuracion/actions") as typeof import("../src/app/configuracion/actions");
const reposicionA = require("../src/app/reposicion/actions") as typeof import("../src/app/reposicion/actions");
const rutaCsv = require("../src/app/reportes/export/[reporte]/route") as typeof import("../src/app/reportes/export/[reporte]/route");
const qVentas = require("../src/lib/queries/ventas") as typeof import("../src/lib/queries/ventas");
const qMateriales = require("../src/lib/queries/materiales") as typeof import("../src/lib/queries/materiales");
const qReposicion = require("../src/lib/queries/reposicion") as typeof import("../src/lib/queries/reposicion");
const qCatalogo = require("../src/lib/queries/catalogo") as typeof import("../src/lib/queries/catalogo");
const qCompras = require("../src/lib/queries/compras") as typeof import("../src/lib/queries/compras");
/* eslint-enable @typescript-eslint/no-require-imports */

nombreCookie = COOKIE_SESION;

// ─── Utilidades de prueba ─────────────────────────────────────────────────────

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const MARCA = `zz-t43-${randomBytes(3).toString("hex")}`;
const PREFIJO = "zz-t43-";
const CLAVE = "clave-de-prueba-123";

type Foto = Map<string, string>;

/** Foto de TODAS las tablas: cantidad de filas y un hash de su contenido completo. */
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

/**
 * Tablas que cambiaron. `sesiones` se ignora salvo que se pida: resolver la sesion de un
 * usuario dado de baja la borra al encontrarla (a proposito), y no es un dato del negocio.
 */
function diferencias(antes: Foto, despues: Foto, ignorar: string[] = ["sesiones"]): string[] {
  const cambiadas: string[] = [];
  for (const [tabla, valor] of despues) if (antes.get(tabla) !== valor && !ignorar.includes(tabla)) cambiadas.push(tabla);
  for (const tabla of antes.keys()) if (!despues.has(tabla)) cambiadas.push(tabla);
  return cambiadas;
}

type Respuesta = { ok?: boolean; error?: string; lanzo?: boolean; [k: string]: unknown };

/** Invoca una accion con la sesion `token` (o sin cookie) y recoge lo que devuelve o lanza. */
async function invocar(token: string | undefined, accion: unknown, datos: unknown): Promise<Respuesta> {
  cookieActual = token;
  try {
    return (await (accion as (d: unknown) => Promise<Respuesta>)(datos)) ?? {};
  } catch (error) {
    return { ok: false, lanzo: true, error: error instanceof Error ? error.message : String(error) };
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

/** Todas las claves de un objeto, a cualquier profundidad (arreglos y Decimal incluidos). */
function claves(valor: unknown, salida = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) {
    for (const v of valor) claves(v, salida);
  } else if (valor && typeof valor === "object" && !(valor instanceof Date) && typeof (valor as { toFixed?: unknown }).toFixed !== "function") {
    for (const [k, v] of Object.entries(valor)) {
      salida.add(k);
      claves(v, salida);
    }
  }
  return salida;
}

const texto = (valor: unknown) => JSON.stringify(valor);

// ─── Limpieza ─────────────────────────────────────────────────────────────────

async function borrarRastros(prefijo: string) {
  const like = `${prefijo}%`;
  await prisma.$executeRaw`DELETE FROM movimientos_stock WHERE "materialId" IN (SELECT id FROM materiales WHERE nombre LIKE ${like})
    OR "compraId" IN (SELECT id FROM compras WHERE proveedor LIKE ${like})
    OR "ventaId" IN (SELECT id FROM ventas WHERE "clienteId" IN (SELECT id FROM clientes WHERE nombre LIKE ${like}))`;
  await prisma.$executeRaw`DELETE FROM compras WHERE proveedor LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM ventas WHERE "clienteId" IN (SELECT id FROM clientes WHERE nombre LIKE ${like})`;
  await prisma.$executeRaw`DELETE FROM articulos WHERE nombre LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM materiales WHERE nombre LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM maquinas WHERE nombre LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM clientes WHERE nombre LIKE ${like}`;
  await prisma.$executeRaw`DELETE FROM sesiones WHERE "usuarioId" IN (SELECT id FROM usuarios WHERE usuario LIKE ${like})`;
  await prisma.$executeRaw`DELETE FROM usuarios WHERE usuario LIKE ${like}`;
}

// ─── Prueba ───────────────────────────────────────────────────────────────────

const PERMISO = "No tenés permiso";
const SIN_SESION = "Tu sesión terminó";

async function main() {
  const { dbDisponible } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
  if (!(await dbDisponible())) {
    console.error("No hay base de datos: esta prueba necesita Postgres (DATABASE_URL).");
    process.exit(1);
  }

  console.log("--- Preparacion ---");
  await borrarRastros(PREFIJO); // restos de una corrida que se cayo a la mitad
  const base = await foto();
  console.log(`     foto inicial de ${base.size} tablas`);

  // Usuarios y sesiones reales.
  const emp = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `${MARCA}-emp`, nombre: "Empleado de prueba", rol: "EMPLEADO", clave: CLAVE }));
  const due = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `${MARCA}-due`, nombre: "Dueno de prueba", rol: "DUENO", clave: CLAVE }));
  const baja = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `${MARCA}-baja`, nombre: "Empleado dado de baja", rol: "EMPLEADO", clave: CLAVE }));
  const tEmp = (await crearSesion(prisma, emp.id)).token;
  const tDue = (await crearSesion(prisma, due.id)).token;
  const tBaja = (await crearSesion(prisma, baja.id)).token;
  await prisma.usuario.update({ where: { id: baja.id }, data: { activo: false } });
  const tFalso = generarToken(); // formato valido, no existe en la base

  // Fixtures de datos.
  const cliente = await prisma.cliente.create({ data: { nombre: `${MARCA} cliente` } });
  const articulo = await prisma.articulo.create({
    data: { nombre: `${MARCA} servicio`, precioVenta: "1000", ivaPct: "21", esServicio: true },
  });
  const material = await prisma.material.create({
    data: { nombre: `${MARCA} material`, unidad: "U", stockActual: "10", stockMinimo: "1", costoUnitario: "7777", precioVenta: "8888" },
  });
  const materialBajo = await prisma.material.create({
    data: { nombre: `${MARCA} material bajo`, unidad: "U", stockActual: "0", stockMinimo: "5", costoUnitario: "6543" },
  });
  const maquina = await prisma.maquina.create({ data: { nombre: `${MARCA} maquina`, costoHora: "4321" } });
  const crearVenta = (entregada: boolean) =>
    prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, { clienteId: cliente.id, fecha: hoyArgentina(), observaciones: MARCA, entregada, items: [{ articuloId: articulo.id, cantidad: d("2") }], pago: null }),
    );
  const v1 = await crearVenta(false); // el empleado la cobra y la entrega
  const v2 = await crearVenta(false); // prohibido anularla
  const v3 = await crearVenta(true); // con un pago que no puede anular
  const pagoV3 = await prisma.$transaction((tx) =>
    registrarPagoEnTx(tx, { ventaId: v3.id, monto: d("500"), metodo: "EFECTIVO", fecha: hoyArgentina(), notas: null }),
  );
  const hoy = hoyArgentinaISO();
  comprobar("fixtures creados", String(Boolean(cliente.id && articulo.id && material.id && maquina.id && v1.id && v2.id && v3.id && pagoV3.id)), "true");

  // ── Acciones prohibidas para el empleado: datos validos y basura ─────────────
  const PROHIBIDAS: { nombre: string; accion: unknown; validos: unknown }[] = [
    { nombre: "anularVenta", accion: ventasIdA.anularVenta, validos: { ventaId: v2.id } },
    { nombre: "anularPago", accion: ventasIdA.anularPago, validos: { pagoId: pagoV3.id, motivo: "prueba" } },
    { nombre: "ajustarStock", accion: materialesIdA.ajustarStock, validos: { materialId: material.id, stockContado: "999", motivo: "prueba" } },
    {
      nombre: "registrarCompra",
      accion: comprasA.registrarCompra,
      validos: { fecha: hoy, proveedor: `${MARCA} proveedor`, actualizarCosto: true, items: [{ materialId: material.id, cantidad: "5", costoUnitario: "500" }] },
    },
    {
      nombre: "guardarArticulo",
      accion: catalogoA.guardarArticulo,
      validos: { id: articulo.id, nombre: `${MARCA} hack`, descripcion: "", precioVenta: "1", ivaPct: "21", esServicio: true, lineas: [] },
    },
    { nombre: "cambiarActivoArticulo", accion: catalogoA.cambiarActivoArticulo, validos: { id: articulo.id, activo: false } },
    {
      nombre: "crearMaterial",
      accion: materialesA.crearMaterial,
      validos: { nombre: `${MARCA} hack`, unidad: "U", stockInicial: "1", stockMinimo: "0", costoUnitario: "1" },
    },
    {
      nombre: "editarMaterial",
      accion: materialesA.editarMaterial,
      validos: { id: material.id, nombre: `${MARCA} hack`, unidad: "U", stockMinimo: "0", costoUnitario: "1", costoOriginal: "7777" },
    },
    { nombre: "cambiarEstadoMaterial", accion: materialesA.cambiarEstadoMaterial, validos: { id: material.id, activo: false } },
    {
      nombre: "guardarConfiguracion",
      accion: configuracionA.guardarConfiguracion,
      validos: { nombreNegocio: `${MARCA} hack`, costoHoraManoObra: "1", ivaPorDefecto: "21", margenObjetivo: "10" },
    },
    { nombre: "crearMaquina", accion: configuracionA.crearMaquina, validos: { nombre: `${MARCA} hack`, costoHora: "1" } },
    { nombre: "editarMaquina", accion: configuracionA.editarMaquina, validos: { id: maquina.id, nombre: `${MARCA} hack`, costoHora: "1" } },
    { nombre: "cambiarActivoMaquina", accion: configuracionA.cambiarActivoMaquina, validos: { id: maquina.id, activo: false } },
    { nombre: "guardarFactorReposicion", accion: reposicionA.guardarFactorReposicion, validos: { factor: "9" } },
  ];
  const BASURA: unknown[] = [{}, null, undefined, "texto", [], { id: 1 }];

  const actores: { titulo: string; token: string | undefined; mensaje: string }[] = [
    { titulo: "empleado", token: tEmp, mensaje: PERMISO },
    { titulo: "sin cookie", token: undefined, mensaje: SIN_SESION },
    { titulo: "token inexistente", token: tFalso, mensaje: SIN_SESION },
    { titulo: "empleado dado de baja", token: tBaja, mensaje: SIN_SESION },
  ];

  for (const actor of actores) {
    console.log(`--- Acciones prohibidas: ${actor.titulo} ---`);
    for (const p of PROHIBIDAS) {
      const variantes: [string, unknown][] = [["datos validos", p.validos], ...BASURA.map((b, i): [string, unknown] => [`basura ${i + 1}`, b])];
      let todasBien = true;
      let detalle = "";
      for (const [nombreVariante, datos] of variantes) {
        const antes = await foto();
        const r = await invocar(actor.token, p.accion, datos);
        const cambios = diferencias(antes, await foto());
        const bien = r.ok === false && typeof r.error === "string" && r.error.includes(actor.mensaje) && cambios.length === 0;
        if (!bien) {
          todasBien = false;
          detalle += ` [${nombreVariante}: ok=${r.ok} error=${JSON.stringify(r.error)} tablas cambiadas=${cambios.join(",") || "ninguna"}]`;
        }
      }
      comprobar(`${p.nombre} rechazada y sin cambios (${variantes.length} variantes)`, todasBien ? "si" : `no${detalle}`, "si");
    }
  }

  // Las "permitidas" tampoco corren sin sesion.
  console.log("--- Acciones permitidas al empleado, sin sesion ---");
  const PERMITIDAS_SIN_SESION: [string, unknown, unknown][] = [
    ["registrarVenta", ventasA.registrarVenta, { clienteId: cliente.id, observaciones: "", entregada: true, items: [{ articuloId: articulo.id, cantidad: "1" }], pago: null }],
    ["registrarPago", ventasIdA.registrarPago, { ventaId: v1.id, monto: "100", metodo: "EFECTIVO", fecha: hoy }],
    ["marcarEntregada", ventasIdA.marcarEntregada, { ventaId: v1.id }],
    ["crearCliente", clientesA.crearCliente, { nombre: `${MARCA} sin sesion` }],
    ["editarCliente", clientesA.editarCliente, { id: cliente.id, nombre: `${MARCA} hack` }],
    ["cambiarActivoCliente", clientesA.cambiarActivoCliente, { id: cliente.id, activo: false }],
  ];
  for (const [nombre, accion, datos] of PERMITIDAS_SIN_SESION) {
    for (const [titulo, token] of [["sin cookie", undefined], ["token inexistente", tFalso], ["empleado dado de baja", tBaja]] as const) {
      const antes = await foto();
      const r = await invocar(token, accion, datos);
      const cambios = diferencias(antes, await foto());
      comprobar(`${nombre} (${titulo}) rechazada y sin cambios`, `${r.ok}/${String(r.error).includes(SIN_SESION)}/${cambios.length}`, "false/true/0");
    }
  }

  // ── Acciones permitidas al empleado ──────────────────────────────────────────
  console.log("--- Acciones permitidas: empleado ---");
  const venta = await invocar(tEmp, ventasA.registrarVenta, {
    clienteId: cliente.id,
    observaciones: `${MARCA} venta del empleado`,
    entregada: false,
    items: [{ articuloId: articulo.id, cantidad: "3" }],
    pago: { monto: "100", metodo: "EFECTIVO" },
  });
  comprobar("empleado: registrarVenta", String(venta.ok), "true");
  const creada = await prisma.venta.findFirst({ where: { observaciones: `${MARCA} venta del empleado` }, include: { pagos: true, items: true } });
  comprobar("  la venta existe, con su item y su pago inicial", `${creada?.items.length}/${creada?.pagos.length}`, "1/1");
  comprobar("  el servidor recalculo el total (3 x 1000, IVA incluido)", String(creada?.totalBruto.toFixed(2)), "3000.00");
  comprobar("  y congelo el costo (servicio sin receta: 0)", String(creada?.costoTotal.toFixed(2)), "0.00");

  const pago = await invocar(tEmp, ventasIdA.registrarPago, { ventaId: v1.id, monto: "100", metodo: "TRANSFERENCIA", fecha: hoy });
  comprobar("empleado: registrarPago", String(pago.ok), "true");
  comprobar("  el pago quedo registrado", String(await prisma.pago.count({ where: { ventaId: v1.id, anuladoEn: null } })), "1");
  const entrega = await invocar(tEmp, ventasIdA.marcarEntregada, { ventaId: v1.id });
  comprobar("empleado: marcarEntregada", String(entrega.ok), "true");
  comprobar("  la venta quedo ENTREGADA", String((await prisma.venta.findUnique({ where: { id: v1.id } }))?.estado), "ENTREGADA");

  const nuevoCliente = await invocar(tEmp, clientesA.crearCliente, { nombre: `${MARCA} cliente del empleado`, telefono: "11 5555 5555" });
  comprobar("empleado: crearCliente", String(nuevoCliente.ok), "true");
  const idNuevo = String(nuevoCliente.id);
  comprobar("empleado: editarCliente", String((await invocar(tEmp, clientesA.editarCliente, { id: idNuevo, nombre: `${MARCA} cliente editado` })).ok), "true");
  comprobar("  el nombre cambio", String((await prisma.cliente.findUnique({ where: { id: idNuevo } }))?.nombre), `${MARCA} cliente editado`);
  comprobar("empleado: cambiarActivoCliente", String((await invocar(tEmp, clientesA.cambiarActivoCliente, { id: idNuevo, activo: false })).ok), "true");
  comprobar("  el cliente quedo dado de baja", String((await prisma.cliente.findUnique({ where: { id: idNuevo } }))?.activo), "false");

  // ── El dueno puede lo que el empleado no ─────────────────────────────────────
  console.log("--- Acciones prohibidas al empleado: el dueno SI puede ---");
  const configAntes = await prisma.configuracion.findMany();
  const confianza = Object.fromEntries(configAntes.map((c) => [c.clave, c.valor]));
  const ok = async (etiqueta: string, accion: unknown, datos: unknown) => {
    const r = await invocar(tDue, accion, datos);
    comprobar(`dueno: ${etiqueta}`, `${r.ok}${r.ok ? "" : ` ${r.error}`}`, "true");
    return r;
  };

  await ok("anularVenta", ventasIdA.anularVenta, { ventaId: v2.id });
  comprobar("  la venta quedo ANULADA", String((await prisma.venta.findUnique({ where: { id: v2.id } }))?.estado), "ANULADA");
  await ok("anularPago", ventasIdA.anularPago, { pagoId: pagoV3.id, motivo: "prueba" });
  comprobar("  el pago quedo anulado", String((await prisma.pago.findUnique({ where: { id: pagoV3.id } }))?.anuladoEn !== null), "true");
  await ok("ajustarStock", materialesIdA.ajustarStock, { materialId: material.id, stockContado: "20", motivo: "prueba" });
  comprobar("  el stock quedo en 20", String((await prisma.material.findUnique({ where: { id: material.id } }))?.stockActual.toFixed(0)), "20");
  await ok("registrarCompra", comprasA.registrarCompra, {
    fecha: hoy, proveedor: `${MARCA} proveedor`, actualizarCosto: false, items: [{ materialId: material.id, cantidad: "5", costoUnitario: "500" }],
  });
  comprobar("  la compra existe y el stock subio a 25", `${await prisma.compra.count({ where: { proveedor: `${MARCA} proveedor` } })}/${(await prisma.material.findUnique({ where: { id: material.id } }))?.stockActual.toFixed(0)}`, "1/25");
  // Las acciones de ventas, tambien para el dueno (antes de dar de baja el articulo).
  await ok("registrarVenta", ventasA.registrarVenta, { clienteId: cliente.id, observaciones: MARCA, entregada: true, items: [{ articuloId: articulo.id, cantidad: "1" }], pago: null });
  await ok("guardarArticulo", catalogoA.guardarArticulo, { id: articulo.id, nombre: `${MARCA} servicio editado`, descripcion: "", precioVenta: "1000", ivaPct: "21", esServicio: true, lineas: [] });
  comprobar("  el articulo se renombro", String((await prisma.articulo.findUnique({ where: { id: articulo.id } }))?.nombre), `${MARCA} servicio editado`);
  await ok("cambiarActivoArticulo (baja)", catalogoA.cambiarActivoArticulo, { id: articulo.id, activo: false });
  comprobar("  el articulo quedo de baja", String((await prisma.articulo.findUnique({ where: { id: articulo.id } }))?.activo), "false");
  await ok("cambiarActivoArticulo (reactivar)", catalogoA.cambiarActivoArticulo, { id: articulo.id, activo: true });
  const nuevoMaterial = await ok("crearMaterial", materialesA.crearMaterial, { nombre: `${MARCA} material creado`, unidad: "U", stockInicial: "3", stockMinimo: "1", costoUnitario: "10" });
  await ok("editarMaterial", materialesA.editarMaterial, { id: material.id, nombre: `${MARCA} material editado`, unidad: "U", stockMinimo: "1", costoUnitario: "7777", costoOriginal: "7777", precioVenta: "8888" });
  await ok("cambiarEstadoMaterial", materialesA.cambiarEstadoMaterial, { id: String(nuevoMaterial.id), activo: false });
  await ok("crearMaquina", configuracionA.crearMaquina, { nombre: `${MARCA} maquina creada`, costoHora: "10" });
  await ok("editarMaquina", configuracionA.editarMaquina, { id: maquina.id, nombre: `${MARCA} maquina editada`, costoHora: "4321" });
  await ok("cambiarActivoMaquina", configuracionA.cambiarActivoMaquina, { id: maquina.id, activo: false });
  await ok("guardarFactorReposicion", reposicionA.guardarFactorReposicion, { factor: "3" });
  comprobar("  el factor quedo guardado", String((await prisma.configuracion.findUnique({ where: { clave: "factorReposicion" } }))?.valor), "3");
  await ok("guardarConfiguracion", configuracionA.guardarConfiguracion, {
    nombreNegocio: confianza.nombreNegocio ?? "HL Laser",
    costoHoraManoObra: confianza.costoHoraManoObra ?? "3500",
    ivaPorDefecto: confianza.ivaDefault ?? "21",
    margenObjetivo: confianza.margenObjetivo ?? "45",
  });
  // El dueno ya no tiene una configuracion intacta: se restaura tal cual estaba.
  await prisma.$transaction([prisma.configuracion.deleteMany({}), prisma.configuracion.createMany({ data: configAntes })]);

  // ── Guarda de paginas ────────────────────────────────────────────────────────
  console.log("--- Guarda de paginas (requierePermisoPagina) ---");
  const intentar = async (token: string | undefined, ...acciones: Parameters<typeof requierePermisoPagina>) =>
    conSesion(token, async () => {
      try {
        const u = await requierePermisoPagina(...acciones);
        return `entra (${u.rol})`;
      } catch (error) {
        return error instanceof Redireccion ? `redirige a ${error.destino}` : `error: ${error}`;
      }
    });
  comprobar("empleado en el dashboard (verCostos, verMargenes)", await intentar(tEmp, "verCostos", "verMargenes"), "redirige a /ventas/nueva");
  comprobar("empleado en /reportes", await intentar(tEmp, "verReportes", "verCostos", "verMargenes"), "redirige a /ventas/nueva");
  comprobar("empleado en /configuracion", await intentar(tEmp, "configuracion"), "redirige a /ventas/nueva");
  comprobar("empleado en una pagina que pide una permitida y otra prohibida", await intentar(tEmp, "verStock", "verCostos"), "redirige a /ventas/nueva");
  comprobar("empleado en /ventas/nueva", await intentar(tEmp, "cargarVenta"), "entra (EMPLEADO)");
  comprobar("empleado en /materiales", await intentar(tEmp, "verStock"), "entra (EMPLEADO)");
  comprobar("empleado en /reposicion", await intentar(tEmp, "verReposicion"), "entra (EMPLEADO)");
  comprobar("empleado en /cobranzas", await intentar(tEmp, "verCobranzas"), "entra (EMPLEADO)");
  comprobar("dueno en el dashboard", await intentar(tDue, "verCostos", "verMargenes"), "entra (DUENO)");
  comprobar("dueno en /configuracion", await intentar(tDue, "configuracion"), "entra (DUENO)");
  comprobar("sin sesion va a /login (no a una pagina del rol)", await intentar(undefined, "verStock"), "redirige a /login");
  comprobar("token inexistente va a /login", await intentar(tFalso, "verStock"), "redirige a /login");
  comprobar("empleado dado de baja va a /login", await intentar(tBaja, "cargarVenta"), "redirige a /login");

  // ── Route handler del CSV ────────────────────────────────────────────────────
  console.log("--- Export CSV ---");
  const pedirCsv = async (token: string | undefined, reporte: string) =>
    conSesion(token, async () => {
      const respuesta = await rutaCsv.GET(new Request(`http://localhost/reportes/export/${reporte}`), { params: Promise.resolve({ reporte }) });
      return { estado: respuesta.status, tipo: respuesta.headers.get("content-type") ?? "", cuerpo: await respuesta.text(), ubicacion: respuesta.headers.get("location") };
    });
  for (const reporte of ["resumen", "ganancia-por-producto", "productos-rentables", "deuda-por-cliente", "consumo-materiales", "no-existe"]) {
    const r = await pedirCsv(tEmp, reporte);
    comprobar(`empleado: ${reporte} → 403 de texto plano, sin redireccion, sin datos`, `${r.estado}/${r.tipo.startsWith("text/plain")}/${r.ubicacion}/${r.cuerpo.includes(PERMISO)}/${r.cuerpo.length < 80}`, "403/true/null/true/true");
  }
  const sinSesionCsv = await pedirCsv(undefined, "resumen");
  comprobar("sin sesion: 401", `${sinSesionCsv.estado}/${sinSesionCsv.ubicacion}`, "401/null");
  const bajaCsv = await pedirCsv(tBaja, "resumen");
  comprobar("empleado dado de baja: 401", String(bajaCsv.estado), "401");
  const duenoCsv = await pedirCsv(tDue, "resumen");
  comprobar("dueno: 200 CSV con datos", `${duenoCsv.estado}/${duenoCsv.tipo.startsWith("text/csv")}/${duenoCsv.cuerpo.includes("Facturado bruto")}`, "200/true/true");
  comprobar("dueno: reporte inexistente → 404", String((await pedirCsv(tDue, "no-existe")).estado), "404");

  // ── Los datos prohibidos no salen de la base ─────────────────────────────────
  console.log("--- Consultas recortadas: ni claves ni valores de costo ---");
  const COSTOS = ["costoTotal", "ganancia", "costoUnitario", "costoUnitarioSnapshot", "costoTotalSnapshot", "costoEstimado", "valorInventario", "total", "receta", "recetaConfiable", "margen", "costo"];
  const sinClavesDeCosto = (etiqueta: string, valor: unknown, tambienPrecio = false) => {
    const k = claves(valor);
    const malas = [...k].filter((c) => COSTOS.includes(c) || (tambienPrecio && c === "precioVenta"));
    comprobar(`${etiqueta}: sin claves de costo`, malas.join(",") || "ninguna", "ninguna");
  };
  const costosEnBase = [
    ...(await prisma.venta.findMany({ select: { costoTotal: true } })).map((v) => v.costoTotal.toFixed(2)),
    ...(await prisma.material.findMany({ select: { costoUnitario: true, precioVenta: true } })).flatMap((m) => [m.costoUnitario.toFixed(2), m.costoUnitario.toFixed(4), m.precioVenta?.toFixed(2) ?? "", m.precioVenta?.toFixed(4) ?? ""]),
  ].filter((c) => c.split(".")[0]!.length >= 4); // montos de 1000 para arriba: los chicos chocan con cantidades cualquiera
  const sinValoresDeCosto = (etiqueta: string, valor: unknown) => {
    const t = texto(valor);
    // un valor de costo es "24000.00" / "24000" / 24000: se busca el entero con borde de numero.
    const hallados = costosEnBase.filter((c) => {
      const entero = /\.0+$/.test(c);
      const base = c.replace(/\.0+$/, "").replace(".", "\\.");
      return new RegExp(`(^|[^0-9.])${base}${entero ? "(\\.0+)?" : ""}($|[^0-9])`).test(t);
    });
    comprobar(`${etiqueta}: sin valores de costo de la base`, hallados.join(",") || "ninguno", "ninguno");
  };

  const ventasEmp = await qVentas.getVentasSinCostos(200);
  comprobar("getVentasSinCostos trae las ventas reales (no la demo)", String(ventasEmp.some((v) => v.id === v1.id)), "true");
  sinClavesDeCosto("getVentasSinCostos", ventasEmp);
  sinValoresDeCosto("getVentasSinCostos", ventasEmp);
  comprobar("getVentas (dueno) SI trae costo y ganancia", String(claves(await qVentas.getVentas(5)).has("ganancia")), "true");

  const detalle = await qVentas.getVenta(v1.id);
  sinClavesDeCosto("getVenta (detalle)", detalle);
  sinValoresDeCosto("getVenta (detalle)", detalle);
  comprobar("  el detalle trae items y pagos", `${detalle?.items.length}/${detalle?.pagos.length}`, "1/1");
  const seed = (await prisma.venta.findFirst({ where: { costoTotal: { gt: 0 } }, select: { id: true } }))?.id;
  if (seed) sinValoresDeCosto("getVenta (venta de la semilla con costo)", await qVentas.getVenta(seed));

  const materialesEmp = await qMateriales.getMaterialesStock();
  comprobar("getMaterialesStock trae los materiales reales", String(materialesEmp.some((m) => m.id === material.id)), "true");
  comprobar("  claves exactas", [...claves(materialesEmp)].sort().join(","), "estado,id,nombre,stockActual,stockMinimo,unidad");
  sinValoresDeCosto("getMaterialesStock", materialesEmp);
  comprobar("getMateriales (dueno) SI trae costo y valorizacion", String(claves(await qMateriales.getMateriales()).has("valorInventario")), "true");

  const repoEmp = await qReposicion.getReposicionSinCostos();
  comprobar("getReposicionSinCostos lista el material bajo minimo", String(repoEmp.lineas.some((l) => l.id === materialBajo.id)), "true");
  comprobar("  claves de la linea sin costo", [...claves(repoEmp.lineas)].filter((c) => /costo|total/i.test(c)).join(",") || "ninguna", "ninguna");
  comprobar("  claves de primer nivel", Object.keys(repoEmp).sort().join(","), "conMinimo,factor,lineas");
  sinValoresDeCosto("getReposicionSinCostos", repoEmp);
  comprobar("getReposicion (dueno) SI trae costo estimado y total", String(claves(await qReposicion.getReposicion()).has("costoEstimado")), "true");

  const articulosEmp = await qCatalogo.getArticulosParaVender();
  comprobar("getArticulosParaVender trae el articulo", String(articulosEmp.some((a) => a.id === articulo.id)), "true");
  comprobar("  claves exactas", [...claves(articulosEmp)].sort().join(","), "descripcion,esServicio,id,ivaPct,nombre,precioVenta");
  comprobar("getArticulosConMargen (dueno) SI trae receta", String(claves(await qCatalogo.getArticulosConMargen()).has("receta")), "true");

  const movConProveedor = await qCompras.getMovimientos(material.id, 100, false);
  const movSinProveedor = await qCompras.getMovimientos(material.id, 100, true);
  comprobar("libro de stock (dueno): el motivo de la compra nombra al proveedor", String(texto(movConProveedor).includes(`${MARCA} proveedor`)), "true");
  comprobar("libro de stock (empleado): sin proveedor", String(texto(movSinProveedor).includes(`${MARCA} proveedor`)), "false");
  comprobar("  pero conserva las cantidades", String(movSinProveedor.some((m) => m.tipo === "COMPRA" && m.cantidad.toFixed(0) === "5")), "true");

  // ── Limpieza ─────────────────────────────────────────────────────────────────
  console.log("--- Limpieza ---");
  await borrarRastros(PREFIJO);
  const diferenciasFinales = diferencias(base, await foto());
  comprobar("la base quedo identica a la foto inicial (todas las tablas)", diferenciasFinales.join(",") || "identica", "identica");
}

main()
  .catch((error) => {
    fallos += 1;
    console.error("FALLA error inesperado:", error);
  })
  .finally(async () => {
    // Si algo se cayo antes de la limpieza, se borra igual.
    try {
      await borrarRastros(PREFIJO);
    } catch (error) {
      console.error("No se pudo limpiar:", error);
    }
    await prisma.$disconnect();
    console.log("");
    if (fallos > 0) {
      console.log(`${fallos} comprobacion(es) fallaron.`);
      process.exit(1);
    }
    console.log("Todas las comprobaciones pasaron.");
  });
