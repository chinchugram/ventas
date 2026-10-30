/**
 * Prueba las notas de credito (tarea 5.4) contra Postgres real, sin Next:
 *
 *   npm run test:notas-credito
 *
 * Parte 1 (escenarios que se deshacen): una venta facturada no se anula sin
 * nota de credito y con ella si; la letra y la asociacion (A, B y C) y lo que se
 * le pide al emisor; la NC copia la foto de la FACTURA aunque despues se editen
 * el cliente, el articulo y la configuracion; un rechazo deja RECHAZADO sin
 * perder el numero; un corte deja PENDIENTE; venta sin factura, factura
 * pendiente, otra factura u otro ambiente: error claro.
 *
 * Parte 2 (transacciones reales, ventas del anio ficticio 2099, punto de venta
 * propio y datos con prefijo; se borra todo al terminar): una sola NC por
 * factura incluso con pedidos simultaneos (una transaccion y dos fases), la
 * serie sin huecos con ventas distintas a la vez, resolucion de un PENDIENTE y,
 * llamando a la server action REAL con sesiones reales, que un empleado no puede
 * (permiso) y que el dueno si.
 *
 * Las acciones leen la cookie con `cookies()` de `next/headers`, que solo existe
 * dentro de un pedido: igual que scripts/test-permisos.ts, este script (y solo
 * este) intercepta `require` de los modulos de Next con un gancho de
 * `node:module` y le entrega a la accion la cookie de una sesion REAL.
 */
import "dotenv/config";
import Module from "node:module";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { ErrorDeNegocio, hoyArgentina } from "../src/lib/acciones";
import { digitoVerificadorCuit } from "../src/lib/cuit";
import { CLAVES_FISCALES } from "../src/lib/datos-fiscales";
import type { Tx } from "../src/lib/dominio/tx";
import { anularVentaEnTx, registrarVentaEnTx } from "../src/lib/dominio/ventas";
import {
  accesoSimulado,
  ANTIGUEDAD_MINIMA_PENDIENTE_MS,
  emitirFactura,
  emitirFacturaEnTx,
  resolverPendiente,
  type ComprobanteProcesado,
} from "../src/lib/dominio/comprobantes";
import {
  emitirNotaCredito,
  emitirNotaCreditoEnTx,
  facturaAnulableDeVenta,
  reservarNotaCreditoEnTx,
} from "../src/lib/dominio/notas-credito";
import type { EmisorFiscal, SolicitudCae } from "../src/lib/fiscal";
import { crearEmisorSimulado, type OpcionesSimulador } from "../src/lib/fiscal/emisor-simulado";

// ─── Contexto de pedido falso (solo en este script) ───────────────────────────

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
const { COOKIE_SESION } = require("../src/lib/auth") as typeof import("../src/lib/auth");
const { crearSesion, crearUsuarioEnTx } = require("../src/lib/dominio/auth") as typeof import("../src/lib/dominio/auth");
const accionesDeVenta = require("../src/app/ventas/[id]/actions") as typeof import("../src/app/ventas/[id]/actions");
const { prisma: prismaDeLaApp } = require("../src/lib/prisma") as typeof import("../src/lib/prisma");
/* eslint-enable @typescript-eslint/no-require-imports */
nombreCookie = COOKIE_SESION;

// ─── Utilidades ───────────────────────────────────────────────────────────────

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
    comprobar(etiqueta, ok ? "rechazada" : `${error instanceof Error ? error.message : String(error)}`, "rechazada");
  }
}

function nuevoCliente() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });
}
const prisma = nuevoCliente();

class Deshacer extends Error {}

async function escenario(titulo: string, fn: (tx: Tx) => Promise<void>) {
  console.log(`--- ${titulo} ---`);
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Deshacer();
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    if (!(error instanceof Deshacer)) {
      fallos += 1;
      console.log("FALLA error inesperado:", error);
    }
  }
}

const f = (iso: string) => new Date(`${iso}T00:00:00Z`);
const HOY = hoyArgentina();
const iso = (fecha: Date) => fecha.toISOString().slice(0, 10);
const cuitCon = (diez: string) => `${diez}${digitoVerificadorCuit(diez)}`;
const CUIT_EMISOR = cuitCon("2033333333");
const CUIT_RI = cuitCon("3070000000");
/** Puntos de venta propios de las pruebas: los numeros arrancan en 1 aunque la base tenga comprobantes. */
const PV = 4351;
const PV_REAL = 4352;

async function configurarFiscal(db: Tx | PrismaClient, valores: Partial<Record<keyof typeof CLAVES_FISCALES, string>> = {}) {
  const todos = {
    razonSocial: "Prueba Fiscal S.R.L.",
    cuit: CUIT_EMISOR,
    condicionIva: "RESPONSABLE_INSCRIPTO",
    domicilio: "Calle de Prueba 123, Córdoba",
    inicioActividades: "2020-03-02",
    iibb: "280-123456-7",
    puntoVenta: String(PV),
    umbralIdentificacion: "",
    ...valores,
  };
  for (const [campo, valor] of Object.entries(todos) as [keyof typeof CLAVES_FISCALES, string][]) {
    const clave = CLAVES_FISCALES[campo];
    if (valor === "") await db.configuracion.deleteMany({ where: { clave } });
    else await db.configuracion.upsert({ where: { clave }, update: { valor }, create: { clave, valor } });
  }
}

/**
 * Articulos (servicios, sin stock): X 1210 con IVA 21, Y 110,50 con IVA 10,5 y
 * Z 500 con IVA 0. Clientes: consumidor final con domicilio y responsable
 * inscripto con CUIT. Datos fiscales completos (RI, punto PV).
 */
