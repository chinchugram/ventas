/**
 * Prueba el registro de produccion (6.1) contra Postgres real, sin Next: alta del
 * trabajo, un solo vigente por linea, anulacion y recarga, snapshots de costo
 * congelados, CHECKs de la tabla, ajuste OPCIONAL de stock (explicito y sin doble
 * descuento) y las consultas de pantalla (sin costos en lo que ve el empleado).
 *
 *   npm run test:produccion:db
 *
 * Usa la base de DATABASE_URL. Los escenarios de dominio corren dentro de una
 * transaccion que se deshace al final. Las consultas leen con su propia conexion,
 * asi que el escenario de punta a punta confirma sus datos y los borra al terminar
 * (borrado fisico: son datos de prueba, no de negocio), tambien si falla.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { usarNegocioDePrueba } from "../src/lib/negocio";
import { d, type Dinero } from "../src/lib/money";
import { ErrorDeNegocio, fechaDesdeISO, hoyArgentinaISO } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import { registrarVentaEnTx, anularVentaEnTx } from "../src/lib/dominio/ventas";
import {
  ajustarStockDeTrabajoEnTx,
  anularTrabajoEnTx,
  cargarTrabajoEnTx,
  cargarTrabajoYAjustarEnTx,
  type TrabajoNuevo,
} from "../src/lib/dominio/produccion";
import { costoRealDeTrabajo, marcaDeLinea } from "../src/lib/produccion";
import { getLineaParaCarga, getListadoProduccion, getProduccionDeVenta, getTrabajoDetalle } from "../src/lib/queries/produccion";
import { estadoDemo } from "../src/lib/respaldo";

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

/** Espera que la base rechace la operacion por la restriccion `restriccion`. Aborta la transaccion: va ultima. */
async function violaRestriccion(etiqueta: string, restriccion: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "la base lo aceptó", `rechazado por ${restriccion}`);
  } catch (error) {
    comprobar(etiqueta, String(error).includes(restriccion) ? `rechazado por ${restriccion}` : String(error), `rechazado por ${restriccion}`);
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

/** Negocio de las pruebas: el de la migracion (`hl-laser`). Se resuelve al empezar `main`. */
let negocioId = "";
async function resolverNegocio() {
  negocioId = (
    await prisma.negocio.upsert({ where: { slug: "hl-laser" }, update: {}, create: { nombre: "HL Laser", slug: "hl-laser" }, select: { id: true } })
  ).id;
}

class Deshacer extends Error {}

/** Corre `fn` en una transaccion que siempre se deshace. */
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

const hoyISO = hoyArgentinaISO();
const hoy = fechaDesdeISO(hoyISO);
const HASH_DE_PRUEBA = `scrypt$ln=14,r=8,p=1$${"a".repeat(22)}$${"b".repeat(43)}`;
const azar = () => Math.random().toString(36).slice(2, 10);
const num = (v: Dinero | null | undefined) => (v ? v.toString() : "null");

/**
 * Escenario base: una venta de 4 unidades de un articulo con receta
 *   0,5 m2 de vinilo + 0,25 h de laser + 0,1 h de mano de obra, por unidad,
 * con vinilo a $100, laser a $600/h y mano de obra a $400/h. La venta descuenta 2 de
 * vinilo (stock 100 → 98). Sugerencia esperada: vinilo 2, laser 60 min, mano de obra 24 min.
 */
async function armar(tx: Tx, rotulo = `PRUEBA-PROD-${azar()}`, opciones: { servicio?: boolean; stock?: string } = {}) {
  const usuario = await tx.usuario.create({
    data: { negocioId, usuario: `zz-${azar()}`, nombre: `${rotulo} operario`, rol: "EMPLEADO", hashClave: HASH_DE_PRUEBA },
  });
  await tx.configuracion.upsert({
    where: { negocioId_clave: { negocioId, clave: "costoHoraManoObra" } },
    update: { valor: "400" },
    create: { negocioId, clave: "costoHoraManoObra", valor: "400" },
  });
  const vinilo = await tx.material.create({
    data: { negocioId, nombre: `${rotulo} vinilo`, unidad: "M2", stockActual: d(opciones.stock ?? "100"), costoUnitario: d(100) },
  });
  const tinta = await tx.material.create({ data: { negocioId, nombre: `${rotulo} tinta`, unidad: "L", stockActual: d(50), costoUnitario: d(250) } });
  const laser = await tx.maquina.create({ data: { negocioId, nombre: `${rotulo} laser`, costoHora: d(600) } });
  const plotter = await tx.maquina.create({ data: { negocioId, nombre: `${rotulo} plotter`, costoHora: d(300) } });
  const articulo = await tx.articulo.create({
    data: {
      negocioId,
      nombre: `${rotulo} cartel`,
      precioVenta: d(1000),
      ivaPct: d(21),
      esServicio: opciones.servicio ?? false,
      receta: {
        create: {
          negocioId,
          componentes: {
            create: [
              { negocioId, tipo: "MATERIAL", materialId: vinilo.id, cantidad: d("0.5") },
              { negocioId, tipo: "MAQUINA", maquinaId: laser.id, cantidad: d("0.25") },
              { negocioId, tipo: "MANO_OBRA", cantidad: d("0.1") },
            ],
          },
        },
      },
    },
  });
  const cliente = await tx.cliente.create({ data: { negocioId, nombre: `${rotulo} cliente` } });
  const venta = await registrarVentaEnTx(tx, negocioId, {
    clienteId: cliente.id,
    fecha: hoy,
    observaciones: null,
    entregada: false,
    items: [{ articuloId: articulo.id, cantidad: d(4) }],
    pago: null,
    usuarioId: usuario.id,
  });
  const item = await tx.ventaItem.findFirstOrThrow({ where: { ventaId: venta.id } });
  return { rotulo, usuario, vinilo, tinta, laser, plotter, articulo, cliente, venta, item };
}

type Base = Awaited<ReturnType<typeof armar>>;

/** Trabajo "tal como lo cargaria el empleado": 2,5 de vinilo, 90 min de laser, 30 de mano de obra. */
function trabajoDe(b: Base, cambios: Partial<TrabajoNuevo> = {}): TrabajoNuevo {
  return {
    ventaItemId: b.item.id,
    fecha: hoy,
    minutosManoObra: d(30),
    tiempos: [{ maquinaId: b.laser.id, minutos: d(90) }],
    consumos: [{ materialId: b.vinilo.id, cantidad: d("2.5") }],
    notas: null,
    usuarioId: b.usuario.id,
    ...cambios,
  };
}

const stockDe = async (tx: Tx, id: string) => (await tx.material.findUniqueOrThrow({ where: { id } })).stockActual.toString();
const ajustes = (tx: Tx, ventaItemId: string) =>
  tx.movimientoStock.findMany({ where: { tipo: "AJUSTE", motivo: { contains: marcaDeLinea(ventaItemId) } }, orderBy: { creadoEn: "asc" } });
const sumaAjustes = async (tx: Tx, ventaItemId: string, materialId: string) =>
  (await ajustes(tx, ventaItemId)).filter((m) => m.materialId === materialId).reduce((s, m) => s.plus(m.cantidad), d(0)).toString();

async function main() {
  await resolverNegocio();
  usarNegocioDePrueba(negocioId); // las consultas leen el negocio de la sesion: aca no hay pedido
  await escenario("Alta del trabajo: lo medido, los costos congelados y ningún movimiento de stock", async (tx) => {
    const b = await armar(tx);
    comprobar("la venta descontó la receta (100 − 2)", await stockDe(tx, b.vinilo.id), "98");
    const movimientosAntes = await tx.movimientoStock.count({ where: { materialId: b.vinilo.id } });

    const { id } = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { notas: "  Se rehízo una pieza  " }));
    const t = await tx.trabajoProduccion.findUniqueOrThrow({ where: { id }, include: { tiempos: true, consumos: true } });
    comprobar("línea", t.ventaItemId, b.item.id);
    comprobar("fecha", t.fecha.toISOString().slice(0, 10), hoyISO);
    comprobar("minutos de mano de obra", num(t.minutosManoObra), "30");
    comprobar("notas sin espacios sobrantes", String(t.notas), "Se rehízo una pieza");
    comprobar("quién lo cargó", String(t.usuarioId), b.usuario.id);
    comprobar("vigente (no anulado)", `${t.anuladoEn}/${t.motivoAnulacion}`, "null/null");
    comprobar("una fila de tiempo con sus minutos", t.tiempos.map((x) => `${x.maquinaId === b.laser.id}:${x.minutos}`).join(","), "true:90");
    comprobar("un consumo con su cantidad", t.consumos.map((x) => `${x.materialId === b.vinilo.id}:${x.cantidad}`).join(","), "true:2.5");
    comprobar("snapshot: costo/hora de la máquina", num(t.tiempos[0]?.costoHoraSnapshot), "600");
    comprobar("snapshot: costo unitario del material", num(t.consumos[0]?.costoUnitarioSnapshot), "100");
    comprobar("snapshot: costo/hora de mano de obra", num(t.costoHoraManoObraSnapshot), "400");
    comprobar("costo real = 250 + 900 + 200", costoRealDeTrabajo(t).toString(), "1350");

    comprobar("NO movió el stock del material", await stockDe(tx, b.vinilo.id), "98");
    comprobar("NO hay movimientos nuevos", String(await tx.movimientoStock.count({ where: { materialId: b.vinilo.id } })), String(movimientosAntes));
    comprobar("NO hay ajustes de la línea", String((await ajustes(tx, b.item.id)).length), "0");

    // Solo mano de obra, sin máquinas ni materiales: también vale.
    const b2 = await armar(tx);
    await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b2, { tiempos: [], consumos: [] }));
    comprobar("solo mano de obra se acepta", String(await tx.trabajoProduccion.count({ where: { ventaItemId: b2.item.id } })), "1");
    // Una fila en 0 es una decisión explícita ("no se usó").
    const b3 = await armar(tx);
    await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b3, { minutosManoObra: d(0), tiempos: [{ maquinaId: b3.laser.id, minutos: d(0) }], consumos: [] }));
    comprobar("una fila en cero se acepta", String(await tx.trabajoTiempo.count({ where: { trabajo: { ventaItemId: b3.item.id } } })), "1");
  });

  await escenario("Un solo trabajo vigente por línea; anular y recargar", async (tx) => {
    const b = await armar(tx);
    const primero = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b));
    await rechaza("segunda carga con uno vigente: error claro (no el del índice)", "ya tiene un trabajo cargado", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b)));
    comprobar("sigue habiendo uno solo", String(await tx.trabajoProduccion.count({ where: { ventaItemId: b.item.id } })), "1");

    await rechaza("anular sin motivo", "motivo", () => anularTrabajoEnTx(tx, negocioId, { trabajoId: primero.id, motivo: "   ", usuarioId: b.usuario.id }));
    await rechaza("anular un trabajo que no existe", "no existe", () =>
      anularTrabajoEnTx(tx, negocioId, { trabajoId: "00000000-0000-0000-0000-000000000000", motivo: "x" }),
    );
    await rechaza("motivo demasiado largo", "200", () => anularTrabajoEnTx(tx, negocioId, { trabajoId: primero.id, motivo: "x".repeat(201) }));

    const anulado = await anularTrabajoEnTx(tx, negocioId, { trabajoId: primero.id, motivo: "Medí mal el vinilo", usuarioId: b.usuario.id });
    comprobar("devuelve la línea para recargar", anulado.ventaItemId, b.item.id);
    const t1 = await tx.trabajoProduccion.findUniqueOrThrow({ where: { id: primero.id } });
    comprobar("baja lógica: no se borra", String(await tx.trabajoProduccion.count({ where: { id: primero.id } })), "1");
    comprobar("anuladoEn se completa", String(t1.anuladoEn instanceof Date), "true");
    comprobar("el motivo queda con quien anula", String(t1.motivoAnulacion), `Medí mal el vinilo (anulado por ${b.rotulo} operario)`);
    comprobar("trazabilidad: sigue figurando quien lo cargó", String(t1.usuarioId), b.usuario.id);
    comprobar("sus tiempos y consumos quedan de historial", `${await tx.trabajoTiempo.count({ where: { trabajoId: primero.id } })}/${await tx.trabajoConsumo.count({ where: { trabajoId: primero.id } })}`, "1/1");
    await rechaza("anular dos veces", "ya estaba anulado", () => anularTrabajoEnTx(tx, negocioId, { trabajoId: primero.id, motivo: "otra vez" }));

    const segundo = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: b.vinilo.id, cantidad: d("2.2") }] }));
    comprobar("recarga: ahora hay dos trabajos", String(await tx.trabajoProduccion.count({ where: { ventaItemId: b.item.id } })), "2");
    comprobar("recarga: uno solo vigente", String(await tx.trabajoProduccion.count({ where: { ventaItemId: b.item.id, anuladoEn: null } })), "1");
    comprobar("el vigente es el nuevo", (await tx.trabajoProduccion.findFirstOrThrow({ where: { ventaItemId: b.item.id, anuladoEn: null } })).id, segundo.id);
    await rechaza("otra carga con el nuevo vigente", "ya tiene un trabajo cargado", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b)));
  });

  await escenario("El dominio rechaza lo inválido con mensaje claro", async (tx) => {
    const b = await armar(tx);
    const cuantos = () => tx.trabajoProduccion.count({ where: { ventaItemId: b.item.id } });
    await rechaza("línea inexistente", "no existe", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { ventaItemId: "00000000-0000-0000-0000-000000000000" })));
    await rechaza("minutos de máquina negativos", "negativos", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { tiempos: [{ maquinaId: b.laser.id, minutos: d(-1) }] })));
    await rechaza("mano de obra negativa", "negativos", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { minutosManoObra: d(-5) })));
    await rechaza("cantidad negativa", "negativa", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: b.vinilo.id, cantidad: d(-1) }] })));
    await rechaza("máquina repetida", "repetida", () =>
      cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { tiempos: [{ maquinaId: b.laser.id, minutos: d(1) }, { maquinaId: b.laser.id, minutos: d(2) }] })),
    );
    await rechaza("material repetido", "repetido", () =>
      cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: b.vinilo.id, cantidad: d(1) }, { materialId: b.vinilo.id, cantidad: d(2) }] })),
    );
    await rechaza("sin nada cargado", "al menos", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { minutosManoObra: d(0), tiempos: [], consumos: [] })));
    await rechaza("notas demasiado largas", "500", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { notas: "x".repeat(501) })));
    await rechaza("máquina inexistente", "máquina", () =>
      cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { tiempos: [{ maquinaId: "00000000-0000-0000-0000-000000000000", minutos: d(1) }] })),
    );
    await rechaza("material inexistente", "material", () =>
      cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: "00000000-0000-0000-0000-000000000000", cantidad: d(1) }] })),
    );

    await tx.maquina.update({ where: { id: b.plotter.id }, data: { activo: false } });
    await rechaza("máquina dada de baja", "máquina", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { tiempos: [{ maquinaId: b.plotter.id, minutos: d(5) }] })));
    await tx.material.update({ where: { id: b.tinta.id }, data: { activo: false } });
    await rechaza("material dado de baja", "material", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: b.tinta.id, cantidad: d(1) }] })));
    comprobar("no quedó nada guardado", String(await cuantos()), "0");

    await anularVentaEnTx(tx, negocioId, b.venta.id, b.usuario.id);
    await rechaza("venta anulada", "anulada", () => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b)));
    comprobar("tampoco con la venta anulada", String(await cuantos()), "0");
  });

  await escenario("Los costos quedan congelados aunque cambien después", async (tx) => {
    const b = await armar(tx);
    const { id } = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b));
    const costoAlCargar = costoRealDeTrabajo(await tx.trabajoProduccion.findUniqueOrThrow({ where: { id }, include: { tiempos: true, consumos: true } }));
    comprobar("costo real al cargar", costoAlCargar.toString(), "1350");

    // Sube el vinilo, el laser y la mano de obra.
    await tx.material.update({ where: { id: b.vinilo.id }, data: { costoUnitario: d(500) } });
    await tx.maquina.update({ where: { id: b.laser.id }, data: { costoHora: d(2000) } });
    await tx.configuracion.update({ where: { negocioId_clave: { negocioId, clave: "costoHoraManoObra" } }, data: { valor: "1000" } });

    const t = await tx.trabajoProduccion.findUniqueOrThrow({ where: { id }, include: { tiempos: true, consumos: true } });
    comprobar("snapshot del material no cambió", num(t.consumos[0]?.costoUnitarioSnapshot), "100");
    comprobar("snapshot de la máquina no cambió", num(t.tiempos[0]?.costoHoraSnapshot), "600");
    comprobar("snapshot de la mano de obra no cambió", num(t.costoHoraManoObraSnapshot), "400");
    comprobar("el costo real del trabajo cargado no se reescribe", costoRealDeTrabajo(t).toString(), "1350");

    // Un trabajo cargado DESPUES toma los costos nuevos.
    await anularTrabajoEnTx(tx, negocioId, { trabajoId: id, motivo: "Recarga con costos nuevos" });
    const nuevo = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b));
    const t2 = await tx.trabajoProduccion.findUniqueOrThrow({ where: { id: nuevo.id }, include: { tiempos: true, consumos: true } });
    comprobar("la recarga congela los costos de ese momento", `${t2.consumos[0]?.costoUnitarioSnapshot}/${t2.tiempos[0]?.costoHoraSnapshot}/${t2.costoHoraManoObraSnapshot}`, "500/2000/1000");
    // 2,5×500 + 90/60×2000 + 30/60×1000 = 1250 + 3000 + 500
    comprobar("y el costo real sale con ellos", costoRealDeTrabajo(t2).toString(), "4750");
    comprobar("el anulado conserva los suyos", num((await tx.trabajoConsumo.findFirstOrThrow({ where: { trabajoId: id } })).costoUnitarioSnapshot), "100");
  });

  // Cada CHECK en su propio escenario: la violacion aborta la transaccion.
  for (const [titulo, restriccion, fn] of [
    ["minutos de mano de obra negativos", "trabajos_produccion_valores_check", (tx: Tx, b: Base) => tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy, minutosManoObra: d(-1) } })],
    ["costo/hora de mano de obra negativo", "trabajos_produccion_valores_check", (tx: Tx, b: Base) => tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy, costoHoraManoObraSnapshot: d(-1) } })],
    ["anulado sin motivo", "trabajos_produccion_anulacion_check", (tx: Tx, b: Base) => tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy, anuladoEn: new Date() } })],
    ["motivo sin anulación", "trabajos_produccion_anulacion_check", (tx: Tx, b: Base) => tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy, motivoAnulacion: "x" } })],
    ["motivo en blanco", "trabajos_produccion_anulacion_check", (tx: Tx, b: Base) => tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy, anuladoEn: new Date(), motivoAnulacion: "   " } })],
    ["minutos de máquina negativos", "trabajo_tiempos_valores_check", async (tx: Tx, b: Base) => {
      const t = await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      return tx.trabajoTiempo.create({ data: { negocioId, trabajoId: t.id, maquinaId: b.laser.id, minutos: d(-1) } });
    }],
    ["costo/hora de máquina negativo", "trabajo_tiempos_valores_check", async (tx: Tx, b: Base) => {
      const t = await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      return tx.trabajoTiempo.create({ data: { negocioId, trabajoId: t.id, maquinaId: b.laser.id, minutos: d(1), costoHoraSnapshot: d(-1) } });
    }],
    ["cantidad de consumo negativa", "trabajo_consumos_valores_check", async (tx: Tx, b: Base) => {
      const t = await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      return tx.trabajoConsumo.create({ data: { negocioId, trabajoId: t.id, materialId: b.vinilo.id, cantidad: d(-1) } });
    }],
    ["costo unitario de consumo negativo", "trabajo_consumos_valores_check", async (tx: Tx, b: Base) => {
      const t = await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      return tx.trabajoConsumo.create({ data: { negocioId, trabajoId: t.id, materialId: b.vinilo.id, cantidad: d(1), costoUnitarioSnapshot: d(-1) } });
    }],
    ["dos vigentes en la misma línea (índice único parcial)", "trabajos_produccion_vigente_key", async (tx: Tx, b: Base) => {
      await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      return tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
    }],
    ["una máquina dos veces en el mismo trabajo", "trabajo_tiempos_trabajoId_maquinaId_key", async (tx: Tx, b: Base) => {
      const t = await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      await tx.trabajoTiempo.create({ data: { negocioId, trabajoId: t.id, maquinaId: b.laser.id, minutos: d(1) } });
      return tx.trabajoTiempo.create({ data: { negocioId, trabajoId: t.id, maquinaId: b.laser.id, minutos: d(2) } });
    }],
    ["un material dos veces en el mismo trabajo", "trabajo_consumos_trabajoId_materialId_key", async (tx: Tx, b: Base) => {
      const t = await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      await tx.trabajoConsumo.create({ data: { negocioId, trabajoId: t.id, materialId: b.vinilo.id, cantidad: d(1) } });
      return tx.trabajoConsumo.create({ data: { negocioId, trabajoId: t.id, materialId: b.vinilo.id, cantidad: d(2) } });
    }],
    ["borrar una línea con trabajos (ON DELETE RESTRICT)", "trabajos_produccion_ventaItemId_fkey", async (tx: Tx, b: Base) => {
      await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
      return tx.ventaItem.delete({ where: { id: b.item.id } });
    }],
  ] as const) {
    await escenario(`CHECK/índice: ${titulo}`, async (tx) => {
      const b = await armar(tx);
      await violaRestriccion(titulo, restriccion, () => fn(tx, b));
    });
  }

  await escenario("CHECK/índice: anulados no cuentan para el índice único", async (tx) => {
    const b = await armar(tx);
    for (let i = 0; i < 3; i++) {
      await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy, anuladoEn: new Date(), motivoAnulacion: `intento ${i}` } });
    }
    await tx.trabajoProduccion.create({ data: { negocioId, ventaItemId: b.item.id, fecha: hoy } });
    comprobar("tres anulados y un vigente conviven", String(await tx.trabajoProduccion.count({ where: { ventaItemId: b.item.id } })), "4");
  });

  await escenario("Ajuste opcional de stock: sin casilla no se mueve nada", async (tx) => {
    const b = await armar(tx);
    // Real 2,5 contra receta 2: diferencia de 0,5. Sin pedir el ajuste, el stock queda como lo dejó la venta.
    const r = await cargarTrabajoYAjustarEnTx(tx, negocioId, trabajoDe(b), false);
    comprobar("sin ajuste: no hay filas ajustadas", String(r.ajustados.length), "0");
    comprobar("sin ajuste: stock igual", await stockDe(tx, b.vinilo.id), "98");
    comprobar("sin ajuste: sin movimientos AJUSTE", String((await ajustes(tx, b.item.id)).length), "0");
  });

  await escenario("Ajuste opcional de stock: explícito, por la diferencia y sin doble descuento", async (tx) => {
    const b = await armar(tx);
    const { id } = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b)); // real 2,5 vs receta 2
    comprobar("antes de ajustar el stock es el de la venta", await stockDe(tx, b.vinilo.id), "98");

    const r = await ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: id, usuarioId: b.usuario.id });
    comprobar("un material ajustado", String(r.ajustados.length), "1");
    comprobar("movimiento = −(real − receta)", num(r.ajustados[0]?.movimiento), "-0.5");
    comprobar("el stock baja la diferencia (98 − 0,5)", await stockDe(tx, b.vinilo.id), "97.5");
    const [mov] = await ajustes(tx, b.item.id);
    comprobar("movimiento de tipo AJUSTE", String(mov?.tipo), "AJUSTE");
    comprobar("cantidad con signo", num(mov?.cantidad), "-0.5");
    comprobar("stock resultante", num(mov?.stockResultante), "97.5");
    comprobar("referencia la venta (número)", String(mov?.motivo?.includes(`#${b.venta.numero}/${b.venta.anio}`)), "true");
    comprobar("referencia la línea (marca)", String(mov?.motivo?.includes(marcaDeLinea(b.item.id))), "true");
    comprobar("a nombre de quien ajustó", String(mov?.usuarioId), b.usuario.id);

    await rechaza("segundo ajuste sin cambios: nunca doble descuento", "ya está ajustado", () =>
      ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: id, usuarioId: b.usuario.id }),
    );
    comprobar("el stock sigue igual", await stockDe(tx, b.vinilo.id), "97.5");
    comprobar("un solo movimiento", String((await ajustes(tx, b.item.id)).length), "1");

    // Corrección: anular y recargar con 3 (diferencia 1). Ya se ajustó −0,5: solo faltan −0,5.
    await anularTrabajoEnTx(tx, negocioId, { trabajoId: id, motivo: "Medí de nuevo" });
    comprobar("anular no toca el stock", await stockDe(tx, b.vinilo.id), "97.5");
    const nuevo = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: b.vinilo.id, cantidad: d(3) }] }));
    comprobar("recargar tampoco", await stockDe(tx, b.vinilo.id), "97.5");
    const r2 = await ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: nuevo.id });
    comprobar("recarga: solo la diferencia nueva", num(r2.ajustados[0]?.movimiento), "-0.5");
    comprobar("stock = 100 − 2 (receta) − 1 (diferencia real)", await stockDe(tx, b.vinilo.id), "97");
    comprobar("en total, −(real − receta)", await sumaAjustes(tx, b.item.id, b.vinilo.id), "-1");

    // Corrección a la baja: se recarga igual a la receta → devuelve lo ajustado.
    await anularTrabajoEnTx(tx, negocioId, { trabajoId: nuevo.id, motivo: "Era lo de la receta" });
    const tercero = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: b.vinilo.id, cantidad: d(2) }] }));
    const r3 = await ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: tercero.id });
    comprobar("devuelve lo ajustado de más", num(r3.ajustados[0]?.movimiento), "1");
    comprobar("el stock vuelve a lo que dejó la venta", await stockDe(tx, b.vinilo.id), "98");
    comprobar("neto de ajustes en cero", await sumaAjustes(tx, b.item.id, b.vinilo.id), "0");
    await rechaza("y ya no hay nada más que ajustar", "ya está ajustado", () => ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: tercero.id }));
  });

  await escenario("Ajuste opcional de stock: cargar y ajustar en la misma operación", async (tx) => {
    const b = await armar(tx);
    const r = await cargarTrabajoYAjustarEnTx(tx, negocioId, trabajoDe(b, { consumos: [{ materialId: b.vinilo.id, cantidad: d("1.5") }] }), true);
    comprobar("se ajustó el material", String(r.ajustados.length), "1");
    comprobar("se usó menos que la receta: el stock sube 0,5", await stockDe(tx, b.vinilo.id), "98.5");
    comprobar("el trabajo quedó cargado", String(await tx.trabajoProduccion.count({ where: { id: r.id, anuladoEn: null } })), "1");

    // Real igual a la receta: nada que ajustar → error claro y TODO se deshace (aca, el trabajo nuevo no se crea).
    const b2 = await armar(tx);
    await rechaza("consumo igual a la receta: no hay nada que ajustar", "coincide con la receta", () =>
      cargarTrabajoYAjustarEnTx(tx, negocioId, trabajoDe(b2, { consumos: [{ materialId: b2.vinilo.id, cantidad: d(2) }] }), true),
    );
  });

  await escenario("Ajuste opcional de stock: casos límite", async (tx) => {
    // Stock que no alcanza: no se ajusta nada.
    const b = await armar(tx, undefined, { stock: "2" }); // la venta deja el vinilo en 0
    comprobar("la venta dejó el stock en 0", await stockDe(tx, b.vinilo.id), "0");
    const { id } = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b)); // 0,5 de más
    await rechaza("el stock no alcanza para descontar", "no alcanza", () => ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: id }));
    comprobar("no se ajustó nada", `${await stockDe(tx, b.vinilo.id)}/${(await ajustes(tx, b.item.id)).length}`, "0/0");

    // Un material fuera de la receta y otro de la receta no cargado.
    const c = await armar(tx);
    const t = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(c, { consumos: [{ materialId: c.tinta.id, cantidad: d("1.2") }] }));
    const r = await ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: t.id });
    comprobar("material fuera de la receta: baja todo lo usado", `${num(r.ajustados[0]?.movimiento)}`, "-1.2");
    comprobar("tinta: 50 − 1,2", await stockDe(tx, c.tinta.id), "48.8");
    comprobar("el vinilo no cargado no se tocó", await stockDe(tx, c.vinilo.id), "98");

    // Un trabajo anulado no se ajusta; sin materiales tampoco; venta anulada tampoco.
    await anularTrabajoEnTx(tx, negocioId, { trabajoId: t.id, motivo: "x" });
    await rechaza("trabajo anulado", "anulado", () => ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: t.id }));
    const e = await armar(tx);
    const sinMateriales = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(e, { consumos: [] }));
    await rechaza("sin materiales cargados", "no tiene materiales", () => ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: sinMateriales.id }));
    const f = await armar(tx);
    const deVentaAnulada = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(f));
    await anularVentaEnTx(tx, negocioId, f.venta.id, f.usuario.id);
    await rechaza("venta anulada", "anulada", () => ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: deVentaAnulada.id }));
    await rechaza("trabajo inexistente", "no existe", () => ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: "00000000-0000-0000-0000-000000000000" }));

    // Un servicio no descontó stock al venderse: el ajuste baja todo lo usado.
    const s = await armar(tx, undefined, { servicio: true });
    comprobar("el servicio no descontó nada", await stockDe(tx, s.vinilo.id), "100");
    const ts = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(s));
    const rs = await ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: ts.id });
    comprobar("servicio: se ajusta lo usado completo", num(rs.ajustados[0]?.movimiento), "-2.5");
    comprobar("servicio: stock 100 − 2,5", await stockDe(tx, s.vinilo.id), "97.5");
  });

  await consultasDePuntaAPunta();
}

