/**
 * Prueba la facturacion POR NEGOCIO (multi-tenant F3.4) contra Postgres LOCAL, con el rol de la
 * app (`ventas_app`, sujeto a RLS) y el rol dueño (`ventas_migrador`) solo para sembrar y limpiar.
 *
 *   DATABASE_URL="postgresql://ventas_app:ventas_app@localhost:5477/ventas_vta12?host=/tmp/pgsock7" \
 *   DATABASE_URL_MIGRACIONES="postgresql://ventas_migrador:ventas_migrador@localhost:5477/ventas_vta12?host=/tmp/pgsock7" \
 *   npx tsx scripts/test-facturacion-negocios.ts
 *
 * Comprueba:
 *   - dos negocios emiten la factura B 0001-00000001 sin chocar, cada uno con su CUIT y su razon social
 *     (la foto del emisor sale de la Configuracion de CADA negocio) y cada uno sigue su numeracion;
 *   - lo mismo con las notas de credito (serie propia por negocio);
 *   - el candado de la serie es distinto por negocio, y un PENDIENTE de un negocio no frena al otro
 *     ("un pendiente por serie" es por negocio);
 *   - emisiones simultaneas: de dos negocios a la vez no se pisan; del mismo negocio no duplican numero;
 *   - un negocio no ve, no factura y no anula lo del otro (RLS + filtro explicito);
 *   - las lecturas (listado, detalle, estado de la venta) solo traen lo del negocio.
 * Limpia todo lo que siembra (comprobantes SIMULADO se pueden borrar) en un `finally`.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { ErrorDeNegocio, hoyArgentina } from "../src/lib/acciones";
import { digitoVerificadorCuit } from "../src/lib/cuit";
import { CLAVES_FISCALES } from "../src/lib/datos-fiscales";
import { registrarVentaEnTx } from "../src/lib/dominio/ventas";
import {
  accesoSimuladoDeNegocio,
  baseDeNegocio,
  claveLockSerie,
  emitirFactura,
  resolverPendiente,
} from "../src/lib/dominio/comprobantes";
import { emitirNotaCredito } from "../src/lib/dominio/notas-credito";
import { crearEmisorSimulado } from "../src/lib/fiscal/emisor-simulado";
import { conNegocio } from "../src/lib/negocio";
import { prisma as app } from "../src/lib/prisma";

let fallos = 0;
function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK   " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}
async function rechaza(etiqueta: string, fragmento: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "no lanzó error", `error "${fragmento}"`);
  } catch (error) {
    const ok = error instanceof ErrorDeNegocio && error.message.includes(fragmento);
    comprobar(etiqueta, ok ? "rechazada" : `${error instanceof Error ? error.message : String(error)}`, "rechazada");
  }
}

// ─── Solo local ──────────────────────────────────────────────────────────────
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

// ─── Datos ───────────────────────────────────────────────────────────────────
const HOY = hoyArgentina();
const cuitCon = (diez: string) => `${diez}${digitoVerificadorCuit(diez)}`;
const PV = 1;
const MARCA = `zz-f34-${randomBytes(3).toString("hex")}`;

type Neg = { id: string; slug: string; cuit: string; razon: string; cliente: string; articulo: string };

async function sembrarNegocio(letra: string, cuit: string): Promise<Neg> {
  const slug = `${MARCA}-${letra}`;
  const razon = `Negocio ${letra} S.R.L.`;
  const { id } = await admin.negocio.create({ data: { nombre: razon, slug }, select: { id: true } });
  const fiscal: Record<keyof typeof CLAVES_FISCALES, string> = {
    razonSocial: razon,
    cuit,
    condicionIva: "RESPONSABLE_INSCRIPTO",
    domicilio: `Calle ${letra} 123, Córdoba`,
    inicioActividades: "2020-03-02",
    iibb: "280-123456-7",
    puntoVenta: String(PV),
    umbralIdentificacion: "",
  };
  for (const [campo, valor] of Object.entries(fiscal) as [keyof typeof CLAVES_FISCALES, string][]) {
    if (valor !== "") await admin.configuracion.create({ data: { negocioId: id, clave: CLAVES_FISCALES[campo], valor } });
  }
  const articulo = await admin.articulo.create({
    data: { negocioId: id, nombre: `${MARCA} X`, precioVenta: d(1210), ivaPct: d(21), esServicio: true },
    select: { id: true },
  });
  const cliente = await admin.cliente.create({
    data: { negocioId: id, nombre: `${MARCA} consumidor final`, direccion: "Mostrador" },
    select: { id: true },
  });
  return { id, slug, cuit, razon, cliente: cliente.id, articulo: articulo.id };
}

/** Una venta nueva del negocio (la crea el dominio, como la app, parada en el negocio). */
async function nuevaVenta(n: Neg): Promise<string> {
  const v = await conNegocio(n.id, (tx) =>
    registrarVentaEnTx(tx, n.id, {
      clienteId: n.cliente,
      fecha: HOY,
      observaciones: null,
      entregada: false,
      items: [{ articuloId: n.articulo, cantidad: d(1) }],
      pago: null,
    }),
  );
  return v.id;
}