async function preparar(db: Tx | PrismaClient, prefijo: string, puntoVenta = PV) {
  await configurarFiscal(db, { puntoVenta: String(puntoVenta) });
  const x = await db.articulo.create({ data: { nombre: `${prefijo} X`, precioVenta: d(1210), ivaPct: d(21), esServicio: true } });
  const y = await db.articulo.create({ data: { nombre: `${prefijo} Y`, precioVenta: d("110.5"), ivaPct: d("10.5"), esServicio: true } });
  const z = await db.articulo.create({ data: { nombre: `${prefijo} Z`, precioVenta: d(500), ivaPct: d(0), esServicio: true } });
  const final = await db.cliente.create({ data: { nombre: `${prefijo} consumidor final`, direccion: "Mostrador" } });
  const ri = await db.cliente.create({
    data: { nombre: `${prefijo} RI`, cuit: CUIT_RI, condicionIva: "RESPONSABLE_INSCRIPTO", direccion: "Av. Colón 1, Córdoba" },
  });
  return { x, y, z, final, ri };
}

async function usuarioDePrueba(tx: Tx) {
  return tx.usuario.create({
    data: {
      usuario: `zz-${randomBytes(4).toString("hex")}`,
      nombre: "Dueña de prueba",
      rol: "DUENO",
      hashClave: `scrypt$ln=14,r=8,p=1$${"a".repeat(22)}$${"b".repeat(43)}`,
    },
  });
}

async function venta(db: Tx, clienteId: string, items: { articuloId: string; cantidad: string | number }[], fecha = HOY) {
  const v = await registrarVentaEnTx(db, {
    clienteId,
    fecha,
    observaciones: null,
    entregada: false,
    items: items.map((i) => ({ articuloId: i.articuloId, cantidad: d(i.cantidad) })),
    pago: null,
  });
  return v.id;
}

const simulado = (tx: Tx, opciones?: OpcionesSimulador) => crearEmisorSimulado(accesoSimulado(tx), opciones);

/** Las lineas y alicuotas de un comprobante, como texto, para comparar la NC con su factura. */
async function detalle(db: Tx | PrismaClient, id: string) {
  const c = await db.comprobante.findUniqueOrThrow({
    where: { id },
    include: { items: { orderBy: { orden: "asc" } }, alicuotas: { orderBy: { alicuotaPct: "asc" } } },
  });
  return {
    c,
    items: c.items.map((i) => [i.orden, i.descripcion, i.cantidad, i.precioUnitario, i.ivaPct, i.subtotalNeto, i.subtotalIva, i.subtotalBruto].join("|")).join("\n"),
    alicuotas: c.alicuotas.map((a) => [a.alicuotaPct, a.codigoArca, a.baseImponible, a.importe].join("|")).join("\n"),
    importes: `${c.importeNeto} ${c.importeIva} ${c.importeTotal}`,
    emisor: [c.emisorRazonSocial, c.emisorCuit, c.emisorCondicionIva, c.emisorDomicilio, iso(c.emisorInicioActividades), c.emisorIibb].join("|"),
    receptor: [c.receptorNombre, c.receptorDocTipo, c.receptorDocNro, c.receptorCondicionIva, c.receptorDomicilio].join("|"),
  };
}

const TRES_ARTICULOS = (t: Awaited<ReturnType<typeof preparar>>) => [
  { articuloId: t.x.id, cantidad: 2 },
  { articuloId: t.y.id, cantidad: 3 },
  { articuloId: t.z.id, cantidad: 2 },
];

