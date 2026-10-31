/**
 * Prueba la concurrencia de DOS negocios (multi-tenant F3.6) contra Postgres LOCAL, con el rol de la
 * app (`ventas_app`, sujeto a RLS) y el dueño (`ventas_migrador`) solo para sembrar y limpiar.
 *
 *   DATABASE_URL="postgresql://ventas_app:ventas_app@localhost:5477/ventas_vta14?host=/tmp/pgsock7" \
 *   DATABASE_URL_MIGRACIONES="postgresql://ventas_migrador:ventas_migrador@localhost:5477/ventas_vta14?host=/tmp/pgsock7" \
 *   npx tsx scripts/test-concurrencia-negocios.ts
 *
 * Comprueba, con transacciones reales:
 *   - las claves de los candados de numeracion (ventas, presupuestos) llevan el negocio;
 *   - con el candado de un negocio TOMADO por una transaccion abierta, el otro negocio carga ventas,
 *     presupuestos y facturas sin esperar, y el mismo negocio SI espera (el candado sigue sirviendo);
 *   - lo mismo con el candado del alta del primer dueño / administracion de usuarios;
 *   - cargas simultaneas de ventas, presupuestos y facturas en los dos negocios a la vez: cada uno
 *     numera sin huecos ni duplicados.
 * Las transacciones retenidas se deshacen al final. Limpia todo lo que siembra en un `finally`.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { hoyArgentina } from "../src/lib/acciones";
import { digitoVerificadorCuit } from "../src/lib/cuit";
import { CLAVES_FISCALES } from "../src/lib/datos-fiscales";
import type { Tx } from "../src/lib/dominio/tx";
import { claveLockVentas, registrarVentaEnTx } from "../src/lib/dominio/ventas";
import { claveLockPresupuestos, crearPresupuestoEnTx } from "../src/lib/dominio/presupuestos";
import { accesoSimuladoDeNegocio, baseDeNegocio, emitirFactura, reservarFacturaEnTx } from "../src/lib/dominio/comprobantes";
import { crearDuenoEnTx } from "../src/lib/dominio/auth";
import { crearEmisorSimulado } from "../src/lib/fiscal/emisor-simulado";
import { conNegocio } from "../src/lib/negocio";
import { prisma as app } from "../src/lib/prisma";

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

const HOY = hoyArgentina();
const ANIO = HOY.getUTCFullYear();
const PV = 1;
const MARCA = `zz-f36-${randomBytes(3).toString("hex")}`;
const cuitCon = (diez: string) => `${diez}${digitoVerificadorCuit(diez)}`;
/** Cuanto se espera para decidir que algo "no se bloqueo" / "sigue esperando". */
const ESPERA_LIBRE_MS = 8_000;
const ESPERA_BLOQUEO_MS = 1_500;

class Deshacer extends Error {}
/** Con el formato que exige el CHECK de la base; no se usa para entrar. */
const HASH_FALSO = `scrypt$ln=14,r=8,p=1$${"A".repeat(22)}$${"B".repeat(86)}`;

type Neg = { id: string; slug: string; cliente: string; articulo: string };

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
  // Un dueño ya cargado: `crearDuenoEnTx` toma el candado y se niega (sin error de base), asi la
  // transaccion retenida sigue sana y el candado queda tomado.
  await admin.usuario.create({ data: { negocioId: id, usuario: `${MARCA}-${letra}`, nombre: "Dueño", rol: "DUENO", hashClave: HASH_FALSO } });
  return { id, slug, cliente: cliente.id, articulo: articulo.id };
}

const ventaNueva = (n: Neg) => ({
  clienteId: n.cliente,
  fecha: HOY,
  observaciones: null,
  entregada: false,
  items: [{ articuloId: n.articulo, cantidad: d(1) }],
  pago: null,
});
const datosPresupuesto = (n: Neg) => ({
  clienteId: n.cliente,
  validezDias: 30,
  observaciones: null,
  items: [{ articuloId: n.articulo, cantidad: d(1) }],
});
const cargarVenta = (n: Neg) => conNegocio(n.id, (tx) => registrarVentaEnTx(tx, n.id, ventaNueva(n)), { timeout: 60_000 });
const cargarPresupuesto = (n: Neg) => conNegocio(n.id, (tx) => crearPresupuestoEnTx(tx, n.id, datosPresupuesto(n), HOY), { timeout: 60_000 });
const emisorDe = (n: Neg) => crearEmisorSimulado(accesoSimuladoDeNegocio(n.id));
const facturar = (n: Neg, ventaId: string) => emitirFactura(baseDeNegocio(n.id), n.id, ventaId, null, { emisor: emisorDe(n) });