const emisorDe = (n: Neg, opciones?: Parameters<typeof crearEmisorSimulado>[1]) =>
  crearEmisorSimulado(accesoSimuladoDeNegocio(n.id), opciones);
const facturar = (n: Neg, ventaId: string, opciones?: Parameters<typeof crearEmisorSimulado>[1]) =>
  emitirFactura(baseDeNegocio(n.id), n.id, ventaId, null, { emisor: emisorDe(n, opciones) });
const nc = (n: Neg, ventaId: string, facturaId?: string) =>
  emitirNotaCredito(baseDeNegocio(n.id), n.id, ventaId, null, { emisor: emisorDe(n), facturaId });
const etiqueta = (c: { tipo: string; puntoVenta: number; numero: number }) =>
  `${c.tipo} ${String(c.puntoVenta).padStart(4, "0")}-${String(c.numero).padStart(8, "0")}`;

async function limpiar(negocios: Neg[]) {
  for (const n of negocios) {
    await admin.comprobante.deleteMany({ where: { negocioId: n.id, tipo: { in: ["NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"] } } });
    await admin.comprobante.deleteMany({ where: { negocioId: n.id } });
    await admin.pago.deleteMany({ where: { negocioId: n.id } });
    await admin.ventaItem.deleteMany({ where: { negocioId: n.id } });
    await admin.venta.deleteMany({ where: { negocioId: n.id } });
    await admin.articulo.deleteMany({ where: { negocioId: n.id } });
    await admin.cliente.deleteMany({ where: { negocioId: n.id } });
    await admin.configuracion.deleteMany({ where: { negocioId: n.id } });
    await admin.negocio.deleteMany({ where: { id: n.id } });
  }
}