async function main() {
  const antes = await contarTodo(prisma);

  await escenario("Factura B: no se anula sin nota de crédito; con ella sí", async (tx) => {
    const t = await preparar(tx, "Prueba NC");
    const usuario = await usuarioDePrueba(tx);
    const v = await venta(tx, t.final.id, TRES_ARTICULOS(t));
    comprobar("sin factura: no hay factura para anular", String(await facturaAnulableDeVenta(tx, v)), "null");
    const fac = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
    comprobar("factura emitida", `${fac.estado} ${fac.tipo} ${fac.numero}`, "EMITIDO FACTURA_B 1");
    const anulable = await facturaAnulableDeVenta(tx, v);
    comprobar("la factura emitida es anulable", `${anulable?.id === fac.id} ${anulable?.etiqueta}`, `true Factura B ${PV}-00000001`);

    await rechaza(
      "anular la venta facturada: mensaje claro con el número",
      `La venta tiene la Factura B ${PV}-00000001: primero hay que emitir la nota de crédito.`,
      () => anularVentaEnTx(tx, v),
    );
    comprobar("la venta sigue sin anular", (await tx.venta.findUniqueOrThrow({ where: { id: v } })).estado, "PENDIENTE");

    const capturadas: SolicitudCae[] = [];
    const emisor = simulado(tx, { rechazar: (s) => (capturadas.push(s), null) });
    const nc = await emitirNotaCreditoEnTx(tx, v, usuario.id, { emisor, facturaId: fac.id });
    comprobar("NC emitida", `${nc.estado} ${nc.tipo} ${nc.puntoVenta}-${nc.numero}`, `EMITIDO NOTA_CREDITO_B ${PV}-1`);
    comprobar("CAE de 14 dígitos", String(/^\d{14}$/.test(nc.cae ?? "")), "true");
    comprobar("mensaje", nc.mensaje.startsWith(`Nota de crédito B ${PV}-00000001 emitida (CAE `) ? "ok" : nc.mensaje, "ok");

    const sol = capturadas[0]!;
    comprobar("al emisor: tipo y código ARCA", `${sol.tipo} ${sol.codigoArca}`, "NOTA_CREDITO_B 8");
    comprobar(
      "al emisor: comprobante asociado",
      JSON.stringify(sol.comprobanteAsociado),
      JSON.stringify({ tipo: "FACTURA_B", codigoArca: 6, puntoVenta: PV, numero: 1 }),
    );
    comprobar("al emisor: fecha de hoy", iso(sol.fecha), iso(HOY));
    comprobar("al emisor: CUIT de la factura", sol.cuitEmisor, CUIT_EMISOR);
    comprobar("al emisor: importes", `${sol.importes.total} ${sol.importes.neto} ${sol.importes.iva} ${sol.importes.alicuotas.length}`, "3751.5 3300 451.5 3");

    const a = await detalle(tx, fac.id);
    const b = await detalle(tx, nc.id);
    comprobar("asociada a la factura", String(b.c.comprobanteAsociadoId === fac.id), "true");
    comprobar("misma venta, ambiente y punto de venta", `${b.c.ventaId === v} ${b.c.ambiente} ${b.c.puntoVenta}`, `true SIMULADO ${PV}`);
    comprobar("código ARCA 8 (NC B)", String(b.c.codigoArca), "8");
    comprobar("fecha: hoy en Argentina", iso(b.c.fecha), iso(HOY));
    comprobar("usuario que la emitió", String(b.c.usuarioId === usuario.id), "true");
    comprobar("importes iguales a la factura", b.importes, a.importes);
    comprobar("tres líneas iguales", String(b.c.items.length), "3");
    comprobar("líneas iguales a la factura", b.items, a.items);
    comprobar("alícuotas iguales a la factura", b.alicuotas, a.alicuotas);
    comprobar("emisor igual a la factura", b.emisor, a.emisor);
    comprobar("receptor igual a la factura", b.receptor, a.receptor);
    comprobar("la factura no cambió", (await tx.comprobante.findUniqueOrThrow({ where: { id: fac.id } })).estado, "EMITIDO");

    comprobar("ya no hay factura para anular", String(await facturaAnulableDeVenta(tx, v)), "null");
    await rechaza("segunda NC de la misma factura", `La Factura B ${PV}-00000001 ya está anulada por la Nota de crédito B ${PV}-00000001.`, () =>
      emitirNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx) }),
    );
    comprobar("una sola NC", String(await tx.comprobante.count({ where: { comprobanteAsociadoId: fac.id } })), "1");

    await anularVentaEnTx(tx, v, usuario.id);
    comprobar("con la NC EMITIDA, la venta se anula", (await tx.venta.findUniqueOrThrow({ where: { id: v } })).estado, "ANULADA");

    // La serie de NC es propia: la segunda venta lleva factura 2 y NC 2.
    const v2 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const fac2 = await emitirFacturaEnTx(tx, v2, null, { emisor: simulado(tx) });
    const nc2 = await emitirNotaCreditoEnTx(tx, v2, null, { emisor: simulado(tx) });
    comprobar("segunda venta: factura 2 y NC 2", `${fac2.numero} ${nc2.numero}`, "2 2");
    comprobar("NC sin usuario: queda null", String((await tx.comprobante.findUniqueOrThrow({ where: { id: nc2.id } })).usuarioId), "null");
  });

  await escenario("Letra y asociación: A, B y C", async (tx) => {
    const t = await preparar(tx, "Prueba NC letras");
    const casos: { nombre: string; clienteId: string; esperada: string; arca: number; asociada: string }[] = [
      { nombre: "A (responsable inscripto con CUIT)", clienteId: t.ri.id, esperada: "NOTA_CREDITO_A", arca: 3, asociada: "FACTURA_A" },
      { nombre: "B (consumidor final)", clienteId: t.final.id, esperada: "NOTA_CREDITO_B", arca: 8, asociada: "FACTURA_B" },
    ];
    for (const caso of casos) {
      const v = await venta(tx, caso.clienteId, [{ articuloId: t.x.id, cantidad: 1 }]);
      const fac = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
      const capturadas: SolicitudCae[] = [];
      const nc = await emitirNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx, { rechazar: (s) => (capturadas.push(s), null) }) });
      const c = await tx.comprobante.findUniqueOrThrow({ where: { id: nc.id }, include: { comprobanteAsociado: true } });
      comprobar(`${caso.nombre}: tipo de la factura`, fac.tipo, caso.asociada);
      comprobar(`${caso.nombre}: tipo y código de la NC`, `${c.tipo} ${c.codigoArca} ${c.estado}`, `${caso.esperada} ${caso.arca} EMITIDO`);
      comprobar(`${caso.nombre}: asociada a su factura`, `${c.comprobanteAsociado?.id === fac.id} ${c.comprobanteAsociado?.tipo}`, `true ${caso.asociada}`);
      comprobar(`${caso.nombre}: documento del receptor`, `${c.receptorDocTipo} ${c.receptorDocNro}`, caso.esperada === "NOTA_CREDITO_A" ? `80 ${CUIT_RI}` : "99 0");
      comprobar(
        `${caso.nombre}: al emisor, el código de la factura asociada`,
        String(capturadas[0]!.comprobanteAsociado?.codigoArca),
        String(caso.esperada === "NOTA_CREDITO_A" ? 1 : 6),
      );
    }

    // C: emisor monotributista, articulos con IVA 0.
    await configurarFiscal(tx, { condicionIva: "MONOTRIBUTO", puntoVenta: String(PV + 1) });
    const v = await venta(tx, t.final.id, [{ articuloId: t.z.id, cantidad: 3 }]);
    const fac = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
    const nc = await emitirNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx) });
    const { c } = await detalle(tx, nc.id);
    comprobar("C: la factura", fac.tipo, "FACTURA_C");
    comprobar("C: la NC", `${c.tipo} ${c.codigoArca} ${c.estado} ${c.emisorCondicionIva}`, "NOTA_CREDITO_C 13 EMITIDO MONOTRIBUTO");
    comprobar("C: importes (sin IVA) y sin alícuotas", `${c.importeNeto} ${c.importeIva} ${c.importeTotal} ${c.alicuotas.length}`, "1500 0 1500 0");
    comprobar("C: asociada a la factura C", String(c.comprobanteAsociadoId === fac.id), "true");
  });

  await escenario("La NC copia la foto de la factura, no la configuración ni el cliente de hoy", async (tx) => {
    const t = await preparar(tx, "Prueba NC foto");
    const v = await venta(tx, t.final.id, TRES_ARTICULOS(t));
    const fac = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
    const antes = await detalle(tx, fac.id);

    // Se edita TODO: el cliente (hasta su condición y CUIT), los articulos y la configuracion fiscal.
    await tx.cliente.update({
      where: { id: t.final.id },
      data: { nombre: "Otro nombre", cuit: cuitCon("3099999999"), condicionIva: "RESPONSABLE_INSCRIPTO", direccion: "Otra dirección 999" },
    });
    await tx.articulo.update({ where: { id: t.x.id }, data: { nombre: "Otro artículo", precioVenta: d(9999), ivaPct: d(27) } });
    await configurarFiscal(tx, {
      razonSocial: "Razón social nueva",
      cuit: cuitCon("2044444444"),
      condicionIva: "MONOTRIBUTO",
      domicilio: "Domicilio nuevo 1",
      inicioActividades: "2024-05-05",
      iibb: "",
      puntoVenta: "77",
    });

    const nc = await emitirNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx) });
    const despues = await detalle(tx, nc.id);
    comprobar("sigue siendo NC B (letra de la factura, no de la configuración de hoy)", despues.c.tipo, "NOTA_CREDITO_B");
    comprobar("mismo punto de venta que la factura (no el 77 de hoy)", String(despues.c.puntoVenta), String(PV));
    comprobar("emisor: el de la factura", despues.emisor, antes.emisor);
    comprobar("receptor: el de la factura", despues.receptor, antes.receptor);
    comprobar("líneas: las de la factura", despues.items, antes.items);
    comprobar("alícuotas: las de la factura", despues.alicuotas, antes.alicuotas);
    comprobar("importes: los de la factura", despues.importes, antes.importes);
    comprobar("el emisor de la NC no tiene la razón social nueva", String(despues.emisor.includes("Razón social nueva")), "false");
  });

  await escenario("Rechazo del emisor y corte: no se pierde el número", async (tx) => {
    const t = await preparar(tx, "Prueba NC rechazo");
    const v = await venta(tx, t.final.id, TRES_ARTICULOS(t));
    const fac = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });

    const rech = await emitirNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx, { rechazar: () => ["[10016] prueba"] }) });
    comprobar("rechazada: estado y número intentado", `${rech.estado} ${rech.numero}`, "RECHAZADO 1");
    comprobar("rechazada: mensaje con el motivo", rech.mensaje.includes("[10016] prueba") ? "ok" : rech.mensaje, "ok");
    const guardada = await tx.comprobante.findUniqueOrThrow({ where: { id: rech.id } });
    comprobar("rechazada: guardada con sus observaciones", `${guardada.estado} ${guardada.observaciones}`, "RECHAZADO [10016] prueba");
    comprobar("rechazada: no es vigente, la factura sigue anulable", String((await facturaAnulableDeVenta(tx, v))?.id === fac.id), "true");
    await rechaza("rechazada: la venta sigue sin poder anularse", "primero hay que emitir la nota de crédito", () => anularVentaEnTx(tx, v));

    const bien = await emitirNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx) });
    comprobar("reintento: EMITIDO con el mismo número", `${bien.estado} ${bien.numero}`, "EMITIDO 1");
    comprobar("quedan dos filas (el intento y la emitida)", String(await tx.comprobante.count({ where: { comprobanteAsociadoId: fac.id } })), "2");
    await anularVentaEnTx(tx, v);

    // Corte: el emisor no responde.
    const v2 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const fac2 = await emitirFacturaEnTx(tx, v2, null, { emisor: simulado(tx) });
    const corte = await emitirNotaCreditoEnTx(tx, v2, null, { emisor: simulado(tx, { cortar: () => true }) });
    comprobar("corte: queda PENDIENTE con su número", `${corte.estado} ${corte.numero}`, "PENDIENTE 2");
    comprobar("corte: mensaje", corte.mensaje.includes("quedó pendiente") ? "ok" : corte.mensaje, "ok");
    comprobar("corte: ya no ofrece otra NC", String(await facturaAnulableDeVenta(tx, v2)), "null");
    await rechaza("corte: otro pedido de la misma factura", `La Factura B ${PV}-00000002 ya tiene la Nota de crédito B ${PV}-00000002 esperando respuesta`, () =>
      emitirNotaCreditoEnTx(tx, v2, null, { emisor: simulado(tx) }),
    );
    await rechaza("corte: no se anula la venta (mensaje claro, sin error crudo)", "su nota de crédito está esperando respuesta del emisor", () =>
      anularVentaEnTx(tx, v2),
    );
    // Otra venta de la serie, con el PENDIENTE: espera.
    const v3 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await emitirFacturaEnTx(tx, v3, null, { emisor: simulado(tx) });
    await rechaza("corte: otra NC de la serie espera la respuesta", `Hay otra Nota de crédito B ${PV}-00000002 esperando respuesta`, () =>
      emitirNotaCreditoEnTx(tx, v3, null, { emisor: simulado(tx) }),
    );
    comprobar("(la factura 2 sigue EMITIDA)", (await tx.comprobante.findUniqueOrThrow({ where: { id: fac2.id } })).estado, "EMITIDO");
  });

  await escenario("Sin factura, factura pendiente, otra factura u otro ambiente: error claro", async (tx) => {
    const t = await preparar(tx, "Prueba NC errores");
    const sinFactura = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await rechaza("venta sin factura", "La venta no tiene una factura emitida: no hay nada que anular con una nota de crédito.", () =>
      emitirNotaCreditoEnTx(tx, sinFactura, null, { emisor: simulado(tx) }),
    );
    await rechaza("venta inexistente", "La venta no existe.", () => emitirNotaCreditoEnTx(tx, "00000000-0000-4000-8000-000000000000", null, { emisor: simulado(tx) }));
    comprobar("venta sin factura: nada que mostrar", String(await facturaAnulableDeVenta(tx, sinFactura)), "null");
    await anularVentaEnTx(tx, sinFactura);
    comprobar("venta sin factura: se anula sin NC", (await tx.venta.findUniqueOrThrow({ where: { id: sinFactura } })).estado, "ANULADA");

    // Factura RECHAZADA: como si no hubiera factura (y la venta se anula sin NC).
    const rech = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const fr = await emitirFacturaEnTx(tx, rech, null, { emisor: simulado(tx, { rechazar: () => ["[10048] prueba"] }) });
    comprobar("(factura rechazada)", fr.estado, "RECHAZADO");
    await rechaza("factura RECHAZADA: no hay factura emitida", "no tiene una factura emitida", () => emitirNotaCreditoEnTx(tx, rech, null, { emisor: simulado(tx) }));

    // La factura que vio la persona no es la vigente.
    const v = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
    await rechaza("otra factura distinta de la que se vio", "La factura de la venta cambió mientras tanto", () =>
      emitirNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx), facturaId: "00000000-0000-4000-8000-000000000000" }),
    );
    comprobar("(sin NC creada por el error)", String(await tx.comprobante.count({ where: { ventaId: v, tipo: "NOTA_CREDITO_B" } })), "0");

    // Otro ambiente: la NC tiene que salir por el mismo ambiente que la factura.
    const otroAmbiente: EmisorFiscal = { ...simulado(tx), ambiente: "HOMOLOGACION" };
    await rechaza("emisor de otro ambiente", "La factura es del ambiente SIMULADO y el emisor configurado es HOMOLOGACION", () =>
      reservarNotaCreditoEnTx(tx, v, null, { emisor: otroAmbiente }),
    );
    try {
      await emitirNotaCreditoEnTx(tx, v, null, { emisor: otroAmbiente });
      comprobar("emitirNotaCreditoEnTx solo con el simulado", "no lanzó error", "error");
    } catch (error) {
      comprobar("emitirNotaCreditoEnTx solo con el simulado", String(error instanceof Error && error.message.includes("solo para el emisor simulado")), "true");
    }
    // reservar directo (como la fase 1): vale lo mismo.
    const reserva = await reservarNotaCreditoEnTx(tx, v, null, { emisor: simulado(tx) });
    comprobar("la reserva deja la NC PENDIENTE con su número", `${reserva.tipo} ${reserva.numero}`, "NOTA_CREDITO_B 1");
    comprobar(
      "la reserva está PENDIENTE y sin CAE",
      JSON.stringify(await tx.comprobante.findUniqueOrThrow({ where: { id: reserva.comprobanteId }, select: { estado: true, cae: true } })),
      JSON.stringify({ estado: "PENDIENTE", cae: null }),
    );

    // Factura PENDIENTE (el emisor no respondio): no hay NC posible ni se anula la venta.
    const pend = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await emitirFacturaEnTx(tx, pend, null, { emisor: simulado(tx, { cortar: () => true }) });
    await rechaza("factura PENDIENTE: no se hace NC", `La Factura B ${PV}-00000002 está esperando respuesta del emisor`, () =>
      emitirNotaCreditoEnTx(tx, pend, null, { emisor: simulado(tx) }),
    );
    await rechaza("factura PENDIENTE: no se anula la venta (mensaje claro)", `La venta tiene la Factura B ${PV}-00000002 esperando respuesta del emisor`, () =>
      anularVentaEnTx(tx, pend),
    );
    comprobar("factura PENDIENTE: nada que mostrar", String(await facturaAnulableDeVenta(tx, pend)), "null");
  });

  await parteReal();

  const despues = await contarTodo(prisma);
  comprobar("la base quedó como estaba (sin rastro)", JSON.stringify(despues), JSON.stringify(antes));

  await prisma.$disconnect();
  await prismaDeLaApp.$disconnect();
  if (fallos > 0) {
    console.log(`\n${fallos} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("\nTodo OK.");
}

type Cuentas = Record<string, number | string>;
async function contarTodo(cliente: PrismaClient): Promise<Cuentas> {
  const [comprobantes, items, alicuotas, ventas, ventaItems, clientes, articulos, usuarios, sesiones, config] = await Promise.all([
    cliente.comprobante.count(),
    cliente.comprobanteItem.count(),
    cliente.comprobanteIva.count(),
    cliente.venta.count(),
    cliente.ventaItem.count(),
    cliente.cliente.count(),
    cliente.articulo.count(),
    cliente.usuario.count(),
    cliente.sesion.count(),
    cliente.configuracion.findMany({ orderBy: { clave: "asc" } }),
  ]);
  return {
    comprobantes,
    items,
    alicuotas,
    ventas,
    ventaItems,
    clientes,
    articulos,
    usuarios,
    sesiones,
    configuracion: JSON.stringify(config.map((c) => [c.clave, c.valor])),
  };
}

// ─── Parte real: transacciones confirmadas ────────────────────────────────────

const ANIO_FICTICIO = f("2099-06-15");
const PREFIJO = "ZZ prueba notas de credito";
let configuracionOriginal: { clave: string; valor: string }[] | null = null;

/** Borra lo que crea la parte real y restaura la configuracion fiscal. */
async function limpiarReal() {
  const clientes = await prisma.cliente.findMany({ where: { nombre: { startsWith: PREFIJO } }, select: { id: true } });
  const clienteIds = clientes.map((c) => c.id);
  const ventas = await prisma.venta.findMany({ where: { clienteId: { in: clienteIds } }, select: { id: true } });
  const ventaIds = ventas.map((v) => v.id);
  await prisma.comprobante.deleteMany({ where: { ventaId: { in: ventaIds }, comprobanteAsociadoId: { not: null } } });
  await prisma.comprobante.deleteMany({ where: { ventaId: { in: ventaIds } } });
  await prisma.movimientoStock.deleteMany({ where: { ventaId: { in: ventaIds } } });
  await prisma.pago.deleteMany({ where: { ventaId: { in: ventaIds } } });
  await prisma.venta.deleteMany({ where: { id: { in: ventaIds } } });
  await prisma.articulo.deleteMany({ where: { nombre: { startsWith: PREFIJO } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clienteIds } } });
  const usuarios = await prisma.usuario.findMany({ where: { usuario: { startsWith: "zz-nc-" } }, select: { id: true } });
  await prisma.sesion.deleteMany({ where: { usuarioId: { in: usuarios.map((u) => u.id) } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios.map((u) => u.id) } } });
  if (configuracionOriginal) {
    await prisma.configuracion.deleteMany({ where: { clave: { startsWith: "fiscal" } } });
    for (const c of configuracionOriginal) await prisma.configuracion.create({ data: c });
  }
}

async function parteReal() {
  console.log("--- Transacciones reales (ventas de 2099, se limpia al terminar) ---");
  const b = nuevoCliente();
  configuracionOriginal = await prisma.configuracion.findMany({ where: { clave: { startsWith: "fiscal" } } });
  try {
    await limpiarReal(); // restos de una corrida interrumpida
    const t = await preparar(prisma, PREFIJO, PV_REAL);
    const cliente = t.final;
    const emisorGlobal = crearEmisorSimulado(accesoSimulado(prisma));
    const emisorDeB = crearEmisorSimulado(accesoSimulado(b));

    const nuevaVenta = () => prisma.$transaction((tx) => venta(tx, cliente.id, [{ articuloId: t.x.id, cantidad: 1 }], ANIO_FICTICIO));
    /** Una venta ya facturada (EMITIDO), con la transaccion confirmada. */
    const ventaFacturada = async () => {
      const v = await nuevaVenta();
      const fac = await emitirFactura(prisma, v, null, { emisor: emisorGlobal });
      if (fac.estado !== "EMITIDO") throw new Error(`No se pudo preparar la factura: ${fac.mensaje}`);
      return { v, fac };
    };
    const ncVigentes = (ventaId: string) =>
      prisma.comprobante.count({ where: { ventaId, tipo: "NOTA_CREDITO_B", estado: { in: ["PENDIENTE", "EMITIDO"] } } });

    // 1. Una sola transaccion (simulador): cuatro pedidos simultaneos de la misma venta.
    for (const ronda of [1, 2, 3]) {
      const { v } = await ventaFacturada();
      const intento = (db: PrismaClient) =>
        db.$transaction((tx) => emitirNotaCreditoEnTx(tx, v, null, { emisor: crearEmisorSimulado(accesoSimulado(tx)) }), { timeout: 30_000 });
      const res = await Promise.allSettled([intento(prisma), intento(b), intento(prisma), intento(b)]);
      const ok = res.filter((r) => r.status === "fulfilled");
      const malos = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      comprobar(`misma factura, una transacción (${ronda}): una sola NC emitida`, String(ok.length), "1");
      comprobar(
        `misma factura, una transacción (${ronda}): las otras con error claro`,
        String(malos.length === 3 && malos.every((r) => r.reason instanceof ErrorDeNegocio && r.reason.message.includes("ya está anulada por la Nota de crédito B"))),
        "true",
      );
      comprobar(`misma factura, una transacción (${ronda}): una NC vigente`, String(await ncVigentes(v)), "1");
    }

    // 2. Dos fases: dos pedidos simultaneos de la misma venta.
    for (const ronda of [1, 2, 3]) {
      const { v } = await ventaFacturada();
      const res = await Promise.allSettled([
        emitirNotaCredito(prisma, v, null, { emisor: emisorGlobal }),
        emitirNotaCredito(b, v, null, { emisor: emisorDeB }),
      ]);
      const ok = res.filter((r): r is PromiseFulfilledResult<ComprobanteProcesado> => r.status === "fulfilled");
      const malos = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      comprobar(`misma factura, dos fases (${ronda}): una sola NC emitida`, ok.map((r) => r.value.estado).join(","), "EMITIDO");
      comprobar(
        `misma factura, dos fases (${ronda}): la otra con error claro`,
        String(
          malos.length === 1 &&
            malos[0]!.reason instanceof ErrorDeNegocio &&
            /ya está anulada por|esperando respuesta del emisor/.test(malos[0]!.reason.message),
        ),
        "true",
      );
      comprobar(`misma factura, dos fases (${ronda}): una NC vigente`, String(await ncVigentes(v)), "1");
    }

    // 3. Ventas distintas a la vez, en una sola transaccion: esperan el lock y numeran sin huecos.
    const facturadas = [];
    for (let k = 0; k < 5; k++) facturadas.push(await ventaFacturada());
    const emitidas = await Promise.all(
      facturadas.map(({ v }, k) =>
        (k % 2 ? b : prisma).$transaction((tx) => emitirNotaCreditoEnTx(tx, v, null, { emisor: crearEmisorSimulado(accesoSimulado(tx)) }), { timeout: 30_000 }),
      ),
    );
    comprobar("ventas distintas a la vez: todas emitidas", emitidas.map((e) => e.estado).join(","), "EMITIDO,EMITIDO,EMITIDO,EMITIDO,EMITIDO");
    const numeros = (
      await prisma.comprobante.findMany({
        where: { puntoVenta: PV_REAL, ambiente: "SIMULADO", tipo: "NOTA_CREDITO_B", estado: "EMITIDO" },
        select: { numero: true },
      })
    )
      .map((c) => c.numero)
      .sort((p, q) => p - q);
    comprobar("numeración de las NC sin repetidos ni huecos", numeros.join(","), Array.from({ length: numeros.length }, (_, k) => k + 1).join(","));

    // 4. Dos fases con ventas distintas a la vez: cada pedido emite o espera con un mensaje claro; sin huecos ni repetidos.
    const otras = [];
    for (let k = 0; k < 4; k++) otras.push(await ventaFacturada());
    const res4 = await Promise.allSettled(
      otras.map(({ v }, k) => (k % 2 ? emitirNotaCredito(b, v, null, { emisor: emisorDeB }) : emitirNotaCredito(prisma, v, null, { emisor: emisorGlobal }))),
    );
    comprobar(
      "dos fases, ventas distintas: emite o espera con mensaje claro (nunca un error crudo)",
      String(res4.every((r) => r.status === "fulfilled" || (r.reason instanceof ErrorDeNegocio && /esperando respuesta|otra persona/i.test(r.reason.message)))),
      "true",
    );
    comprobar("dos fases, ventas distintas: al menos una emitida", String(res4.some((r) => r.status === "fulfilled" && r.value.estado === "EMITIDO")), "true");
    const todas = (
      await prisma.comprobante.findMany({
        where: { puntoVenta: PV_REAL, ambiente: "SIMULADO", tipo: "NOTA_CREDITO_B", estado: "EMITIDO" },
        select: { numero: true },
      })
    )
      .map((c) => c.numero)
      .sort((p, q) => p - q);
    comprobar("  numeración final sin repetidos ni huecos", todas.join(","), Array.from({ length: todas.length }, (_, k) => k + 1).join(","));
    // Las que esperaron se reintentan y salen.
    for (const [k, r] of res4.entries()) {
      if (r.status === "rejected") {
        const rr = await emitirNotaCredito(prisma, otras[k]!.v, null, { emisor: emisorGlobal });
        comprobar(`  reintento de la que esperó (${k + 1})`, rr.estado, "EMITIDO");
      }
    }

    // 5. Corte en dos fases: el PENDIENTE sobrevive (esta confirmado) y se resuelve despues.
    const { v: vCorte } = await ventaFacturada();
    const cortado = await emitirNotaCredito(prisma, vCorte, null, { emisor: crearEmisorSimulado(accesoSimulado(prisma), { cortar: () => true }) });
    comprobar("corte: queda PENDIENTE", cortado.estado, "PENDIENTE");
    const guardado = await prisma.comprobante.findUniqueOrThrow({ where: { id: cortado.id } });
    comprobar("corte: el PENDIENTE quedó confirmado con su número", `${guardado.estado} ${guardado.tipo} ${guardado.numero}`, `PENDIENTE NOTA_CREDITO_B ${numeros.length + otras.length + 1}`);
    await rechaza("corte: no se anula la venta", "esperando respuesta del emisor", () => prisma.$transaction((tx) => anularVentaEnTx(tx, vCorte)));
    await rechaza("corte: no se vuelve a pedir la NC", "esperando respuesta del emisor", () => emitirNotaCredito(prisma, vCorte, null, { emisor: emisorGlobal }));
    await rechaza("resolver un PENDIENTE recién creado: todavía no", "probá en unos minutos", () => resolverPendiente(prisma, cortado.id, emisorGlobal));
    const mas = new Date(guardado.creadoEn.getTime() + ANTIGUEDAD_MINIMA_PENDIENTE_MS + 1000);
    const resuelto = await resolverPendiente(prisma, cortado.id, emisorGlobal, mas);
    comprobar("resolver: el simulador no la autorizó → RECHAZADO", `${resuelto.estado} ${resuelto.numero}`, `RECHAZADO ${guardado.numero}`);
    const otraVez = await emitirNotaCredito(prisma, vCorte, null, { emisor: emisorGlobal });
    comprobar("reintento: EMITIDO con el mismo número", `${otraVez.estado} ${otraVez.numero}`, `EMITIDO ${guardado.numero}`);

    // 6. Rechazo en dos fases: queda RECHAZADO, confirmado.
    const { v: vRech } = await ventaFacturada();
    const rech = await emitirNotaCredito(prisma, vRech, null, { emisor: crearEmisorSimulado(accesoSimulado(prisma), { rechazar: () => ["[10016] prueba"] }) });
    comprobar("rechazo en dos fases: RECHAZADO confirmado", (await prisma.comprobante.findUniqueOrThrow({ where: { id: rech.id } })).estado, "RECHAZADO");
    await rechaza("rechazo: la venta sigue sin poder anularse", "primero hay que emitir la nota de crédito", () => prisma.$transaction((tx) => anularVentaEnTx(tx, vRech)));

    // 7. Anulacion confirmada: sin NC no; con NC si.
    const { v: vAnular } = await ventaFacturada();
    await rechaza("venta facturada confirmada: no se anula sin NC", "primero hay que emitir la nota de crédito", () => prisma.$transaction((tx) => anularVentaEnTx(tx, vAnular)));
    await emitirNotaCredito(prisma, vAnular, null, { emisor: emisorGlobal });
    await prisma.$transaction((tx) => anularVentaEnTx(tx, vAnular));
    comprobar("con la NC emitida: la venta se anula", (await prisma.venta.findUniqueOrThrow({ where: { id: vAnular } })).estado, "ANULADA");

    // 8. La server action REAL, con sesiones reales.
    console.log("  Server action emitirNotaCredito (real, con sesión)");
    const CLAVE = "clave-de-prueba-123";
    const emp = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `zz-nc-emp-${randomBytes(3).toString("hex")}`, nombre: "Empleado de prueba", rol: "EMPLEADO", clave: CLAVE }));
    const due = await prisma.$transaction((tx) => crearUsuarioEnTx(tx, { usuario: `zz-nc-due-${randomBytes(3).toString("hex")}`, nombre: "Dueño de prueba", rol: "DUENO", clave: CLAVE }));
    const tEmp = (await crearSesion(prisma, emp.id)).token;
    const tDue = (await crearSesion(prisma, due.id)).token;
    const invocar = async (token: string | undefined, datos: unknown) => {
      cookieActual = token;
      try {
        return (await accionesDeVenta.emitirNotaCredito(datos as never)) as { ok: boolean; error?: string; estado?: string; mensaje?: string };
      } catch (error) {
        return { ok: false, error: `LANZÓ: ${error instanceof Error ? error.message : String(error)}` };
      } finally {
        cookieActual = undefined;
      }
    };

    const { v: vAccion, fac: facAccion } = await ventaFacturada();
    const datos = { ventaId: vAccion, comprobanteId: facAccion.id };
    const ncDeAccion = () => prisma.comprobante.count({ where: { ventaId: vAccion, tipo: "NOTA_CREDITO_B" } });

    const rEmp = await invocar(tEmp, datos);
    comprobar("empleado: no puede (permiso)", `${rEmp.ok} ${rEmp.error?.startsWith("No tenés permiso")}`, "false true");
    comprobar("empleado: con datos basura, también el error de permiso (antes de validar)", String((await invocar(tEmp, { ventaId: "x" })).error?.startsWith("No tenés permiso")), "true");
    const rSin = await invocar(undefined, datos);
    comprobar("sin sesión: no puede", `${rSin.ok} ${/sesión|permiso/i.test(rSin.error ?? "")}`, "false true");
    comprobar("empleado y sin sesión: no se creó ninguna NC", String(await ncDeAccion()), "0");

    comprobar("dueño: ventaId inválido", (await invocar(tDue, { ventaId: "x", comprobanteId: facAccion.id })).error ?? "", "Venta inválida");
    comprobar("dueño: comprobanteId inválido", (await invocar(tDue, { ventaId: vAccion, comprobanteId: "x" })).error ?? "", "Comprobante inválido");
    const rOtra = await invocar(tDue, { ventaId: vAccion, comprobanteId: "00000000-0000-4000-8000-000000000000" });
    comprobar("dueño: otra factura distinta de la vista", String(rOtra.error?.includes("cambió mientras tanto")), "true");

    // Con produccion y sin PERMITIR_EMISOR_SIMULADO, facturar (y anular facturas) queda deshabilitado.
    const entorno = process.env as Record<string, string | undefined>;
    const nodeEnvOriginal = entorno.NODE_ENV;
    const permitirOriginal = entorno.PERMITIR_EMISOR_SIMULADO;
    entorno.NODE_ENV = "production";
    delete entorno.PERMITIR_EMISOR_SIMULADO;
    const rProd = await invocar(tDue, datos);
    entorno.NODE_ENV = nodeEnvOriginal;
    if (permitirOriginal !== undefined) entorno.PERMITIR_EMISOR_SIMULADO = permitirOriginal;
    comprobar("dueño en producción sin permiso del simulador: facturación deshabilitada", `${rProd.ok} ${rProd.error?.startsWith("Facturación deshabilitada")}`, "false true");
    comprobar("  (no se creó ninguna NC)", String(await ncDeAccion()), "0");

    const rDue = await invocar(tDue, datos);
    comprobar("dueño: emite la nota de crédito", `${rDue.ok} ${rDue.estado}`, "true EMITIDO");
    comprobar("dueño: mensaje", String(rDue.mensaje?.startsWith(`Nota de crédito B ${PV_REAL}-`)), "true");
    const ncAccion = await prisma.comprobante.findFirstOrThrow({ where: { ventaId: vAccion, tipo: "NOTA_CREDITO_B" } });
    comprobar("dueño: asociada a la factura y a su nombre", `${ncAccion.comprobanteAsociadoId === facAccion.id} ${ncAccion.usuarioId === due.id} ${ncAccion.estado}`, "true true EMITIDO");
    const rDos = await invocar(tDue, datos);
    comprobar("dueño: segunda vez, error claro", `${rDos.ok} ${rDos.error?.includes("ya está anulada por la Nota de crédito B")}`, "false true");
    comprobar("dueño: una sola NC", String(await ncDeAccion()), "1");
    const rAnular = (await (async () => {
      cookieActual = tDue;
      try {
        return await accionesDeVenta.anularVenta({ ventaId: vAccion });
      } finally {
        cookieActual = undefined;
      }
    })()) as { ok: boolean; error?: string };
    comprobar("dueño: con la NC, la acción anularVenta anula la venta", String(rAnular.ok), "true");

    // La accion de anular una venta facturada sin NC muestra el mensaje claro.
    const { v: vSinNc, fac: facSinNc } = await ventaFacturada();
    cookieActual = tDue;
    const rSinNc = (await accionesDeVenta.anularVenta({ ventaId: vSinNc })) as { ok: boolean; error?: string };
    cookieActual = undefined;
    comprobar(
      "acción anularVenta de una venta facturada sin NC: el mensaje claro",
      `${rSinNc.ok} ${rSinNc.error}`,
      `false La venta tiene la Factura B ${PV_REAL}-${String(facSinNc.numero).padStart(8, "0")}: primero hay que emitir la nota de crédito.`,
    );
  } catch (error) {
    fallos += 1;
    console.log("FALLA error inesperado en la parte real:", error);
  } finally {
    await limpiarReal();
    await b.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await limpiarReal();
  } catch {
    // nada mas que hacer
  }
  await prisma.$disconnect();
  process.exit(1);
});
