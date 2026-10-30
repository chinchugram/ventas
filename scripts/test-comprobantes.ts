/**
 * Prueba la emision de facturas contra Postgres real, sin Next:
 *
 *   npm run test:comprobantes:db
 *
 * Emision A, B y C con el emisor simulado y sus estados; la foto (no cambia al
 * editar cliente, articulo o configuracion); numeros correlativos por serie; un
 * rechazo deja RECHAZADO y el numero se reusa; un corte deja PENDIENTE; venta
 * anulada, sin datos fiscales o con receptor invalido no se factura; la guarda
 * de produccion; los CHECK, indices y triggers de la migracion; y, con
 * transacciones reales, dos emisiones simultaneas de la misma venta (una sola
 * factura vigente, la otra con error claro), el flujo en dos fases y la
 * resolucion de un PENDIENTE.
 *
 * No deja rastro: los escenarios corren en una transaccion que se deshace al
 * final. La concurrencia necesita transacciones reales: usa ventas del anio
 * ficticio 2099, un punto de venta propio y datos con prefijo; borra todo en un
 * `finally`, restaura la configuracion y verifica que los conteos quedaron igual.
 */
import "dotenv/config";
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
  registrarResultadoEnTx,
  reservarFacturaEnTx,
  resolverPendiente,
  type ComprobanteProcesado,
} from "../src/lib/dominio/comprobantes";
import { MENSAJE_SIMULADO_EN_PRODUCCION, obtenerEmisorFiscal, type EmisorFiscal } from "../src/lib/fiscal";
import { crearEmisorSimulado, type OpcionesSimulador } from "../src/lib/fiscal/emisor-simulado";

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

/** Falla (CHECK / unique / trigger) sin abortar la transaccion del escenario: usa un savepoint. */
async function violaLaBase(tx: Tx, etiqueta: string, fn: () => Promise<unknown>, fragmento?: string) {
  await tx.$executeRaw`SAVEPOINT prueba`;
  try {
    await fn();
    comprobar(etiqueta, "se aceptó", "rechazada por la base");
  } catch (error) {
    const texto = error instanceof Error ? error.message : String(error);
    const ok = !fragmento || texto.includes(fragmento);
    comprobar(etiqueta, ok ? "rechazada por la base" : `rechazada por otra cosa: ${texto.slice(0, 200)}`, "rechazada por la base");
  }
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT prueba`;
}

/** Lo que tiene que aceptarse (en un savepoint, para no dejarlo). */
async function laBaseAcepta(tx: Tx, etiqueta: string, fn: () => Promise<unknown>) {
  await tx.$executeRaw`SAVEPOINT prueba`;
  try {
    await fn();
    comprobar(etiqueta, "aceptado", "aceptado");
  } catch (error) {
    comprobar(etiqueta, `rechazado: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`, "aceptado");
  }
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT prueba`;
}

/** Corre ya los controles diferidos (los importes cierran) que si no correrian al confirmar. */
async function controlesDiferidos(tx: Tx) {
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
}

const f = (iso: string) => new Date(`${iso}T00:00:00Z`);
const HOY = hoyArgentina();
const cuitCon = (diez: string) => `${diez}${digitoVerificadorCuit(diez)}`;
const CUIT_EMISOR = cuitCon("2033333333");
const CUIT_RI = cuitCon("3070000000");
/** Punto de venta propio de las pruebas: los numeros arrancan en 1 aunque la base tenga comprobantes. */
const PV = 4321;

async function configurarFiscal(tx: Tx, valores: Partial<Record<keyof typeof CLAVES_FISCALES, string>> = {}) {
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
    if (valor === "") await tx.configuracion.deleteMany({ where: { clave } });
    else await tx.configuracion.upsert({ where: { clave }, update: { valor }, create: { clave, valor } });
  }
}

type Prueba = Awaited<ReturnType<typeof preparar>>;

/**
 * Articulos (servicios, sin stock): X 1210 con IVA 21, Y 110,50 con IVA 10,5 y
 * Z 500 con IVA 0. Clientes: consumidor final sin documento, responsable
 * inscripto con CUIT y RI sin CUIT. Datos fiscales completos (RI, punto PV).
 */
async function preparar(tx: Tx, prefijo = "Prueba comprobantes") {
  await configurarFiscal(tx);
  const x = await tx.articulo.create({ data: { nombre: `${prefijo} X`, precioVenta: d(1210), ivaPct: d(21), esServicio: true } });
  const y = await tx.articulo.create({ data: { nombre: `${prefijo} Y`, precioVenta: d("110.5"), ivaPct: d("10.5"), esServicio: true } });
  const z = await tx.articulo.create({ data: { nombre: `${prefijo} Z`, precioVenta: d(500), ivaPct: d(0), esServicio: true } });
  const final = await tx.cliente.create({ data: { nombre: `${prefijo} consumidor final`, direccion: "Mostrador" } });
  const ri = await tx.cliente.create({
    data: { nombre: `${prefijo} RI`, cuit: CUIT_RI, condicionIva: "RESPONSABLE_INSCRIPTO", direccion: "Av. Colón 1, Córdoba" },
  });
  const riSinCuit = await tx.cliente.create({ data: { nombre: `${prefijo} RI sin CUIT`, condicionIva: "RESPONSABLE_INSCRIPTO" } });
  const usuario = await tx.usuario.create({
    data: {
      usuario: `zz-${Math.random().toString(36).slice(2, 10)}`,
      nombre: "Facturadora de prueba",
      rol: "EMPLEADO",
      hashClave: `scrypt$ln=14,r=8,p=1$${"a".repeat(22)}$${"b".repeat(43)}`,
    },
  });
  return { x, y, z, final, ri, riSinCuit, usuario };
}