async function main() {
  const rol = (await admin.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`)[0]!.u;
  const rolApp = (await conNegocio((await admin.negocio.findFirstOrThrow({ select: { id: true } })).id, (tx) => tx.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`))[0]!.u;
  comprobar("el sembrado corre con el dueño de las tablas", rol, "ventas_migrador");
  comprobar("la app corre con un rol sujeto a RLS", rolApp, "ventas_app");

  const A = await sembrarNegocio("A", cuitCon("2033333333"));
  const B = await sembrarNegocio("B", cuitCon("2044444444"));
  try {
    console.log("--- Dos negocios, la misma factura B 0001-00000001 ---");
    const vA1 = await nuevaVenta(A);
    const vB1 = await nuevaVenta(B);
    const fA1 = await facturar(A, vA1);
    const fB1 = await facturar(B, vB1);
    comprobar("A emite la primera", `${fA1.estado} ${etiqueta(fA1)}`, "EMITIDO FACTURA_B 0001-00000001");
    comprobar("B emite la misma sin chocar", `${fB1.estado} ${etiqueta(fB1)}`, "EMITIDO FACTURA_B 0001-00000001");
    const cA1 = await conNegocio(A.id, (tx) => tx.comprobante.findUniqueOrThrow({ where: { id: fA1.id } }));
    const cB1 = await conNegocio(B.id, (tx) => tx.comprobante.findUniqueOrThrow({ where: { id: fB1.id } }));
    comprobar("la foto de A lleva el CUIT y la razón social de A", `${cA1.emisorCuit} ${cA1.emisorRazonSocial}`, `${A.cuit} ${A.razon}`);
    comprobar("la foto de B lleva el CUIT y la razón social de B", `${cB1.emisorCuit} ${cB1.emisorRazonSocial}`, `${B.cuit} ${B.razon}`);
    comprobar("el CAE depende del CUIT: no coinciden", String(cA1.cae !== cB1.cae), "true");
    comprobar("cada comprobante es de su negocio", `${cA1.negocioId === A.id} ${cB1.negocioId === B.id}`, "true true");

    console.log("--- Cada negocio sigue su numeración ---");
    const fA2 = await facturar(A, await nuevaVenta(A));
    const fA3 = await facturar(A, await nuevaVenta(A));
    const fB2 = await facturar(B, await nuevaVenta(B));
    comprobar("A sigue en 2 y 3", `${fA2.numero},${fA3.numero}`, "2,3");
    comprobar("B sigue en 2 (no se entera de lo de A)", String(fB2.numero), "2");

    console.log("--- Notas de crédito: serie propia por negocio ---");
    const ncA = await nc(A, vA1, fA1.id);
    const ncB = await nc(B, vB1, fB1.id);
    comprobar("NC de A", `${ncA.estado} ${etiqueta(ncA)}`, "EMITIDO NOTA_CREDITO_B 0001-00000001");
    comprobar("NC de B, mismo número", `${ncB.estado} ${etiqueta(ncB)}`, "EMITIDO NOTA_CREDITO_B 0001-00000001");

    console.log("--- El candado y el pendiente son por negocio ---");
    comprobar(
      "la clave del candado difiere entre negocios",
      String(claveLockSerie(A.id, "SIMULADO", PV, "FACTURA_B") !== claveLockSerie(B.id, "SIMULADO", PV, "FACTURA_B")),
      "true",
    );
    const vCorteA = await nuevaVenta(A);
    const cortadoA = await facturar(A, vCorteA, { cortar: () => true });
    comprobar("corte en A: queda PENDIENTE con el 4", `${cortadoA.estado} ${cortadoA.numero}`, "PENDIENTE 4");
    const vOtraA = await nuevaVenta(A);
    await rechaza("A no emite otra en la serie con un PENDIENTE", "esperando respuesta del emisor", () => facturar(A, vOtraA));
    const fB3 = await facturar(B, await nuevaVenta(B));
    comprobar("B emite igual (el pendiente es de A)", `${fB3.estado} ${fB3.numero}`, "EMITIDO 3");
    const despues = new Date(Date.now() + 10 * 60_000);
    const resuelto = await resolverPendiente(baseDeNegocio(A.id), cortadoA.id, emisorDe(A), despues);
    comprobar("A resuelve su pendiente (no estaba autorizado)", resuelto.estado, "RECHAZADO");
    const fA4 = await facturar(A, vCorteA);
    comprobar("A reusa el número 4", `${fA4.estado} ${fA4.numero}`, "EMITIDO 4");

    console.log("--- Emisiones simultáneas ---");
    const ventasA = await Promise.all([1, 2, 3, 4].map(() => nuevaVenta(A)));
    const ventasB = await Promise.all([1, 2, 3, 4].map(() => nuevaVenta(B)));
    const resultados = await Promise.allSettled([
      ...ventasA.map((v) => facturar(A, v)),
      ...ventasB.map((v) => facturar(B, v)),
    ]);
    // Dentro de un negocio, las emisiones simultaneas se serializan: las que llegan con otra en
    // curso ven el PENDIENTE y se frenan con un mensaje claro (nunca un duplicado).
    const numeros = async (n: Neg) =>
      (
        await conNegocio(n.id, (tx) =>
          tx.comprobante.findMany({
            where: { negocioId: n.id, tipo: "FACTURA_B", estado: "EMITIDO" },
            select: { numero: true },
            orderBy: { numero: "asc" },
          }),
        )
      ).map((c) => c.numero);
    const nA = await numeros(A);
    const nB = await numeros(B);
    comprobar("A sin números repetidos ni huecos", String(nA.every((x, i) => x === i + 1)), "true");
    comprobar("B sin números repetidos ni huecos", String(nB.every((x, i) => x === i + 1)), "true");
    const rechazadas = resultados.filter((r) => r.status === "rejected");
    comprobar(
      "lo que no salió fue con error claro (no un error crudo)",
      String(rechazadas.every((r) => r.status === "rejected" && r.reason instanceof ErrorDeNegocio)),
      "true",
    );
    comprobar("se emitió al menos una por negocio", String(nA.length >= 5 && nB.length >= 4), "true");
    // Dos negocios A y B a la vez, una venta cada uno, SIN competir adentro: ninguno espera ni choca.
    const [vA, vB] = await Promise.all([nuevaVenta(A), nuevaVenta(B)]);
    const [rA, rB] = await Promise.all([facturar(A, vA), facturar(B, vB)]);
    comprobar("A y B a la vez: ambas emitidas", `${rA.estado} ${rB.estado}`, "EMITIDO EMITIDO");

    console.log("--- Aislamiento ---");
    await rechaza("B no factura una venta de A", "La venta no existe", () => facturar(B, vA1));
    await rechaza("B no emite NC de una venta de A", "La venta no existe", () => nc(B, vA1));
    const deAdesdeB = await conNegocio(B.id, (tx) => tx.comprobante.count({ where: { id: fA1.id } }));
    comprobar("B no ve comprobantes de A (RLS)", String(deAdesdeB), "0");
    const deAdesdeBsinFiltro = await conNegocio(B.id, (tx) => tx.comprobante.findMany({ select: { negocioId: true } }));
    comprobar("B, sin filtro, solo ve los suyos", String(deAdesdeBsinFiltro.every((c) => c.negocioId === B.id)), "true");
    const configB = await conNegocio(B.id, (tx) => tx.configuracion.findMany({ where: { clave: CLAVES_FISCALES.cuit } }));
    comprobar("la Configuración fiscal que ve B es la suya", configB.map((c) => c.valor).join(","), B.cuit);
    await rechaza("una venta de otro negocio no existe para el simulador de B", "La venta no existe", () => facturar(B, vA1));
    const ultimoA = await accesoSimuladoDeNegocio(A.id).ultimoNumeroEmitido(PV, "FACTURA_B");
    const ultimoB = await accesoSimuladoDeNegocio(B.id).ultimoNumeroEmitido(PV, "FACTURA_B");
    comprobar("el simulador lee la serie de cada negocio", String(ultimoA !== 0 && ultimoB !== 0 && ultimoA !== ultimoB), "true");
  } finally {
    await limpiar([A, B]);
    const quedan = await admin.negocio.count({ where: { slug: { startsWith: MARCA } } });
    comprobar("limpieza: no quedan negocios de prueba", String(quedan), "0");
  }
}

main()
  .catch((error) => {
    console.error(error);
    fallos += 1;
  })
  .finally(async () => {
    await admin.$disconnect();
    await app.$disconnect();
    console.log(fallos === 0 ? "\nTodo OK." : `\n${fallos} fallo(s).`);
    process.exit(fallos === 0 ? 0 : 1);
  });