const dormir = (ms: number) => new Promise<"tiempo">((r) => setTimeout(() => r("tiempo"), ms));
/** "termino" si la promesa se resuelve (o falla) antes de `ms`; "espera" si sigue colgada. */
async function termina<T>(p: Promise<T>, ms: number): Promise<"termino" | "espera"> {
  const r = await Promise.race([p.then(() => "termino" as const, () => "termino" as const), dormir(ms)]);
  return r === "tiempo" ? "espera" : "termino";
}

/**
 * Abre una transaccion del negocio, corre `fn` (que toma el candado; un error se ignora: el candado
 * se mantiene hasta el fin de la transaccion) y la deja abierta hasta `liberar()`, que la deshace.
 */
function retener(n: Neg, fn: (tx: Tx) => Promise<unknown>) {
  let liberar: () => void = () => {};
  const tomado = new Promise<void>((listo) => {
    const abierta = conNegocio(
      n.id,
      async (tx) => {
        try {
          await fn(tx);
        } catch {
          /* el candado ya esta tomado */
        }
        listo();
        await new Promise<void>((fin) => (liberar = fin));
        throw new Deshacer();
      },
      { timeout: 120_000 },
    );
    abierta.catch(() => listo());
  });
  return { tomado, liberar: () => liberar() };
}

async function bloqueo(
  etiqueta: string,
  A: Neg,
  B: Neg,
  tomar: (tx: Tx) => Promise<unknown>,
  accion: (n: Neg) => Promise<unknown>,
) {
  console.log(`--- ${etiqueta}: el candado de A no frena a B, pero sí a A ---`);
  const retenida = retener(A, tomar);
  await retenida.tomado;
  try {
    comprobar("B no espera", await termina(accion(B), ESPERA_LIBRE_MS), "termino");
    const mismo = accion(A);
    comprobar("A (mismo negocio) sí espera", await termina(mismo, ESPERA_BLOQUEO_MS), "espera");
    retenida.liberar();
    comprobar("A sigue cuando se libera", await termina(mismo, ESPERA_LIBRE_MS), "termino");
  } finally {
    retenida.liberar();
  }
}

/** "1..n" si los numeros (menos el desplazamiento) son exactamente 1..n; si no, la lista. */
function sinHuecos(numeros: number[], desde = 0): string {
  const orden = numeros.map((x) => x - desde).sort((a, b) => a - b);
  return orden.every((n, i) => n === i + 1) ? `1..${orden.length}` : orden.join(",");
}

async function limpiar(negocios: Neg[]) {
  for (const n of negocios) {
    await admin.comprobante.deleteMany({ where: { negocioId: n.id } });
    await admin.pago.deleteMany({ where: { negocioId: n.id } });
    await admin.ventaItem.deleteMany({ where: { negocioId: n.id } });
    await admin.venta.deleteMany({ where: { negocioId: n.id } });
    await admin.presupuestoItem.deleteMany({ where: { negocioId: n.id } });
    await admin.presupuesto.deleteMany({ where: { negocioId: n.id } });
    await admin.sesion.deleteMany({ where: { negocioId: n.id } });
    await admin.usuario.deleteMany({ where: { negocioId: n.id } });
    await admin.articulo.deleteMany({ where: { negocioId: n.id } });
    await admin.cliente.deleteMany({ where: { negocioId: n.id } });
    await admin.configuracion.deleteMany({ where: { negocioId: n.id } });
    await admin.negocio.deleteMany({ where: { id: n.id } });
  }
  await admin.usuario.deleteMany({ where: { usuario: { startsWith: MARCA } } });
}