/**
 * Las consultas de pantalla con la base de verdad. Lee con otra conexion: confirma
 * sus datos y los borra al terminar. Mira solo lo de esta prueba (por rotulo).
 */
async function consultasDePuntaAPunta() {
  console.log("--- Consultas de pantalla, de punta a punta ---");
  const rotulo = `PRUEBA-PROD-Q-${Date.now()}`;
  const ids: { usuario: string[]; materiales: string[]; maquinas: string[]; articulos: string[]; clientes: string[]; ventas: string[]; items: string[] } = {
    usuario: [], materiales: [], maquinas: [], articulos: [], clientes: [], ventas: [], items: [],
  };

  try {
    const { b, ventaItemSinTrabajo, trabajo, ventaAnulada } = await prisma.$transaction(async (tx) => {
      const b = await armar(tx, rotulo);
      ids.usuario.push(b.usuario.id);
      ids.materiales.push(b.vinilo.id, b.tinta.id);
      ids.maquinas.push(b.laser.id, b.plotter.id);
      ids.articulos.push(b.articulo.id);
      ids.clientes.push(b.cliente.id);
      ids.ventas.push(b.venta.id);
      ids.items.push(b.item.id);

      // Una segunda venta (sin trabajo) y una tercera anulada, para el listado.
      const venta2 = await registrarVentaEnTx(tx, negocioId, { clienteId: b.cliente.id, fecha: hoy, observaciones: null, entregada: false, items: [{ articuloId: b.articulo.id, cantidad: d(1) }], pago: null });
      ids.ventas.push(venta2.id);
      const item2 = await tx.ventaItem.findFirstOrThrow({ where: { ventaId: venta2.id } });
      ids.items.push(item2.id);
      const venta3 = await registrarVentaEnTx(tx, negocioId, { clienteId: b.cliente.id, fecha: hoy, observaciones: null, entregada: false, items: [{ articuloId: b.articulo.id, cantidad: d(1) }], pago: null });
      ids.ventas.push(venta3.id);
      const item3 = await tx.ventaItem.findFirstOrThrow({ where: { ventaId: venta3.id } });
      ids.items.push(item3.id);
      await anularVentaEnTx(tx, negocioId, venta3.id);

      const trabajo = await cargarTrabajoEnTx(tx, negocioId, trabajoDe(b, { notas: "con notas" }));
      return { b, ventaItemSinTrabajo: item2.id, trabajo, ventaAnulada: item3.id };
    });

    // Listado
    const pendientes = await getListadoProduccion("pendientes", rotulo);
    comprobar("no cayó al respaldo de demostración", String(estadoDemo().activo), "false");
    comprobar("sin cargar: solo la línea sin trabajo (no la cargada ni la de venta anulada)", pendientes.lineas.map((l) => l.ventaItemId).join(","), ventaItemSinTrabajo);
    comprobar("sin cargar: sin trabajo", String(pendientes.lineas[0]?.trabajo), "null");
    const cargadas = await getListadoProduccion("cargadas", rotulo);
    comprobar("cargadas: la línea con trabajo vigente", cargadas.lineas.map((l) => l.ventaItemId).join(","), b.item.id);
    comprobar("cargadas: id del trabajo y quién lo cargó", `${cargadas.lineas[0]?.trabajo?.id === trabajo.id}/${cargadas.lineas[0]?.trabajo?.cargadoPor}`, `true/${rotulo} operario`);
    const todas = await getListadoProduccion("todas", rotulo);
    comprobar("todas: ambas, ninguna de venta anulada", todas.lineas.map((l) => l.ventaItemId).sort().join(","), [b.item.id, ventaItemSinTrabajo].sort().join(","));
    comprobar("no aparece la línea de una venta anulada", String(todas.lineas.some((l) => l.ventaItemId === ventaAnulada)), "false");
    comprobar("búsqueda por número de venta", (await getListadoProduccion("todas", String(b.venta.numero))).lineas.some((l) => l.ventaItemId === b.item.id) ? "encontrada" : "no", "encontrada");
    comprobar("búsqueda por artículo", String((await getListadoProduccion("todas", `${rotulo} cartel`)).lineas.length), "2");
    comprobar("búsqueda sin resultados", String((await getListadoProduccion("todas", "ZZZ-no-existe-ZZZ")).lineas.length), "0");
    comprobar("campos de una línea del listado", Object.keys(pendientes.lineas[0] ?? {}).sort().join(","), ["anio", "cantidad", "cliente", "descripcion", "fecha", "numero", "trabajo", "ventaId", "ventaItemId"].join(","));

    // Pantalla de carga: sugerencia de la receta, sin costos.
    const carga = await getLineaParaCarga(ventaItemSinTrabajo);
    comprobar("carga: línea encontrada", String(carga?.descripcion), `${rotulo} cartel`);
    comprobar("carga: sugerencia de máquina (0,25 h × 60 × 1)", `${carga?.sugerencia.maquinas.map((m) => `${m.maquinaId === b.laser.id}:${m.minutos}`)}`, "true:15");
    comprobar("carga: sugerencia de mano de obra (0,1 h × 60)", String(carga?.sugerencia.minutosManoObra), "6");
    comprobar("carga: sugerencia de material (0,5 × 1)", `${carga?.sugerencia.materiales.map((m) => `${m.materialId === b.vinilo.id}:${m.cantidad}`)}`, "true:0.5");
    comprobar("carga: sin trabajo vigente ni venta anulada", `${carga?.trabajoVigenteId}/${carga?.ventaAnulada}`, "null/false");
    comprobar("carga: catálogo solo activo", String(carga?.maquinas.some((m) => m.id === b.laser.id) && carga?.materiales.some((m) => m.id === b.vinilo.id)), "true");
    comprobar("carga: la línea ya cargada trae su trabajo vigente", String((await getLineaParaCarga(b.item.id))?.trabajoVigenteId), trabajo.id);
    comprobar("carga: la venta anulada se avisa", String((await getLineaParaCarga(ventaAnulada))?.ventaAnulada), "true");
    comprobar("carga: línea inexistente", String(await getLineaParaCarga("00000000-0000-0000-0000-000000000000")), "null");

    // Detalle
    const det = await getTrabajoDetalle(trabajo.id);
    comprobar("detalle: encontrado y vigente", `${det?.descripcion}/${det?.anuladoEn}`, `${rotulo} cartel/null`);
    comprobar("detalle: tiempos y mano de obra", `${det?.tiempos.map((t) => `${t.maquina}:${t.minutos}`)}|${det?.minutosManoObra}`, `${rotulo} laser:90|30`);
    comprobar("detalle: consumo real contra receta", `${det?.consumos.map((c) => `${c.real}/${c.receta}`)}`, "2.5/2");
    comprobar("detalle: diferencia y ajuste pendiente", `${det?.ajuste.map((f) => `${f.diferencia}/${f.movimiento}`)}`, "0.5/-0.5");
    comprobar("detalle: quién lo cargó", String(det?.cargadoPor), `${rotulo} operario`);
    comprobar("detalle: sin historial de anulados", String(det?.anulados.length), "0");

    // Nada de costos en lo que ve el empleado.
    for (const [nombre, valor] of [["listado", pendientes], ["carga", carga], ["detalle", det]] as const) {
      const json = JSON.stringify(valor);
      comprobar(`${nombre}: sin costos, márgenes ni snapshots`, String(/costo|margen|snapshot|precio/i.test(json.replace(/PRUEBA-PROD-Q-\d+ /g, ""))), "false");
    }

    // Estado por venta
    const porVenta = await getProduccionDeVenta(b.venta.id);
    comprobar("por venta: la línea figura cargada", `${porVenta?.length}/${porVenta?.[0]?.trabajoId === trabajo.id}`, "1/true");
    comprobar("por venta: sin cargar", String((await getProduccionDeVenta(ids.ventas[1]!))?.[0]?.trabajoId), "null");
    comprobar("por venta: anulada = null", String(await getProduccionDeVenta(ids.ventas[2]!)), "null");

    // Anular y recargar: el listado lo refleja y el detalle del anulado trae el motivo.
    await prisma.$transaction((tx) => anularTrabajoEnTx(tx, negocioId, { trabajoId: trabajo.id, motivo: "Se midió mal", usuarioId: b.usuario.id }));
    const tras = await getListadoProduccion("pendientes", rotulo);
    comprobar("tras anular, la línea vuelve a sin cargar", tras.lineas.map((l) => l.ventaItemId).sort().join(","), [b.item.id, ventaItemSinTrabajo].sort().join(","));
    const detAnulado = await getTrabajoDetalle(trabajo.id);
    comprobar("el detalle del anulado trae el motivo", String(detAnulado?.motivoAnulacion?.startsWith("Se midió mal")), "true");
    comprobar("y avisa que la línea ya no tiene vigente", String(detAnulado?.lineaTieneVigente), "false");
    const recargado = await prisma.$transaction((tx) => cargarTrabajoEnTx(tx, negocioId, trabajoDe(b)));
    const detNuevo = await getTrabajoDetalle(recargado.id);
    comprobar("recargado: figura el anulado en el historial", `${detNuevo?.anulados.length}/${detNuevo?.anulados[0]?.id === trabajo.id}`, "1/true");
  } finally {
    // Solo los datos de esta prueba (por id), en orden de dependencia.
    await prisma.$transaction([
      prisma.trabajoConsumo.deleteMany({ where: { trabajo: { ventaItemId: { in: ids.items } } } }),
      prisma.trabajoTiempo.deleteMany({ where: { trabajo: { ventaItemId: { in: ids.items } } } }),
      prisma.trabajoProduccion.deleteMany({ where: { ventaItemId: { in: ids.items } } }),
      prisma.movimientoStock.deleteMany({ where: { OR: [{ ventaId: { in: ids.ventas } }, { materialId: { in: ids.materiales } }] } }),
      prisma.ventaItem.deleteMany({ where: { ventaId: { in: ids.ventas } } }),
      prisma.venta.deleteMany({ where: { id: { in: ids.ventas } } }),
      prisma.articulo.deleteMany({ where: { id: { in: ids.articulos } } }),
      prisma.material.deleteMany({ where: { id: { in: ids.materiales } } }),
      prisma.maquina.deleteMany({ where: { id: { in: ids.maquinas } } }),
      prisma.cliente.deleteMany({ where: { id: { in: ids.clientes } } }),
      prisma.usuario.deleteMany({ where: { id: { in: ids.usuario } } }),
    ]);
    comprobar("sin rastro: no queda ningún trabajo de prueba", String(await prisma.trabajoProduccion.count({ where: { ventaItemId: { in: ids.items } } })), "0");
    comprobar("sin rastro: no queda ningún cliente de prueba", String(await prisma.cliente.count({ where: { nombre: { startsWith: rotulo } } })), "0");
    comprobar("sin rastro: no queda ningún material de prueba", String(await prisma.material.count({ where: { nombre: { startsWith: rotulo } } })), "0");
  }
}

main()
  .catch((error) => {
    console.error(error);
    fallos += 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log("");
    console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
    process.exit(fallos === 0 ? 0 : 1);
  });