async function venta(tx: Tx, clienteId: string, items: { articuloId: string; cantidad: string | number }[], fecha = HOY) {
  const v = await registrarVentaEnTx(tx, {
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

/** Datos minimos de un comprobante para probar los CHECK directo contra la base. */
function crudo(ventaId: string, extra: Record<string, unknown> = {}) {
  return {
    ambiente: "SIMULADO",
    tipo: "FACTURA_B",
    codigoArca: 6,
    puntoVenta: PV,
    numero: 900,
    fecha: HOY,
    estado: "PENDIENTE",
    emisorRazonSocial: "Prueba",
    emisorCuit: CUIT_EMISOR,
    emisorCondicionIva: "RESPONSABLE_INSCRIPTO",
    emisorDomicilio: "Calle 1",
    emisorInicioActividades: f("2020-01-01"),
    receptorNombre: "Cliente",
    receptorDocTipo: 99,
    receptorDocNro: "0",
    receptorCondicionIva: "CONSUMIDOR_FINAL",
    importeNeto: d(100),
    importeIva: d(21),
    importeTotal: d(121),
    ventaId,
    ...extra,
  } as Parameters<Tx["comprobante"]["create"]>[0]["data"];
}

const linea = { orden: 1, descripcion: "Algo", cantidad: d(1), precioUnitario: d(121), ivaPct: d(21), subtotalNeto: d(100), subtotalIva: d(21), subtotalBruto: d(121) };
const alicuota21 = { alicuotaPct: d(21), codigoArca: 5, baseImponible: d(100), importe: d(21) };

async function main() {
  const antes = await contarTodo(prisma);

  await escenario("Factura B: emisión, foto y estados", async (tx) => {
    const t = await preparar(tx);
    // 2 × 1210 (21%) + 3 × 110,50 (10,5%) + 2 × 500 (0%):
    // neto 2000 + 300 + 1000 = 3300; IVA 420 + 31,50 = 451,50; total 3751,50.
    const v = await venta(tx, t.final.id, [
      { articuloId: t.x.id, cantidad: 2 },
      { articuloId: t.y.id, cantidad: 3 },
      { articuloId: t.z.id, cantidad: 2 },
    ]);
    const r = await emitirFacturaEnTx(tx, v, t.usuario.id, { emisor: simulado(tx) });
    comprobar("estado", r.estado, "EMITIDO");
    comprobar("tipo y número", `${r.tipo} ${r.puntoVenta} ${r.numero}`, `FACTURA_B ${PV} 1`);
    comprobar("CAE de 14 dígitos", String(/^\d{14}$/.test(r.cae ?? "")), "true");
    comprobar("mensaje", r.mensaje.startsWith("Factura B 4321-00000001 emitida") ? "ok" : r.mensaje, "ok");

    const c = await tx.comprobante.findUniqueOrThrow({
      where: { id: r.id },
      include: { items: { orderBy: { orden: "asc" } }, alicuotas: { orderBy: { alicuotaPct: "asc" } } },
    });
    comprobar("ambiente SIMULADO", c.ambiente, "SIMULADO");
    comprobar("código ARCA", String(c.codigoArca), "6");
    comprobar("fecha de hoy", c.fecha.toISOString().slice(0, 10), HOY.toISOString().slice(0, 10));
    comprobar("vencimiento del CAE: +10 días", String((c.caeVencimiento!.getTime() - c.fecha.getTime()) / 86_400_000), "10");
    comprobar("importes", `${c.importeNeto} ${c.importeIva} ${c.importeTotal}`, "3300 451.5 3751.5");
    comprobar(
      "alícuotas",
      c.alicuotas.map((a) => `${a.alicuotaPct}:${a.codigoArca}:${a.baseImponible}:${a.importe}`).join(" "),
      "0:3:1000:0 10.5:4:300:31.5 21:5:2000:420",
    );
    comprobar("tres líneas", String(c.items.length), "3");
    comprobar("las líneas suman el total", c.items.reduce((s, i) => s.plus(i.subtotalBruto.toString()), d(0)).toString(), "3751.5");
    comprobar(
      "foto del emisor",
      `${c.emisorRazonSocial} | ${c.emisorCuit} | ${c.emisorCondicionIva} | ${c.emisorDomicilio} | ${c.emisorInicioActividades.toISOString().slice(0, 10)} | ${c.emisorIibb}`,
      `Prueba Fiscal S.R.L. | ${CUIT_EMISOR} | RESPONSABLE_INSCRIPTO | Calle de Prueba 123, Córdoba | 2020-03-02 | 280-123456-7`,
    );
    comprobar(
      "foto del receptor (sin identificar)",
      `${c.receptorNombre} | ${c.receptorDocTipo} | ${c.receptorDocNro} | ${c.receptorCondicionIva} | ${c.receptorDomicilio}`,
      "Prueba comprobantes consumidor final | 99 | 0 | CONSUMIDOR_FINAL | Mostrador",
    );
    comprobar("quién la emitió", String(c.usuarioId === t.usuario.id), "true");
    comprobar("sin comprobante asociado", String(c.comprobanteAsociadoId), "null");

    // Correlativos dentro de la serie (ambiente, punto, tipo).
    const v2 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const v3 = await venta(tx, t.final.id, [{ articuloId: t.z.id, cantidad: 1 }]);
    const r2 = await emitirFacturaEnTx(tx, v2, null, { emisor: simulado(tx) });
    const r3 = await emitirFacturaEnTx(tx, v3, undefined, { emisor: simulado(tx) });
    comprobar("números correlativos", `${r.numero},${r2.numero},${r3.numero}`, "1,2,3");
    comprobar("sin usuario queda NULL", String((await tx.comprobante.findUniqueOrThrow({ where: { id: r2.id } })).usuarioId), "null");

    // Los controles diferidos (lineas y alicuotas cierran) pasan con lo emitido.
    await laBaseAcepta(tx, "los importes cierran (control diferido)", () => controlesDiferidos(tx));
  });

  await escenario("Factura A y factura C: series independientes", async (tx) => {
    const t = await preparar(tx);
    const vB = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const vA = await venta(tx, t.ri.id, [{ articuloId: t.x.id, cantidad: 1 }, { articuloId: t.y.id, cantidad: 1 }]);
    const b = await emitirFacturaEnTx(tx, vB, null, { emisor: simulado(tx) });
    const a = await emitirFacturaEnTx(tx, vA, null, { emisor: simulado(tx) });
    comprobar("RI con CUIT: factura A", `${a.estado} ${a.tipo} ${a.numero}`, "EMITIDO FACTURA_A 1");
    comprobar("la B tiene su propia numeración", `${b.tipo} ${b.numero}`, "FACTURA_B 1");
    const ca = await tx.comprobante.findUniqueOrThrow({ where: { id: a.id } });
    comprobar("A: receptor con CUIT (80)", `${ca.codigoArca} ${ca.receptorDocTipo} ${ca.receptorDocNro} ${ca.receptorCondicionIva}`, `1 80 ${CUIT_RI} RESPONSABLE_INSCRIPTO`);

    // El negocio pasa a monotributo: factura C, sin discriminar IVA (y avisa).
    await configurarFiscal(tx, { condicionIva: "MONOTRIBUTO" });
    const vC = await venta(tx, t.ri.id, [{ articuloId: t.x.id, cantidad: 2 }]);
    const c = await emitirFacturaEnTx(tx, vC, null, { emisor: simulado(tx) });
    comprobar("monotributo: factura C", `${c.estado} ${c.tipo} ${c.numero}`, "EMITIDO FACTURA_C 1");
    comprobar("C con IVA en la venta: advierte", String(c.advertencias.some((x) => x.includes("no discrimina IVA"))), "true");
    const cc = await tx.comprobante.findUniqueOrThrow({ where: { id: c.id }, include: { alicuotas: true } });
    comprobar("C: total sin discriminar", `${cc.codigoArca} ${cc.importeNeto} ${cc.importeIva} ${cc.importeTotal} ${cc.alicuotas.length}`, "11 2420 0 2420 0");
    comprobar("C: foto del emisor monotributista", cc.emisorCondicionIva, "MONOTRIBUTO");
    await laBaseAcepta(tx, "los importes cierran (control diferido)", () => controlesDiferidos(tx));
  });

  await escenario("La foto no cambia al editar cliente, artículo o configuración", async (tx) => {
    const t = await preparar(tx);
    const v = await venta(tx, t.ri.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const r = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
    const foto = async () => {
      const c = await tx.comprobante.findUniqueOrThrow({ where: { id: r.id }, include: { items: true, alicuotas: true } });
      const { actualizadoEn: _a, ...resto } = c;
      return JSON.stringify(resto);
    };
    const antes = await foto();
    await tx.cliente.update({
      where: { id: t.ri.id },
      data: { nombre: "Otro nombre", cuit: null, condicionIva: "CONSUMIDOR_FINAL", direccion: "Otra dirección", dni: "12345678" },
    });
    await tx.articulo.update({ where: { id: t.x.id }, data: { nombre: "Otro artículo", precioVenta: d(9999), ivaPct: d("10.5") } });
    await configurarFiscal(tx, { razonSocial: "Otra razón social", domicilio: "Otro domicilio", condicionIva: "MONOTRIBUTO", puntoVenta: "77" });
    comprobar("el comprobante es idéntico", String((await foto()) === antes), "true");
    const c = await tx.comprobante.findUniqueOrThrow({ where: { id: r.id } });
    comprobar("sigue con el receptor de entonces", `${c.receptorNombre} ${c.receptorDocTipo}`, "Prueba comprobantes RI 80");
  });

  await escenario("Lo que no se factura", async (tx) => {
    const t = await preparar(tx);
    const e = () => ({ emisor: simulado(tx) });

    const anulada = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await anularVentaEnTx(tx, anulada);
    await rechaza("venta anulada", "anulada", () => emitirFacturaEnTx(tx, anulada, null, e()));
    await rechaza("venta inexistente", "no existe", () => emitirFacturaEnTx(tx, "00000000-0000-4000-8000-0000000000aa", null, e()));

    const v = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const primera = await emitirFacturaEnTx(tx, v, null, e());
    await rechaza("la misma venta dos veces", "ya está facturada (Factura B 4321-00000001)", () => emitirFacturaEnTx(tx, v, null, e()));
    comprobar("una sola factura de esa venta", String(await tx.comprobante.count({ where: { ventaId: v } })), "1");
    comprobar("y es la primera", String((await tx.comprobante.findFirstOrThrow({ where: { ventaId: v } })).id === primera.id), "true");

    await violaLaBase(tx, "una venta facturada no se anula sin nota de crédito", () => anularVentaEnTx(tx, v), "nota de credito");

    const riSinCuit = await venta(tx, t.riSinCuit.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await rechaza("RI sin CUIT", "responsable inscripto pero no tiene CUIT", () => emitirFacturaEnTx(tx, riSinCuit, null, e()));

    // Umbral de identificacion: con 1000 de umbral, 1210 sin documento no se factura; con DNI si.
    await configurarFiscal(tx, { umbralIdentificacion: "1000" });
    const grande = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await rechaza("consumidor final sin identificar sobre el umbral", "exige identificar", () => emitirFacturaEnTx(tx, grande, null, e()));
    await tx.cliente.update({ where: { id: t.final.id }, data: { dni: "30123456" } });
    const conDni = await emitirFacturaEnTx(tx, grande, null, e());
    const cd = await tx.comprobante.findUniqueOrThrow({ where: { id: conDni.id } });
    comprobar("con DNI sí: documento 96", `${conDni.estado} ${cd.receptorDocTipo} ${cd.receptorDocNro}`, "EMITIDO 96 30123456");

    // Sin datos fiscales no se emite (y no queda nada guardado).
    await configurarFiscal(tx, { umbralIdentificacion: "" });
    const sinDatos = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await tx.configuracion.deleteMany({ where: { clave: { startsWith: "fiscal" } } });
    await rechaza("sin datos fiscales", "completá los datos fiscales", () => emitirFacturaEnTx(tx, sinDatos, null, e()));
    await configurarFiscal(tx, { puntoVenta: "" });
    await rechaza("sin punto de venta: lo dice", "Falta el punto de venta", () => emitirFacturaEnTx(tx, sinDatos, null, e()));
    await configurarFiscal(tx, { cuit: "20333333335" });
    await rechaza("con el CUIT del negocio inválido", "dígito verificador", () => emitirFacturaEnTx(tx, sinDatos, null, e()));
    comprobar("nada guardado de esos intentos", String(await tx.comprobante.count({ where: { ventaId: { in: [sinDatos, riSinCuit, anulada] } } })), "0");

    // Una venta cuyas lineas no cierran (alguien la toco a mano) no se factura.
    await configurarFiscal(tx);
    const tocada = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await tx.venta.update({ where: { id: tocada }, data: { totalNeto: d("1000.01"), totalIVA: d("209.99") } });
    await rechaza("venta con totales que no cierran", "no coincide con la suma de sus líneas", () => emitirFacturaEnTx(tx, tocada, null, e()));
  });

  await escenario("Rechazo, corte y número reservado", async (tx) => {
    const t = await preparar(tx);
    const v = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const rechazo = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx, { rechazar: () => ["[999] Rechazo de prueba"] }) });
    comprobar("rechazo: queda RECHAZADO", `${rechazo.estado} ${rechazo.numero}`, "RECHAZADO 1");
    const cr = await tx.comprobante.findUniqueOrThrow({ where: { id: rechazo.id } });
    comprobar("rechazo: con el motivo y sin CAE", `${cr.observaciones} ${cr.cae} ${cr.caeVencimiento}`, "[999] Rechazo de prueba null null");
    comprobar("rechazo: el mensaje lo dice", String(rechazo.mensaje.includes("rechazó") && rechazo.mensaje.includes("Rechazo de prueba")), "true");

    // El numero no se pierde: el rechazado queda registrado con el 1 y el
    // proximo intento (que ARCA espera con ese mismo numero) lo usa.
    const reintento = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
    comprobar("reintento de la misma venta: EMITIDO con el mismo número", `${reintento.estado} ${reintento.numero}`, "EMITIDO 1");
    const v2 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const siguiente = await emitirFacturaEnTx(tx, v2, null, { emisor: simulado(tx) });
    comprobar("la siguiente: 2 (sin huecos en lo autorizado)", String(siguiente.numero), "2");
    comprobar("del 1 quedan el intento rechazado y el emitido", (await tx.comprobante.findMany({ where: { ventaId: v }, orderBy: { creadoEn: "asc" } })).map((c) => `${c.numero}:${c.estado}`).join(" "), "1:RECHAZADO 1:EMITIDO");

    // Corte: el emisor no responde → queda PENDIENTE con el numero reservado.
    const v3 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const corte = await emitirFacturaEnTx(tx, v3, null, { emisor: simulado(tx, { cortar: () => true }) });
    comprobar("corte: queda PENDIENTE con su número", `${corte.estado} ${corte.numero}`, "PENDIENTE 3");
    comprobar("corte: el mensaje lo explica", String(corte.mensaje.includes("quedó pendiente")), "true");
    await rechaza("la misma venta con un PENDIENTE", "esperando respuesta del emisor", () => emitirFacturaEnTx(tx, v3, null, { emisor: simulado(tx) }));
    const v4 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await rechaza("otra venta en la misma serie con un PENDIENTE", "esperando respuesta del emisor", () => emitirFacturaEnTx(tx, v4, null, { emisor: simulado(tx) }));
    await violaLaBase(tx, "una venta con factura PENDIENTE no se anula", () => anularVentaEnTx(tx, v3), "nota de credito");

    // Llega la respuesta: se registra y la serie sigue.
    const llego = await registrarResultadoEnTx(tx, corte.id, { aprobado: true, cae: "71234567890123", vencimiento: f("2099-01-10"), observaciones: [] });
    comprobar("resultado registrado", `${llego.estado} ${llego.cae}`, "EMITIDO 71234567890123");
    await rechaza("un resultado dos veces", "ya estaba EMITIDO", () =>
      registrarResultadoEnTx(tx, corte.id, { aprobado: false, observaciones: ["tarde"] }),
    );
    const despues = await emitirFacturaEnTx(tx, v4, null, { emisor: simulado(tx) });
    comprobar("la serie sigue: 4", `${despues.estado} ${despues.numero}`, "EMITIDO 4");

    // Inconsistencia grave: el emisor aprueba algo que la base tiene RECHAZADO.
    try {
      await registrarResultadoEnTx(tx, rechazo.id, { aprobado: true, cae: "71234567890124", vencimiento: f("2099-01-10"), observaciones: [] });
      comprobar("aprobado sobre un RECHAZADO", "aceptado", "error grave");
    } catch (error) {
      comprobar("aprobado sobre un RECHAZADO", !(error instanceof ErrorDeNegocio) && String(error).includes("Revisar a mano") ? "error grave" : String(error), "error grave");
    }
  });

  await escenario("Guarda de producción y emisor no simulado", async (tx) => {
    const t = await preparar(tx);
    const v = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const enProduccion = obtenerEmisorFiscal({ NODE_ENV: "production" }, accesoSimulado(tx));
    comprobar("producción sin permiso: no hay emisor", enProduccion.ok ? "hay emisor" : enProduccion.error, MENSAJE_SIMULADO_EN_PRODUCCION);
    comprobar("y no se guardó nada", String(await tx.comprobante.count({ where: { ventaId: v } })), "0");
    const permitido = obtenerEmisorFiscal({ NODE_ENV: "production", PERMITIR_EMISOR_SIMULADO: "1" }, accesoSimulado(tx));
    comprobar("producción con permiso: simulado", permitido.ok ? permitido.emisor.ambiente : permitido.error, "SIMULADO");
    if (permitido.ok) {
      const r = await emitirFacturaEnTx(tx, v, null, { emisor: permitido.emisor });
      comprobar("y lo que emite es SIMULADO", (await tx.comprobante.findUniqueOrThrow({ where: { id: r.id } })).ambiente, "SIMULADO");
    }
    const falsoReal: EmisorFiscal = { ...simulado(tx), ambiente: "PRODUCCION" };
    try {
      await emitirFacturaEnTx(tx, v, null, { emisor: falsoReal });
      comprobar("una sola transacción con un emisor real", "aceptado", "se niega");
    } catch (error) {
      comprobar("una sola transacción con un emisor real", String(error).includes("dos fases") ? "se niega" : String(error), "se niega");
    }
  });

  await escenario("CHECK, índices y triggers", async (tx) => {
    const t = await preparar(tx);
    const v = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const libre = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    const emitido = await emitirFacturaEnTx(tx, v, null, { emisor: simulado(tx) });
    const id = emitido.id;
    const upd = (data: Record<string, unknown>) => () => tx.comprobante.update({ where: { id }, data: data as never });

    console.log("  EMITIDO es inmutable");
    await violaLaBase(tx, "cambiar el número", upd({ numero: 77 }), "no se modifica");
    await violaLaBase(tx, "cambiar el CAE", upd({ cae: "79999999999999" }), "no se modifica");
    await violaLaBase(tx, "cambiar el total", upd({ importeTotal: d(1), importeNeto: d(1), importeIva: d(0) }), "no se modifica");
    await violaLaBase(tx, "cambiar el receptor", upd({ receptorNombre: "Otro" }), "no se modifica");
    await violaLaBase(tx, "pasarlo a RECHAZADO", upd({ estado: "RECHAZADO", cae: null, caeVencimiento: null, observaciones: "x" }), "no se modifica");
    await violaLaBase(tx, "cambiarle la venta", upd({ ventaId: libre }), "no se modifica");
    await violaLaBase(tx, "cambiar las observaciones", upd({ observaciones: "nota" }), "no se modifica");
    await laBaseAcepta(tx, "tocar solo actualizadoEn (inocuo)", upd({ actualizadoEn: new Date() }));
    const item = await tx.comprobanteItem.findFirstOrThrow({ where: { comprobanteId: id } });
    await violaLaBase(tx, "cambiar una línea", () => tx.comprobanteItem.update({ where: { id: item.id }, data: { descripcion: "Otra" } }), "no se modifica");
    await violaLaBase(tx, "borrar una línea", () => tx.comprobanteItem.delete({ where: { id: item.id } }), "no se borra");
    await violaLaBase(tx, "agregar una línea", () => tx.comprobanteItem.create({ data: { ...linea, orden: 9, comprobanteId: id } }), "PENDIENTE");
    await violaLaBase(tx, "agregar una alícuota", () => tx.comprobanteIva.create({ data: { ...alicuota21, alicuotaPct: d(27), codigoArca: 6, comprobanteId: id } }), "PENDIENTE");
    const iva = await tx.comprobanteIva.findFirstOrThrow({ where: { comprobanteId: id } });
    await violaLaBase(tx, "cambiar una alícuota", () => tx.comprobanteIva.update({ where: { id: iva.id }, data: { importe: d(0) } }), "no se modifica");
    await laBaseAcepta(tx, "borrar un comprobante SIMULADO (datos de prueba, en cascada)", () => tx.comprobante.delete({ where: { id } }));

    console.log("  PENDIENTE: solo se registra el resultado");
    const pend = await tx.comprobante.create({ data: { ...crudo(libre), items: { create: [linea] }, alicuotas: { create: [alicuota21] } } });
    const updP = (data: Record<string, unknown>) => () => tx.comprobante.update({ where: { id: pend.id }, data: data as never });
    await violaLaBase(tx, "cambiar importes de un PENDIENTE", updP({ importeTotal: d(242), importeNeto: d(200), importeIva: d(42) }), "solo se registra el resultado");
    await violaLaBase(tx, "cambiar el número de un PENDIENTE", updP({ numero: 901 }), "solo se registra el resultado");
    await violaLaBase(tx, "EMITIDO sin CAE", updP({ estado: "EMITIDO", caeVencimiento: f("2099-01-01") }), "comprobantes_cae_check");
    await violaLaBase(tx, "EMITIDO sin vencimiento", updP({ estado: "EMITIDO", cae: "71234567890123" }), "comprobantes_cae_vencimiento_check");
    await violaLaBase(tx, "CAE de 13 dígitos", updP({ estado: "EMITIDO", cae: "7123456789012", caeVencimiento: f("2099-01-01") }), "comprobantes_cae_check");
    await violaLaBase(tx, "CAE con letras", updP({ estado: "EMITIDO", cae: "7123456789012A", caeVencimiento: f("2099-01-01") }), "comprobantes_cae_check");
    await violaLaBase(tx, "CAE en un PENDIENTE", updP({ cae: "71234567890123" }), "comprobantes_cae_check");
    await violaLaBase(tx, "RECHAZADO sin motivo", updP({ estado: "RECHAZADO" }), "comprobantes_rechazo_motivo_check");
    await violaLaBase(tx, "RECHAZADO con motivo en blanco", updP({ estado: "RECHAZADO", observaciones: "   " }), "comprobantes_rechazo_motivo_check");
    await laBaseAcepta(tx, "PENDIENTE → EMITIDO con CAE y vencimiento", updP({ estado: "EMITIDO", cae: "71234567890123", caeVencimiento: f("2099-01-01") }));
    await laBaseAcepta(tx, "PENDIENTE → RECHAZADO con motivo", updP({ estado: "RECHAZADO", observaciones: "motivo" }));
    await violaLaBase(tx, "borrar una línea de un PENDIENTE", () => tx.comprobanteItem.deleteMany({ where: { comprobanteId: pend.id } }), "no se borra");

    console.log("  Alta");
    const alta = (extra: Record<string, unknown>, numero = 950) => () => tx.comprobante.create({ data: crudo(libre, { numero, ...extra }) });
    await violaLaBase(tx, "nacer EMITIDO", alta({ estado: "EMITIDO", cae: "71234567890123", caeVencimiento: f("2099-01-01") }), "se crea PENDIENTE");
    await violaLaBase(tx, "número 0", alta({}, 0), "comprobantes_numero_check");
    await violaLaBase(tx, "número negativo", alta({}, -5), "comprobantes_numero_check");
    await violaLaBase(tx, "punto de venta 0", alta({ puntoVenta: 0 }), "comprobantes_punto_venta_check");
    await violaLaBase(tx, "punto de venta 100000", alta({ puntoVenta: 100000 }), "comprobantes_punto_venta_check");
    await violaLaBase(tx, "código ARCA que no es el del tipo", alta({ codigoArca: 1 }), "comprobantes_codigo_arca_check");
    await violaLaBase(tx, "importe negativo", alta({ importeNeto: d(-100), importeIva: d(221), importeTotal: d(121) }), "comprobantes_importes_check");
    await violaLaBase(tx, "total ≠ neto + IVA", alta({ importeTotal: d("121.01") }), "comprobantes_total_check");
    await violaLaBase(tx, "factura C con IVA", alta({ tipo: "FACTURA_C", codigoArca: 11, emisorCondicionIva: "MONOTRIBUTO" }), "comprobantes_c_sin_iva_check");
    await violaLaBase(tx, "B de un emisor monotributista", alta({ emisorCondicionIva: "MONOTRIBUTO" }), "comprobantes_emisor_check");
    await violaLaBase(tx, "emisor exento", alta({ emisorCondicionIva: "EXENTO" }), "comprobantes_emisor_check");
    await violaLaBase(tx, "CUIT del emisor con guiones", alta({ emisorCuit: "20-33333333-4" }), "comprobantes_emisor_check");
    await violaLaBase(tx, "receptor 80 con un DNI", alta({ receptorDocTipo: 80, receptorDocNro: "12345678" }), "comprobantes_receptor_check");
    await violaLaBase(tx, "receptor 96 con un CUIT", alta({ receptorDocTipo: 96, receptorDocNro: CUIT_RI }), "comprobantes_receptor_check");
    await violaLaBase(tx, "receptor 99 con número", alta({ receptorDocNro: "12345678" }), "comprobantes_receptor_check");
    await violaLaBase(tx, "tipo de documento inventado", alta({ receptorDocTipo: 86, receptorDocNro: "20123456789" }), "comprobantes_receptor_check");
    await violaLaBase(tx, "factura A a un consumidor final", alta({ tipo: "FACTURA_A", codigoArca: 1, receptorDocTipo: 80, receptorDocNro: CUIT_RI }), "comprobantes_receptor_a_check");
    await violaLaBase(tx, "factura con comprobante asociado", alta({ comprobanteAsociadoId: pend.id }), "comprobantes_asociado_check");
    // (la frena el trigger de alta antes que el CHECK, que queda como segunda defensa)
    await violaLaBase(tx, "nota de crédito sin asociado", alta({ tipo: "NOTA_CREDITO_B", codigoArca: 8 }), "nota de credito");
    await violaLaBase(tx, "factura de una venta anulada", async () => {
      const anulada = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
      await anularVentaEnTx(tx, anulada);
      await tx.comprobante.create({ data: crudo(anulada, { numero: 960 }) });
    }, "venta anulada");
    await violaLaBase(tx, "DNI del cliente con puntos", () => tx.cliente.update({ where: { id: t.final.id }, data: { dni: "12.345.678" } }), "clientes_dni_check");

    await tx.comprobante.delete({ where: { id: pend.id } }); // libera la venta (es SIMULADO)

    console.log("  Índices únicos parciales");
    const vigente = await emitirFacturaEnTx(tx, libre, null, { emisor: simulado(tx) });
    comprobar("(la venta libre ahora tiene factura)", vigente.estado, "EMITIDO");
    await violaLaBase(tx, "segunda factura vigente de la misma venta", () => tx.comprobante.create({ data: crudo(libre, { numero: 970 }) }), "comprobantes_factura_vigente_por_venta_key");
    const otra = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
    await violaLaBase(tx, "número vigente repetido en la serie", () => tx.comprobante.create({ data: crudo(otra, { numero: vigente.numero }) }), "comprobantes_numero_vigente_key");
    await laBaseAcepta(tx, "el mismo número en otra serie (punto de venta)", () => tx.comprobante.create({ data: crudo(otra, { numero: vigente.numero, puntoVenta: PV + 1 }) }));
    await laBaseAcepta(tx, "el mismo número en otro ambiente", () => tx.comprobante.create({ data: crudo(otra, { numero: vigente.numero, ambiente: "HOMOLOGACION" }) }));
    await violaLaBase(tx, "dos PENDIENTE en la misma serie", async () => {
      const otra2 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
      await tx.comprobante.create({ data: crudo(otra, { numero: 980 }) });
      await tx.comprobante.create({ data: crudo(otra2, { numero: 981 }) });
    }, "comprobantes_un_pendiente_por_serie_key");
    await laBaseAcepta(tx, "un RECHAZADO no ocupa el número", async () => {
      const r = await tx.comprobante.create({ data: crudo(otra, { numero: 990 }) });
      await tx.comprobante.update({ where: { id: r.id }, data: { estado: "RECHAZADO", observaciones: "x" } });
      const otra2 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
      await tx.comprobante.create({ data: crudo(otra2, { numero: 990 }) });
    });

    console.log("  Notas de crédito");
    const nc = (extra: Record<string, unknown> = {}) =>
      crudo(libre, { tipo: "NOTA_CREDITO_B", codigoArca: 8, numero: 1, comprobanteAsociadoId: vigente.id, ...extra });
    await violaLaBase(tx, "NC de otra letra", () => tx.comprobante.create({ data: nc({ tipo: "NOTA_CREDITO_A", codigoArca: 3, receptorCondicionIva: "RESPONSABLE_INSCRIPTO", receptorDocTipo: 80, receptorDocNro: CUIT_RI }) }), "misma venta, ambiente y letra");
    await violaLaBase(tx, "NC de otra venta", () => tx.comprobante.create({ data: nc({ ventaId: otra }) }), "misma venta, ambiente y letra");
    await violaLaBase(tx, "NC de otro ambiente", () => tx.comprobante.create({ data: nc({ ambiente: "HOMOLOGACION" }) }), "misma venta, ambiente y letra");
    await violaLaBase(tx, "NC de una factura PENDIENTE", async () => {
      const otra3 = await venta(tx, t.final.id, [{ articuloId: t.x.id, cantidad: 1 }]);
      const p = await tx.comprobante.create({ data: crudo(otra3, { numero: 995 }) });
      await tx.comprobante.create({ data: crudo(otra3, { tipo: "NOTA_CREDITO_B", codigoArca: 8, numero: 1, comprobanteAsociadoId: p.id }) });
    }, "misma venta, ambiente y letra");
    await violaLaBase(tx, "NC de una NC", async () => {
      const n1 = await tx.comprobante.create({ data: { ...nc(), items: { create: [linea] }, alicuotas: { create: [alicuota21] } } });
      await tx.comprobante.update({ where: { id: n1.id }, data: { estado: "EMITIDO", cae: "71234567890123", caeVencimiento: f("2099-01-01") } });
      await tx.comprobante.create({ data: nc({ numero: 2, comprobanteAsociadoId: n1.id }) });
    }, "misma venta, ambiente y letra");
    await violaLaBase(tx, "dos NC vigentes de la misma factura", async () => {
      await tx.comprobante.create({ data: nc() });
      await tx.comprobante.update({ where: { id: (await tx.comprobante.findFirstOrThrow({ where: { comprobanteAsociadoId: vigente.id } })).id }, data: { estado: "EMITIDO", cae: "71234567890123", caeVencimiento: f("2099-01-01") } });
      await tx.comprobante.create({ data: nc({ numero: 2 }) });
    }, "comprobantes_nc_vigente_por_factura_key");
    await laBaseAcepta(tx, "con la NC EMITIDA, la venta se puede anular", async () => {
      const n1 = await tx.comprobante.create({ data: { ...nc(), items: { create: [linea] }, alicuotas: { create: [alicuota21] } } });
      await violaLaBase(tx, "  (mientras la NC está PENDIENTE, no)", () => anularVentaEnTx(tx, libre), "nota de credito");
      await tx.comprobante.update({ where: { id: n1.id }, data: { estado: "EMITIDO", cae: "71234567890123", caeVencimiento: f("2099-01-01") } });
      await anularVentaEnTx(tx, libre);
    });

    console.log("  Borrado y controles diferidos");
    await violaLaBase(tx, "borrar un comprobante de HOMOLOGACION", async () => {
      const h = await tx.comprobante.create({ data: crudo(otra, { numero: 5, ambiente: "HOMOLOGACION" }) });
      await tx.comprobante.delete({ where: { id: h.id } });
    }, "no se borra");
    await violaLaBase(tx, "borrar una venta con comprobantes", () => tx.venta.delete({ where: { id: v } }));
    await violaLaBase(tx, "líneas que no suman el total", async () => {
      await tx.comprobante.create({ data: { ...crudo(otra, { numero: 996, puntoVenta: PV + 2 }), items: { create: [{ ...linea, subtotalNeto: d(99), subtotalIva: d(21), subtotalBruto: d(120), precioUnitario: d(120) }] }, alicuotas: { create: [alicuota21] } } });
      await controlesDiferidos(tx);
    }, "no suman el total");
    await violaLaBase(tx, "alícuotas que no suman el neto", async () => {
      await tx.comprobante.create({ data: { ...crudo(otra, { numero: 997, puntoVenta: PV + 2 }), items: { create: [linea] }, alicuotas: { create: [{ ...alicuota21, baseImponible: d(99) }] } } });
      await controlesDiferidos(tx);
    }, "no cierran");
    await violaLaBase(tx, "B sin alícuotas", async () => {
      await tx.comprobante.create({ data: { ...crudo(otra, { numero: 998, puntoVenta: PV + 2 }), items: { create: [linea] } } });
      await controlesDiferidos(tx);
    }, "no cierran");
    await violaLaBase(tx, "C con alícuotas", async () => {
      await tx.comprobante.create({
        data: {
          ...crudo(otra, { numero: 999, puntoVenta: PV + 2, tipo: "FACTURA_C", codigoArca: 11, emisorCondicionIva: "MONOTRIBUTO", importeNeto: d(121), importeIva: d(0) }),
          items: { create: [linea] },
          alicuotas: { create: [{ ...alicuota21, baseImponible: d(121), importe: d(0), alicuotaPct: d(0), codigoArca: 3 }] },
        },
      });
      await controlesDiferidos(tx);
    }, "no discrimina IVA");
    await violaLaBase(tx, "comprobante sin líneas", async () => {
      await tx.comprobante.create({ data: { ...crudo(otra, { numero: 1000, puntoVenta: PV + 2 }), alicuotas: { create: [alicuota21] } } });
      await controlesDiferidos(tx);
    }, "no suman el total");
    await violaLaBase(tx, "alícuota con código que no es el suyo", () => tx.comprobante.create({ data: { ...crudo(otra, { numero: 1001, puntoVenta: PV + 2 }), alicuotas: { create: [{ ...alicuota21, codigoArca: 4 }] } } }), "comprobante_iva_alicuota_check");
    await violaLaBase(tx, "línea con bruto ≠ neto + IVA", () => tx.comprobante.create({ data: { ...crudo(otra, { numero: 1002, puntoVenta: PV + 2 }), items: { create: [{ ...linea, subtotalBruto: d(122) }] } } }), "comprobante_items_importes_check");
    await violaLaBase(tx, "línea con cantidad 0", () => tx.comprobante.create({ data: { ...crudo(otra, { numero: 1003, puntoVenta: PV + 2 }), items: { create: [{ ...linea, cantidad: d(0) }] } } }), "comprobante_items_cantidad_check");
    await laBaseAcepta(tx, "uno bien armado pasa los controles diferidos", async () => {
      await tx.comprobante.create({ data: { ...crudo(otra, { numero: 1004, puntoVenta: PV + 3 }), items: { create: [linea] }, alicuotas: { create: [alicuota21] } } });
      await controlesDiferidos(tx);
    });
    await violaLaBase(tx, "FK: usuario inexistente", () => tx.comprobante.create({ data: crudo(otra, { numero: 1005, puntoVenta: PV + 4, usuarioId: "00000000-0000-4000-8000-0000000000dd" }) }));
    await violaLaBase(tx, "RESTRICT: no se borra un usuario con comprobantes", async () => {
      const r = await emitirFacturaEnTx(tx, otra, t.usuario.id, { emisor: simulado(tx) });
      comprobar("  (emitida con usuario)", r.estado, "EMITIDO");
      await tx.usuario.delete({ where: { id: t.usuario.id } });
    });
  });

  await concurrencia();

  const despues = await contarTodo(prisma);
  comprobar("la base quedó como estaba (sin rastro)", JSON.stringify(despues), JSON.stringify(antes));

  await prisma.$disconnect();
  if (fallos > 0) {
    console.log(`\n${fallos} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("\nTodo OK.");
}

type Cuentas = Record<string, number | string>;
async function contarTodo(cliente: PrismaClient): Promise<Cuentas> {
  const [comprobantes, items, alicuotas, ventas, ventaItems, clientes, articulos, usuarios, config] = await Promise.all([
    cliente.comprobante.count(),
    cliente.comprobanteItem.count(),
    cliente.comprobanteIva.count(),
    cliente.venta.count(),
    cliente.ventaItem.count(),
    cliente.cliente.count(),
    cliente.articulo.count(),
    cliente.usuario.count(),
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
    configuracion: JSON.stringify(config.map((c) => [c.clave, c.valor])),
  };
}

// ─── Concurrencia (transacciones reales) ──────────────────────────────────────

const ANIO_FICTICIO = f("2099-06-15");
const PREFIJO = "ZZ prueba comprobantes concurrencia";
const PV_CONCURRENCIA = 4399;
let configuracionOriginal: { clave: string; valor: string }[] | null = null;

/** Borra lo que crea la concurrencia y restaura la configuracion fiscal. */
async function limpiarConcurrencia() {
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
  if (configuracionOriginal) {
    await prisma.configuracion.deleteMany({ where: { clave: { startsWith: "fiscal" } } });
    for (const c of configuracionOriginal) await prisma.configuracion.create({ data: c });
  }
}

async function concurrencia() {
  console.log("--- Concurrencia (transacciones reales, ventas de 2099, se limpia al terminar) ---");
  const b = nuevoCliente();
  configuracionOriginal = await prisma.configuracion.findMany({ where: { clave: { startsWith: "fiscal" } } });
  try {
    await limpiarConcurrencia(); // restos de una corrida interrumpida
    await prisma.$transaction((tx) => configurarFiscal(tx, { puntoVenta: String(PV_CONCURRENCIA) }));
    const articulo = await prisma.articulo.create({ data: { nombre: `${PREFIJO} X`, precioVenta: d(1210), ivaPct: d(21), esServicio: true } });
    const cliente = await prisma.cliente.create({ data: { nombre: `${PREFIJO} cliente` } });
    const nuevaVenta = () => prisma.$transaction((tx) => venta(tx, cliente.id, [{ articuloId: articulo.id, cantidad: 1 }], ANIO_FICTICIO));
    const emisorGlobal = crearEmisorSimulado(accesoSimulado(prisma));
    const vigentes = (ventaId: string) =>
      prisma.comprobante.count({ where: { ventaId, tipo: "FACTURA_B", estado: { in: ["PENDIENTE", "EMITIDO"] } } });

    // 1. Una sola transaccion (simulador): cuatro intentos simultaneos de la misma venta.
    for (const ronda of [1, 2, 3]) {
      const v = await nuevaVenta();
      const intento = (db: PrismaClient) =>
        db.$transaction((tx) => emitirFacturaEnTx(tx, v, null, { emisor: crearEmisorSimulado(accesoSimulado(tx)) }), { timeout: 30_000 });
      const res = await Promise.allSettled([intento(prisma), intento(b), intento(prisma), intento(b)]);
      const ok = res.filter((r) => r.status === "fulfilled");
      const malos = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      comprobar(`misma venta, una transacción (${ronda}): una sola emitida`, String(ok.length), "1");
      comprobar(
        `misma venta, una transacción (${ronda}): las otras con error claro`,
        String(malos.length === 3 && malos.every((r) => r.reason instanceof ErrorDeNegocio && r.reason.message.includes("ya está facturada"))),
        "true",
      );
      comprobar(`misma venta, una transacción (${ronda}): una factura vigente`, String(await vigentes(v)), "1");
    }

    // 2. Dos fases: dos intentos simultaneos de la misma venta.
    for (const ronda of [1, 2, 3]) {
      const v = await nuevaVenta();
      const res = await Promise.allSettled([
        emitirFactura(prisma, v, null, { emisor: emisorGlobal }),
        emitirFactura(b, v, null, { emisor: crearEmisorSimulado(accesoSimulado(b)) }),
      ]);
      const ok = res.filter((r): r is PromiseFulfilledResult<ComprobanteProcesado> => r.status === "fulfilled");
      const malos = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      comprobar(`misma venta, dos fases (${ronda}): una sola emitida`, ok.map((r) => r.value.estado).join(","), "EMITIDO");
      comprobar(
        `misma venta, dos fases (${ronda}): la otra con error claro`,
        String(
          malos.length === 1 &&
            malos[0]!.reason instanceof ErrorDeNegocio &&
            /ya está facturada|esperando respuesta del emisor/.test(malos[0]!.reason.message),
        ),
        "true",
      );
      comprobar(`misma venta, dos fases (${ronda}): una factura vigente`, String(await vigentes(v)), "1");
    }

    // 3. Ventas distintas a la vez, en una sola transaccion: esperan el lock y numeran sin huecos.
    const ventas = await Promise.all([1, 2, 3, 4, 5].map(() => nuevaVenta()));
    const emitidas = await Promise.all(
      ventas.map((v, k) =>
        (k % 2 ? b : prisma).$transaction((tx) => emitirFacturaEnTx(tx, v, null, { emisor: crearEmisorSimulado(accesoSimulado(tx)) }), { timeout: 30_000 }),
      ),
    );
    const numeros = (await prisma.comprobante.findMany({ where: { puntoVenta: PV_CONCURRENCIA, ambiente: "SIMULADO", tipo: "FACTURA_B", estado: "EMITIDO" }, select: { numero: true } }))
      .map((c) => c.numero)
      .sort((p, q) => p - q);
    comprobar("ventas distintas a la vez: todas emitidas", emitidas.map((e) => e.estado).join(","), "EMITIDO,EMITIDO,EMITIDO,EMITIDO,EMITIDO");
    comprobar("numeración de la serie sin repetidos ni huecos", numeros.join(","), Array.from({ length: numeros.length }, (_, k) => k + 1).join(","));

    // 4. Corte en dos fases: el PENDIENTE sobrevive (esta confirmado) y se resuelve despues.
    const vCorte = await nuevaVenta();
    const cortado = await emitirFactura(prisma, vCorte, null, { emisor: crearEmisorSimulado(accesoSimulado(prisma), { cortar: () => true }) });
    comprobar("corte: queda PENDIENTE", cortado.estado, "PENDIENTE");
    const guardado = await prisma.comprobante.findUniqueOrThrow({ where: { id: cortado.id } });
    comprobar("corte: el PENDIENTE quedó confirmado en la base con su número", `${guardado.estado} ${guardado.numero}`, `PENDIENTE ${numeros.length + 1}`);
    const vOtra = await nuevaVenta();
    await rechaza("con el PENDIENTE, otra venta de la serie espera", "esperando respuesta del emisor", () => emitirFactura(prisma, vOtra, null, { emisor: emisorGlobal }));
    await rechaza("resolver un PENDIENTE recién creado: todavía no", "probá en unos minutos", () => resolverPendiente(prisma, cortado.id, emisorGlobal));
    const despues = new Date(guardado.creadoEn.getTime() + ANTIGUEDAD_MINIMA_PENDIENTE_MS + 1000);
    const resuelto = await resolverPendiente(prisma, cortado.id, emisorGlobal, despues);
    comprobar("resolver: el simulador no lo autorizó → RECHAZADO", `${resuelto.estado} ${resuelto.numero}`, `RECHAZADO ${numeros.length + 1}`);
    const otraVez = await emitirFactura(prisma, vCorte, null, { emisor: emisorGlobal });
    comprobar("reintento: EMITIDO con el mismo número", `${otraVez.estado} ${otraVez.numero}`, `EMITIDO ${numeros.length + 1}`);
    const siguiente = await emitirFactura(prisma, vOtra, null, { emisor: emisorGlobal });
    comprobar("y la serie sigue", `${siguiente.estado} ${siguiente.numero}`, `EMITIDO ${numeros.length + 2}`);

    // 5. Rechazo en dos fases: confirmado como RECHAZADO.
    const vRech = await nuevaVenta();
    const rech = await emitirFactura(prisma, vRech, null, { emisor: crearEmisorSimulado(accesoSimulado(prisma), { rechazar: () => ["[10016] prueba"] }) });
    comprobar("rechazo en dos fases: RECHAZADO confirmado", (await prisma.comprobante.findUniqueOrThrow({ where: { id: rech.id } })).estado, "RECHAZADO");

    // 6. Venta facturada de verdad (confirmada): no se anula.
    try {
      await prisma.$transaction((tx) => anularVentaEnTx(tx, vCorte));
      comprobar("anular una venta facturada (confirmada)", "anulada", "rechazada por la base");
    } catch (error) {
      comprobar("anular una venta facturada (confirmada)", String(error).includes("nota de credito") ? "rechazada por la base" : String(error), "rechazada por la base");
    }
  } catch (error) {
    fallos += 1;
    console.log("FALLA error inesperado en la concurrencia:", error);
  } finally {
    await limpiarConcurrencia();
    await b.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await limpiarConcurrencia();
  } catch {
    // nada mas que hacer
  }
  await prisma.$disconnect();
  process.exit(1);
});