async function main() {
  const A = await sembrarNegocio("a", cuitCon("2033333333"));
  const B = await sembrarNegocio("b", cuitCon("2044444444"));
  try {
    console.log("--- Claves de los candados de numeración ---");
    comprobar("ventas: difiere entre negocios", String(claveLockVentas(A.id, ANIO) !== claveLockVentas(B.id, ANIO)), "true");
    comprobar("ventas: difiere entre años", String(claveLockVentas(A.id, ANIO) !== claveLockVentas(A.id, ANIO + 1)), "true");
    comprobar("presupuestos: difiere entre negocios", String(claveLockPresupuestos(A.id, ANIO) !== claveLockPresupuestos(B.id, ANIO)), "true");
    comprobar("ventas y presupuestos no comparten clave", String(claveLockVentas(A.id, ANIO) !== claveLockPresupuestos(A.id, ANIO)), "true");

    await bloqueo("Ventas", A, B, (tx) => registrarVentaEnTx(tx, A.id, ventaNueva(A)), cargarVenta);
    await bloqueo("Presupuestos", A, B, (tx) => crearPresupuestoEnTx(tx, A.id, datosPresupuesto(A), HOY), cargarPresupuesto);

    console.log("--- Facturas: el candado de la serie de A no frena a B, pero sí a A ---");
    const vReten = (await cargarVenta(A)).id;
    const vA = (await cargarVenta(A)).id;
    const vB = (await cargarVenta(B)).id;
    {
      const retenida = retener(A, (tx) => reservarFacturaEnTx(tx, A.id, vReten, null, { emisor: emisorDe(A) }));
      await retenida.tomado;
      try {
        comprobar("B no espera", await termina(facturar(B, vB), ESPERA_LIBRE_MS), "termino");
        const mismo = facturar(A, vA);
        comprobar("A (mismo negocio, misma serie) sí espera", await termina(mismo, ESPERA_BLOQUEO_MS), "espera");
        retenida.liberar();
        comprobar("A sigue cuando se libera", await termina(mismo, ESPERA_LIBRE_MS), "termino");
      } finally {
        retenida.liberar();
      }
    }

    await bloqueo(
      "Alta del primer dueño / administración de usuarios",
      A,
      B,
      (tx) => crearDuenoEnTx(tx, { usuario: `${MARCA}-dueno`, nombre: "Dueño", clave: "clave-de-prueba-1234" }),
      (n) =>
        conNegocio(n.id, (tx) =>
          crearDuenoEnTx(tx, { usuario: `${MARCA}-otro`, nombre: "Otro", clave: "clave-de-prueba-1234" }),
        ),
    );

    console.log("--- Cargas simultáneas de los dos negocios a la vez ---");
    const N = 4;
    const alternar = <T>(f: (n: Neg, i: number) => Promise<T>) =>
      Promise.all(Array.from({ length: N * 2 }, (_, i) => f(i % 2 === 0 ? A : B, i).then((r) => ({ negocio: i % 2 === 0 ? A.id : B.id, r }))));
    const numerosDe = <T extends { numero: number }>(res: { negocio: string; r: T }[], n: Neg) =>
      res.filter((x) => x.negocio === n.id).map((x) => x.r.numero);

    // Las ventas y presupuestos de arriba ya numeraron (1..k por negocio): se mide lo nuevo.
    const cuantas = async (n: Neg) => ({
      ventas: await conNegocio(n.id, (tx) => tx.venta.count()),
      presupuestos: await conNegocio(n.id, (tx) => tx.presupuesto.count()),
      emitidas: await conNegocio(n.id, (tx) => tx.comprobante.count({ where: { estado: "EMITIDO" } })),
    });
    const antes = { A: await cuantas(A), B: await cuantas(B) };

    const ventas = await alternar(cargarVenta);
    comprobar("ventas de A", sinHuecos(numerosDe(ventas, A), antes.A.ventas), `1..${N}`);
    comprobar("ventas de B", sinHuecos(numerosDe(ventas, B), antes.B.ventas), `1..${N}`);

    const presupuestos = await alternar(cargarPresupuesto);
    comprobar("presupuestos de A", sinHuecos(numerosDe(presupuestos, A), antes.A.presupuestos), `1..${N}`);
    comprobar("presupuestos de B", sinHuecos(numerosDe(presupuestos, B), antes.B.presupuestos), `1..${N}`);

    const paraFacturar = { A: [] as string[], B: [] as string[] };
    for (let i = 0; i < N; i++) {
      paraFacturar.A.push((await cargarVenta(A)).id);
      paraFacturar.B.push((await cargarVenta(B)).id);
    }
    // Facturas: la serie admite UNA reserva a la vez por negocio (el resto recibe "Hay otra ... esperando");
    // lo que se prueba es que cada negocio emita su cadena mientras el otro emite la suya.
    const cadena = async (n: Neg) => {
      const hechas: { negocio: string; r: Awaited<ReturnType<typeof facturar>> }[] = [];
      for (const venta of paraFacturar[n === A ? "A" : "B"]) hechas.push({ negocio: n.id, r: await facturar(n, venta) });
      return hechas;
    };
    const facturas = (await Promise.all([cadena(A), cadena(B)])).flat();
    for (const [nombre, n, previas] of [["A", A, antes.A], ["B", B, antes.B]] as const) {
      const propias = facturas.filter((x) => x.negocio === n.id);
      comprobar(`facturas de ${nombre} emitidas`, String(propias.filter((x) => x.r.estado === "EMITIDO").length), String(N));
      comprobar(`facturas de ${nombre}: numeración`, sinHuecos(numerosDe(facturas, n), previas.emitidas), `1..${N}`);
    }
  } catch (error) {
    console.error(error);
    fallos += 1;
    await dormir(3_000); // deja terminar lo que haya quedado en vuelo antes de limpiar
  } finally {
    await limpiar([A, B]);
  }

  await admin.$disconnect();
  await app.$disconnect();
  if (fallos > 0) {
    console.log(`\n${fallos} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("\nTodo OK.");
}

main().catch(async (error) => {
  console.error(error);
  await admin.$disconnect().catch(() => {});
  process.exit(1);
});
