/**
 * Prueba los presupuestos contra Postgres real, sin Next:
 *
 *   npm run test:presupuestos:db
 *
 * Alta con lista de precios, numeracion, edicion (precios congelados), anulacion,
 * duplicado, conversion con precios congelados (el total de la venta es el del
 * presupuesto aunque el catalogo cambie), los casos en que NO se puede
 * convertir, los CHECK de la base, la trazabilidad (`usuarioId`: quien crea,
 * duplica y convierte; FK y RESTRICT) y la concurrencia.
 *
 * No deja rastro: los escenarios corren en una transaccion que se deshace al
 * final; la concurrencia necesita transacciones reales, asi que usa un anio
 * ficticio (2099), datos con un prefijo propio y los borra en un `finally`
 * (y verifica que los conteos de la base quedaron como estaban).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d, type Dinero } from "../src/lib/money";
import { ErrorDeNegocio, hoyArgentina } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import {
  anularPresupuestoEnTx,
  CLAVE_LOCK_PRESUPUESTOS,
  convertirPresupuestoEnTx,
  crearPresupuestoEnTx,
  duplicarPresupuestoEnTx,
  editarPresupuestoEnTx,
  type DatosPresupuesto,
} from "../src/lib/dominio/presupuestos";
import { totalizarPresupuesto } from "../src/lib/presupuestos";

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

const num = (v: Dinero) => v.toString();

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

/** Falla (violacion de CHECK / unique) sin abortar la transaccion del escenario: usa un savepoint. */
async function violaLaBase(tx: Tx, etiqueta: string, fn: () => Promise<unknown>) {
  await tx.$executeRaw`SAVEPOINT prueba`;
  try {
    await fn();
    comprobar(etiqueta, "se aceptó", "rechazada por la base");
  } catch {
    comprobar(etiqueta, "rechazada por la base", "rechazada por la base");
  }
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT prueba`;
}

const f = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dia = (base: Date, n: number) => new Date(base.getTime() + n * 86_400_000);
const HOY = hoyArgentina();
const AYER_LEJANO = dia(HOY, -40); // un presupuesto hecho hace 40 dias (15 de validez) esta vencido

type Prueba = Awaited<ReturnType<typeof preparar>>;

/**
 * Material M (stock 100). Articulos: X (receta: 2 M, catalogo 1210, IVA 21),
 * Y (servicio, 500) y Z (servicio, 1000). Lista "Mayoristas": 10% y X en 800.
 * Un cliente con la lista y otro sin lista.
 */
async function preparar(tx: Tx, prefijo = "Prueba presupuestos") {
  const material = await tx.material.create({
    data: { nombre: `${prefijo} material`, unidad: "U", stockActual: d(100), costoUnitario: d(100) },
  });
  const x = await tx.articulo.create({
    data: {
      nombre: `${prefijo} X`,
      precioVenta: d(1210),
      ivaPct: d(21),
      receta: { create: { componentes: { create: [{ tipo: "MATERIAL", materialId: material.id, cantidad: d(2) }] } } },
    },
  });
  const y = await tx.articulo.create({ data: { nombre: `${prefijo} Y`, precioVenta: d(500), esServicio: true } });
  const z = await tx.articulo.create({ data: { nombre: `${prefijo} Z`, precioVenta: d(1000), esServicio: true } });
  const lista = await tx.listaPrecio.create({
    data: {
      nombre: `${prefijo} mayoristas ${Math.random().toString(36).slice(2)}`,
      descuentoPct: d(10),
      items: { create: [{ articuloId: x.id, precio: d(800) }] },
    },
  });
  const conLista = await tx.cliente.create({ data: { nombre: `${prefijo} con lista`, telefono: "351 455-6677", listaPrecioId: lista.id } });
  const sinLista = await tx.cliente.create({ data: { nombre: `${prefijo} sin lista` } });
  return { material, x, y, z, lista, conLista, sinLista };
}

const datos = (clienteId: string, items: { articuloId: string; cantidad: number | string }[], extra: Partial<DatosPresupuesto> = {}): DatosPresupuesto => ({
  clienteId,
  validezDias: 15,
  observaciones: null,
  items: items.map((i) => ({ articuloId: i.articuloId, cantidad: d(i.cantidad) })),
  ...extra,
});

async function leer(tx: Tx, id: string) {
  const p = await tx.presupuesto.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const linea = (articuloId: string) => p.items.find((i) => i.articuloId === articuloId)!;
  const total = totalizarPresupuesto(p.items.map((i) => ({ cantidad: d(i.cantidad), precioUnitario: d(i.precioUnitario), ivaPct: d(i.ivaPct) }))).totalBruto;
  return { p, linea, total };
}

const HASH_DE_PRUEBA = `scrypt$ln=14,r=8,p=1$${"a".repeat(22)}$${"b".repeat(43)}`;

/** Usuario real de prueba (dentro de la transaccion del escenario: se deshace con ella). */
async function usuarioDePrueba(tx: Tx, nombre: string) {
  return tx.usuario.create({
    data: { usuario: `zz-${Math.random().toString(36).slice(2, 10)}`, nombre, rol: "EMPLEADO", hashClave: HASH_DE_PRUEBA },
  });
}

/** Crea el cliente, los articulos y el presupuesto base de varios escenarios. */
async function presupuestoBase(tx: Tx, prueba: Prueba, hoy = HOY) {
  const { id } = await crearPresupuestoEnTx(
    tx,
    datos(prueba.conLista.id, [
      { articuloId: prueba.x.id, cantidad: 2 },
      { articuloId: prueba.y.id, cantidad: 1 },
    ]),
    hoy,
  );
  return id;
}

async function main() {
  const antes = await contarTodo(prisma);

  await escenario("Alta: precios congelados con la lista del cliente", async (tx) => {
    const t = await preparar(tx);
    const r = await crearPresupuestoEnTx(
      tx,
      datos(t.conLista.id, [
        { articuloId: t.x.id, cantidad: 2 },
        { articuloId: t.y.id, cantidad: "1.5" },
        { articuloId: t.z.id, cantidad: 3 },
      ], { observaciones: "Entrega en 5 días" }),
      HOY,
    );
    const { p, linea, total } = await leer(tx, r.id);
    comprobar("estado inicial", p.estado, "ABIERTO");
    comprobar("validez", String(p.validezDias), "15");
    comprobar("fecha de hoy", p.fecha.toISOString().slice(0, 10), HOY.toISOString().slice(0, 10));
    comprobar("sin venta", String(p.ventaId), "null");
    comprobar("específico (X): 800", num(linea(t.x.id).precioUnitario), "800");
    comprobar("descuento general (Y): 500 − 10%", num(linea(t.y.id).precioUnitario), "450");
    comprobar("descuento general (Z): 1000 − 10%", num(linea(t.z.id).precioUnitario), "900");
    comprobar("descripción congelada", linea(t.x.id).descripcion, "Prueba presupuestos X");
    comprobar("IVA congelado", num(linea(t.x.id).ivaPct), "21");
    comprobar("cantidad decimal", num(linea(t.y.id).cantidad), "1.5");
    comprobar("total = 2×800 + 1,5×450 + 3×900", num(total), "4975");
    comprobar("observaciones", String(p.observaciones), "Entrega en 5 días");

    const sin = await crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.x.id, cantidad: 1 }]), HOY);
    comprobar("sin lista: catálogo", num((await leer(tx, sin.id)).linea(t.x.id).precioUnitario), "1210");

    comprobar("numeración correlativa", `${sin.numero - r.numero}`, "1");
    comprobar("mismo año", String(sin.anio === r.anio && r.anio === HOY.getUTCFullYear()), "true");

    const repetido = await crearPresupuestoEnTx(
      tx,
      datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }, { articuloId: t.y.id, cantidad: 2 }]),
      HOY,
    );
    const rep = await leer(tx, repetido.id);
    comprobar("artículo repetido: un renglón", String(rep.p.items.length), "1");
    comprobar("artículo repetido: suma cantidades", num(rep.linea(t.y.id).cantidad), "3");

    // Numeración por año: otro año arranca de 1.
    const otroAnio = await crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }]), f("2098-03-01"));
    comprobar("otro año arranca en 1", `${otroAnio.numero}/${otroAnio.anio}`, "1/2098");
  });

  await escenario("Alta: validaciones", async (tx) => {
    const t = await preparar(tx);
    const base = [{ articuloId: t.y.id, cantidad: 1 }];
    await rechaza("sin artículos", "al menos un artículo", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, []), HOY));
    await rechaza("cantidad 0", "mayor a 0", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 0 }]), HOY));
    await rechaza("cantidad con 4 decimales", "3 decimales", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: "1.2345" }]), HOY));
    await rechaza("validez 0", "validez", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, base, { validezDias: 0 }), HOY));
    await rechaza("validez enorme", "validez", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, base, { validezDias: 366 }), HOY));
    await rechaza("validez decimal", "validez", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, base, { validezDias: 1.5 }), HOY));
    await rechaza("cliente inexistente", "cliente", () =>
      crearPresupuestoEnTx(tx, datos("00000000-0000-4000-8000-0000000000aa", base), HOY),
    );
    await tx.cliente.update({ where: { id: t.sinLista.id }, data: { activo: false } });
    await rechaza("cliente de baja", "dado de baja", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, base), HOY));
    await tx.cliente.update({ where: { id: t.sinLista.id }, data: { activo: true } });
    await tx.articulo.update({ where: { id: t.y.id }, data: { activo: false } });
    await rechaza("artículo de baja", "dado de baja", () => crearPresupuestoEnTx(tx, datos(t.sinLista.id, base), HOY));
    await rechaza("artículo inexistente", "artículo", () =>
      crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: "00000000-0000-4000-8000-0000000000bb", cantidad: 1 }]), HOY),
    );
  });

  await escenario("CHECK de la base", async (tx) => {
    const t = await preparar(tx);
    const id = await presupuestoBase(tx, t);
    const venta = await tx.venta.create({
      data: { numero: 9_000_001, anio: 2097, clienteId: t.conLista.id, fecha: f("2097-01-01") },
    });
    await violaLaBase(tx, "validezDias = 0", () => tx.presupuesto.update({ where: { id }, data: { validezDias: 0 } }));
    await violaLaBase(tx, "validezDias negativa", () => tx.presupuesto.update({ where: { id }, data: { validezDias: -3 } }));
    await violaLaBase(tx, "CONVERTIDO sin venta", () => tx.presupuesto.update({ where: { id }, data: { estado: "CONVERTIDO" } }));
    await violaLaBase(tx, "ABIERTO con venta", () => tx.presupuesto.update({ where: { id }, data: { ventaId: venta.id } }));
    await violaLaBase(tx, "ANULADO con venta", () => tx.presupuesto.update({ where: { id }, data: { estado: "ANULADO", ventaId: venta.id } }));
    await violaLaBase(tx, "número 0", () => tx.presupuesto.update({ where: { id }, data: { numero: 0 } }));
    await violaLaBase(tx, "(año, número) repetido", async () => {
      const p = await tx.presupuesto.findUniqueOrThrow({ where: { id } });
      await tx.presupuesto.create({ data: { numero: p.numero, anio: p.anio, clienteId: p.clienteId, fecha: HOY } });
    });
    const item = (await tx.presupuestoItem.findFirstOrThrow({ where: { presupuestoId: id } })).id;
    await violaLaBase(tx, "cantidad 0", () => tx.presupuestoItem.update({ where: { id: item }, data: { cantidad: d(0) } }));
    await violaLaBase(tx, "precio negativo", () => tx.presupuestoItem.update({ where: { id: item }, data: { precioUnitario: d(-1) } }));
    await violaLaBase(tx, "IVA > 100", () => tx.presupuestoItem.update({ where: { id: item }, data: { ivaPct: d(101) } }));
    await violaLaBase(tx, "cliente inexistente", () =>
      tx.presupuesto.update({ where: { id }, data: { clienteId: "00000000-0000-4000-8000-0000000000cc" } }),
    );

    // Lo válido sí entra: precio 0 (regalo) y CONVERTIDO con venta.
    await tx.presupuestoItem.update({ where: { id: item }, data: { precioUnitario: d(0) } });
    comprobar("precio 0 es válido", num((await tx.presupuestoItem.findUniqueOrThrow({ where: { id: item } })).precioUnitario), "0");
    await tx.presupuesto.update({ where: { id }, data: { estado: "CONVERTIDO", ventaId: venta.id } });
    comprobar("CONVERTIDO con venta es válido", (await tx.presupuesto.findUniqueOrThrow({ where: { id } })).estado, "CONVERTIDO");
  });

  await escenario("Edición: líneas viejas conservan su precio, nuevas se resuelven, otro cliente reprecia", async (tx) => {
    const t = await preparar(tx);
    const id = await presupuestoBase(tx, t); // X ×2 a 800 y Y ×1 a 450 (cliente con lista)

    // El catálogo y la lista cambian después de armar el presupuesto.
    await tx.articulo.update({ where: { id: t.x.id }, data: { precioVenta: d(2000), nombre: "Prueba presupuestos X renombrado" } });
    await tx.listaPrecioItem.updateMany({ where: { listaPrecioId: t.lista.id, articuloId: t.x.id }, data: { precio: d(700) } });
    await tx.articulo.update({ where: { id: t.y.id }, data: { precioVenta: d(600) } });

    await editarPresupuestoEnTx(
      tx,
      id,
      datos(
        t.conLista.id,
        [
          { articuloId: t.x.id, cantidad: 5 }, // ya estaba: sigue a 800 (aunque hoy valga 700)
          { articuloId: t.y.id, cantidad: 1 }, // ya estaba: sigue a 450 (aunque hoy valga 540)
          { articuloId: t.z.id, cantidad: 1 }, // nueva: se resuelve hoy (1000 − 10%)
        ],
        { validezDias: 30, observaciones: "Editado" },
      ),
      HOY,
    );
    let e = await leer(tx, id);
    comprobar("X conserva 800 con otra cantidad", `${num(e.linea(t.x.id).precioUnitario)} × ${num(e.linea(t.x.id).cantidad)}`, "800 × 5");
    comprobar("X conserva la descripción congelada", e.linea(t.x.id).descripcion, "Prueba presupuestos X");
    comprobar("Y conserva 450", num(e.linea(t.y.id).precioUnitario), "450");
    comprobar("Z nueva a precio de hoy", num(e.linea(t.z.id).precioUnitario), "900");
    comprobar("validez y observaciones", `${e.p.validezDias} ${e.p.observaciones}`, "30 Editado");
    comprobar("misma fecha y número", String(e.p.fecha.getTime() === HOY.getTime()), "true");
    comprobar("total = 5×800 + 1×450 + 1×900", num(e.total), num(d(4000).plus(450).plus(900)));

    // Quitar una línea y volver a agregarla: como ya no estaba al guardar de nuevo, vuelve a resolverse.
    await editarPresupuestoEnTx(tx, id, datos(t.conLista.id, [{ articuloId: t.y.id, cantidad: 1 }]), HOY);
    comprobar("se quitaron las demás líneas", String((await leer(tx, id)).p.items.length), "1");
    await editarPresupuestoEnTx(
      tx,
      id,
      datos(t.conLista.id, [{ articuloId: t.y.id, cantidad: 1 }, { articuloId: t.x.id, cantidad: 1 }]),
      HOY,
    );
    e = await leer(tx, id);
    comprobar("X reincorporada: precio de hoy (700)", num(e.linea(t.x.id).precioUnitario), "700");
    comprobar("Y sigue congelada (450)", num(e.linea(t.y.id).precioUnitario), "450");

    // Cambiar el cliente reprecia todo, incluso lo que ya estaba.
    await editarPresupuestoEnTx(tx, id, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }, { articuloId: t.x.id, cantidad: 1 }]), HOY);
    e = await leer(tx, id);
    comprobar("otro cliente: Y a catálogo de hoy", num(e.linea(t.y.id).precioUnitario), "600");
    comprobar("otro cliente: X a catálogo de hoy", num(e.linea(t.x.id).precioUnitario), "2000");
    comprobar("otro cliente: descripción actual", e.linea(t.x.id).descripcion, "Prueba presupuestos X renombrado");
    comprobar("el cliente quedó cambiado", String(e.p.clienteId === t.sinLista.id), "true");

    await rechaza("sin artículos", "al menos un artículo", () => editarPresupuestoEnTx(tx, id, datos(t.sinLista.id, []), HOY));
    await rechaza("validez inválida", "validez", () => editarPresupuestoEnTx(tx, id, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }], { validezDias: 0 }), HOY));
    await rechaza("presupuesto inexistente", "no existe", () =>
      editarPresupuestoEnTx(tx, "00000000-0000-4000-8000-0000000000dd", datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }]), HOY),
    );
    // Una validez tan corta que lo dejaría vencido no se acepta.
    const viejo = await crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }]), dia(HOY, -10));
    await rechaza("validez que lo dejaría vencido", "vencido", () =>
      editarPresupuestoEnTx(tx, viejo.id, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }], { validezDias: 5 }), HOY),
    );
    await editarPresupuestoEnTx(tx, viejo.id, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }], { validezDias: 10 }), HOY);
    comprobar("validez justo hasta hoy: se acepta", String((await leer(tx, viejo.id)).p.validezDias), "10");

    // Una línea cuyo artículo se dio de baja después hay que quitarla para poder guardar.
    await editarPresupuestoEnTx(tx, id, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }, { articuloId: t.z.id, cantidad: 1 }]), HOY);
    await tx.articulo.update({ where: { id: t.z.id }, data: { activo: false } });
    await rechaza("línea cuyo artículo se dio de baja", "Quitalos", () =>
      editarPresupuestoEnTx(tx, id, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 2 }, { articuloId: t.z.id, cantidad: 1 }]), HOY),
    );
    await editarPresupuestoEnTx(tx, id, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 2 }]), HOY);
    comprobar("quitándola, guarda", num((await leer(tx, id)).linea(t.y.id).cantidad), "2");
  });

  await escenario("Edición: no se edita vencido, anulado ni convertido", async (tx) => {
    const t = await preparar(tx);
    const items = [{ articuloId: t.y.id, cantidad: 1 }];

    const vencido = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), AYER_LEJANO)).id;
    await rechaza("vencido", "venció", () => editarPresupuestoEnTx(tx, vencido, datos(t.sinLista.id, items), HOY));

    const anulado = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY)).id;
    await anularPresupuestoEnTx(tx, anulado);
    await rechaza("anulado", "anulado", () => editarPresupuestoEnTx(tx, anulado, datos(t.sinLista.id, items), HOY));

    const convertido = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY)).id;
    await convertirPresupuestoEnTx(tx, convertido, HOY);
    await rechaza("convertido", "ya se convirtió", () => editarPresupuestoEnTx(tx, convertido, datos(t.sinLista.id, items), HOY));
    comprobar("el vencido quedó intacto", String((await leer(tx, vencido)).p.items.length), "1");
  });

  await escenario("Anulación: baja lógica, no se borra", async (tx) => {
    const t = await preparar(tx);
    const id = await presupuestoBase(tx, t);
    await anularPresupuestoEnTx(tx, id);
    const a = await leer(tx, id);
    comprobar("estado ANULADO", a.p.estado, "ANULADO");
    comprobar("la fila y sus líneas siguen", String(a.p.items.length), "2");
    await rechaza("anular dos veces", "ya estaba anulado", () => anularPresupuestoEnTx(tx, id));
    await rechaza("convertir un anulado", "anulado", () => convertirPresupuestoEnTx(tx, id, HOY));
    await rechaza("anular uno inexistente", "no existe", () => anularPresupuestoEnTx(tx, "00000000-0000-4000-8000-0000000000ee"));

    // Un vencido sí se puede anular.
    const vencido = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }]), AYER_LEJANO)).id;
    await anularPresupuestoEnTx(tx, vencido);
    comprobar("vencido anulable", (await leer(tx, vencido)).p.estado, "ANULADO");

    // Uno convertido no: hay que anular la venta.
    const conv = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }]), HOY)).id;
    await convertirPresupuestoEnTx(tx, conv, HOY);
    await rechaza("anular un convertido", "anulá la venta", () => anularPresupuestoEnTx(tx, conv));
  });

  await escenario("Duplicado: presupuesto nuevo con precios de hoy", async (tx) => {
    const t = await preparar(tx);
    const origen = await crearPresupuestoEnTx(
      tx,
      datos(t.conLista.id, [{ articuloId: t.x.id, cantidad: 2 }, { articuloId: t.y.id, cantidad: 1 }], { validezDias: 20, observaciones: "Obs" }),
      AYER_LEJANO,
    );
    // El precio cambió desde entonces.
    await tx.listaPrecioItem.updateMany({ where: { listaPrecioId: t.lista.id, articuloId: t.x.id }, data: { precio: d(950) } });
    await tx.articulo.update({ where: { id: t.y.id }, data: { precioVenta: d(700) } });

    const copia = await duplicarPresupuestoEnTx(tx, origen.id, HOY);
    const c = await leer(tx, copia.id);
    comprobar("estado ABIERTO", c.p.estado, "ABIERTO");
    comprobar("número y fecha nuevos", String(copia.numero !== origen.numero && c.p.fecha.getTime() === HOY.getTime()), "true");
    comprobar("apunta al original", String(c.p.duplicadoDeId === origen.id), "true");
    comprobar("X con el precio específico de hoy", num(c.linea(t.x.id).precioUnitario), "950");
    comprobar("Y con el descuento sobre el catálogo de hoy (700 − 10%)", num(c.linea(t.y.id).precioUnitario), "630");
    comprobar("misma cantidad", num(c.linea(t.x.id).cantidad), "2");
    comprobar("misma validez y observaciones", `${c.p.validezDias} ${c.p.observaciones}`, "20 Obs");
    comprobar("mismo cliente", String(c.p.clienteId === t.conLista.id), "true");

    const o = await leer(tx, origen.id);
    comprobar("el original no cambió (precio)", num(o.linea(t.x.id).precioUnitario), "800");
    comprobar("el original sigue ABIERTO (vencido se calcula)", o.p.estado, "ABIERTO");

    // Se puede duplicar un anulado o un convertido.
    await anularPresupuestoEnTx(tx, origen.id);
    const deAnulado = await duplicarPresupuestoEnTx(tx, origen.id, HOY);
    comprobar("duplicar un anulado", (await leer(tx, deAnulado.id)).p.estado, "ABIERTO");

    await rechaza("duplicar inexistente", "no existe", () => duplicarPresupuestoEnTx(tx, "00000000-0000-4000-8000-0000000000ff", HOY));
    await tx.cliente.update({ where: { id: t.conLista.id }, data: { activo: false } });
    await rechaza("duplicar con el cliente de baja", "dado de baja", () => duplicarPresupuestoEnTx(tx, origen.id, HOY));
    await tx.cliente.update({ where: { id: t.conLista.id }, data: { activo: true } });
    await tx.articulo.update({ where: { id: t.x.id }, data: { activo: false } });
    await rechaza("duplicar con un artículo de baja", "Quitalos", () => duplicarPresupuestoEnTx(tx, origen.id, HOY));
  });

  await escenario("Conversión: precios congelados, sin pago y no entregada", async (tx) => {
    const t = await preparar(tx);
    const id = await presupuestoBase(tx, t, HOY);
    const antesTotal = (await leer(tx, id)).total; // 2×800 + 450 = 2050
    comprobar("total del presupuesto", num(antesTotal), "2050");

    // El catálogo, la lista, el IVA y hasta el nombre cambian después.
    await tx.articulo.update({ where: { id: t.x.id }, data: { precioVenta: d(5000), nombre: "Otro nombre" } });
    await tx.articulo.update({ where: { id: t.y.id }, data: { precioVenta: d(9000) } });
    await tx.listaPrecio.update({ where: { id: t.lista.id }, data: { descuentoPct: d(50) } });
    await tx.listaPrecioItem.updateMany({ where: { listaPrecioId: t.lista.id }, data: { precio: d(1) } });

    const r = await convertirPresupuestoEnTx(tx, id, HOY);
    const venta = await tx.venta.findUniqueOrThrow({ where: { id: r.ventaId }, include: { items: true, pagos: true } });
    comprobar("total de la venta = total del presupuesto", num(venta.totalBruto), num(antesTotal));
    comprobar("precio X congelado", num(venta.items.find((i) => i.articuloId === t.x.id)!.precioUnitario), "800");
    comprobar("precio Y congelado", num(venta.items.find((i) => i.articuloId === t.y.id)!.precioUnitario), "450");
    comprobar("misma cantidad", num(venta.items.find((i) => i.articuloId === t.x.id)!.cantidad), "2");
    comprobar("estado PENDIENTE (no entregada)", venta.estado, "PENDIENTE");
    comprobar("sin pago inicial", String(venta.pagos.length), "0");
    comprobar("cliente del presupuesto", String(venta.clienteId === t.conLista.id), "true");
    comprobar("fecha de hoy", venta.fecha.getTime() === HOY.getTime() ? "hoy" : "otra", "hoy");
    comprobar("observaciones con el número del presupuesto", String(venta.observaciones?.startsWith("Presupuesto N° ")), "true");
    comprobar("el costo lo congela la venta (2 M × 100 × 2 un.)", num(venta.costoTotal), "400");

    const p = (await leer(tx, id)).p;
    comprobar("presupuesto CONVERTIDO", p.estado, "CONVERTIDO");
    comprobar("con el id de la venta", String(p.ventaId === venta.id), "true");
    comprobar("el presupuesto no cambió de precios", num((await leer(tx, id)).linea(t.x.id).precioUnitario), "800");
    comprobar("descuenta stock (2 un. × 2 M)", num((await tx.material.findUniqueOrThrow({ where: { id: t.material.id } })).stockActual), "96");
    comprobar("sin advertencias", String(r.advertencias.length), "0");
    comprobar("devuelve el total", num(r.totalBruto), "2050");
    comprobar("la venta conoce su presupuesto", String((await tx.venta.findUniqueOrThrow({ where: { id: venta.id }, include: { presupuesto: true } })).presupuesto?.id === id), "true");
  });

  await escenario("Conversión: con falta de stock igual convierte y avisa", async (tx) => {
    const t = await preparar(tx);
    await tx.material.update({ where: { id: t.material.id }, data: { stockActual: d(1) } }); // necesita 4
    const id = await presupuestoBase(tx, t);
    const r = await convertirPresupuestoEnTx(tx, id, HOY);
    comprobar("convirtió", (await leer(tx, id)).p.estado, "CONVERTIDO");
    comprobar("advierte la falta de stock", String(r.advertencias.length === 1 && r.advertencias[0]!.includes("faltaron")), "true");
    comprobar("stock en 0", num((await tx.material.findUniqueOrThrow({ where: { id: t.material.id } })).stockActual), "0");
  });

  await escenario("Conversión: avisa si el IVA del artículo cambió (el total no)", async (tx) => {
    const t = await preparar(tx);
    const id = await presupuestoBase(tx, t);
    await tx.articulo.update({ where: { id: t.x.id }, data: { ivaPct: d("10.5") } });
    const r = await convertirPresupuestoEnTx(tx, id, HOY);
    comprobar("advierte el cambio de IVA", String(r.advertencias.some((a) => a.includes("IVA cambió"))), "true");
    comprobar("el total sigue igual", num(r.totalBruto), "2050");
  });

  await escenario("Conversión: lo que NO se puede convertir", async (tx) => {
    const t = await preparar(tx);
    const items = [{ articuloId: t.y.id, cantidad: 1 }];
    const contarVentas = () => tx.venta.count({ where: { clienteId: { in: [t.conLista.id, t.sinLista.id] } } });

    const vencido = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), AYER_LEJANO)).id;
    await rechaza("vencido", "duplicalo", () => convertirPresupuestoEnTx(tx, vencido, HOY));
    comprobar("vencido sigue ABIERTO y sin venta", `${(await leer(tx, vencido)).p.estado} ${(await leer(tx, vencido)).p.ventaId}`, "ABIERTO null");

    // Justo en el último día válido todavía se convierte; un día después no.
    const justo = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items, { validezDias: 10 }), dia(HOY, -10))).id;
    const unDiaTarde = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items, { validezDias: 9 }), dia(HOY, -10))).id;
    await rechaza("un día después del último día válido", "venció", () => convertirPresupuestoEnTx(tx, unDiaTarde, HOY));
    await convertirPresupuestoEnTx(tx, justo, HOY);
    comprobar("el último día válido sí convierte", (await leer(tx, justo)).p.estado, "CONVERTIDO");

    const anulado = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY)).id;
    await anularPresupuestoEnTx(tx, anulado);
    await rechaza("anulado", "anulado", () => convertirPresupuestoEnTx(tx, anulado, HOY));

    const antesDoble = await contarVentas();
    await rechaza("ya convertido", "ya se convirtió", () => convertirPresupuestoEnTx(tx, justo, HOY));
    comprobar("convertir de nuevo no crea otra venta", String((await contarVentas()) - antesDoble), "0");

    const deBaja = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY)).id;
    await tx.cliente.update({ where: { id: t.sinLista.id }, data: { activo: false } });
    await rechaza("cliente dado de baja", "dado de baja", () => convertirPresupuestoEnTx(tx, deBaja, HOY));
    comprobar("el presupuesto sigue ABIERTO", (await leer(tx, deBaja)).p.estado, "ABIERTO");
    await tx.cliente.update({ where: { id: t.sinLista.id }, data: { activo: true } });

    const sinArticulo = (await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY)).id;
    await tx.articulo.update({ where: { id: t.y.id }, data: { activo: false } });
    await rechaza("artículo dado de baja", "dado de baja", () => convertirPresupuestoEnTx(tx, sinArticulo, HOY));

    await rechaza("presupuesto inexistente", "no existe", () => convertirPresupuestoEnTx(tx, "00000000-0000-4000-8000-000000000011", HOY));
  });

  await escenario("Trazabilidad (8.2): quién creó, duplicó y convirtió", async (tx) => {
    const t = await preparar(tx);
    const ana = await usuarioDePrueba(tx, "Ana de prueba");
    const beto = await usuarioDePrueba(tx, "Beto de prueba");
    const carla = await usuarioDePrueba(tx, "Carla de prueba");
    const items = [{ articuloId: t.x.id, cantidad: 2 }, { articuloId: t.y.id, cantidad: 1 }];
    const creador = async (id: string) => (await tx.presupuesto.findUniqueOrThrow({ where: { id } })).usuarioId;

    const r = await crearPresupuestoEnTx(tx, datos(t.conLista.id, items), HOY, ana.id);
    comprobar("crear guarda el usuario", String((await creador(r.id)) === ana.id), "true");
    const leido = await tx.presupuesto.findUniqueOrThrow({ where: { id: r.id }, include: { usuario: { select: { nombre: true } } } });
    comprobar("se lee el nombre para mostrar", String(leido.usuario?.nombre), "Ana de prueba");

    const sinUsuario = await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY, null);
    comprobar("con null queda NULL", String(await creador(sinUsuario.id)), "null");
    const omitido = await crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY);
    comprobar("sin pasar usuario queda NULL", String(await creador(omitido.id)), "null");

    // El creador se fija al crear: editar (con el mismo flujo de siempre) no lo cambia.
    await editarPresupuestoEnTx(tx, r.id, datos(t.conLista.id, [{ articuloId: t.x.id, cantidad: 3 }]), HOY);
    comprobar("editar no cambia quién lo creó", String((await creador(r.id)) === ana.id), "true");
    await anularPresupuestoEnTx(tx, sinUsuario.id);
    comprobar("anular no le inventa un creador", String(await creador(sinUsuario.id)), "null");

    // El duplicado queda a nombre de quien duplica, el original no cambia.
    const copia = await duplicarPresupuestoEnTx(tx, r.id, HOY, beto.id);
    comprobar("duplicar: a nombre de quien duplica", String((await creador(copia.id)) === beto.id), "true");
    comprobar("duplicar: el original sigue de su creador", String((await creador(r.id)) === ana.id), "true");
    const copiaSin = await duplicarPresupuestoEnTx(tx, r.id, HOY, null);
    comprobar("duplicar sin usuario: NULL (no hereda el del original)", String(await creador(copiaSin.id)), "null");

    // Convertir: la venta, su movimiento de stock y el presupuesto, cada cual con su dato.
    const conv = await convertirPresupuestoEnTx(tx, r.id, HOY, carla.id);
    const venta = await tx.venta.findUniqueOrThrow({ where: { id: conv.ventaId }, include: { usuario: { select: { nombre: true } } } });
    const movimientos = await tx.movimientoStock.findMany({ where: { ventaId: conv.ventaId } });
    comprobar("convertir: la venta queda a nombre de quien convierte", String(venta.usuarioId === carla.id), "true");
    comprobar("convertir: nombre de la venta", String(venta.usuario?.nombre), "Carla de prueba");
    comprobar("convertir: hay movimientos de stock", String(movimientos.length > 0), "true");
    comprobar("convertir: los movimientos también", String(movimientos.every((m) => m.usuarioId === carla.id)), "true");
    comprobar("convertir: el presupuesto conserva a su creador", String((await creador(r.id)) === ana.id), "true");

    const conv2 = await convertirPresupuestoEnTx(tx, copiaSin.id, HOY);
    comprobar("convertir sin usuario: la venta queda NULL", String((await tx.venta.findUniqueOrThrow({ where: { id: conv2.ventaId } })).usuarioId), "null");

    // La base: FK y RESTRICT (cada violacion en su savepoint).
    await violaLaBase(tx, "FK: un usuario inexistente se rechaza", () =>
      crearPresupuestoEnTx(tx, datos(t.sinLista.id, items), HOY, "00000000-0000-4000-8000-0000000000dd"),
    );
    await violaLaBase(tx, "RESTRICT: no se borra un usuario con presupuestos", () => tx.usuario.delete({ where: { id: ana.id } }));
    comprobar("el usuario sigue ahí", String((await tx.usuario.count({ where: { id: ana.id } })) === 1), "true");
  });

  await lockDistinto();

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

/**
 * Con el lock de numeracion de VENTAS de este año tomado por otra transaccion,
 * crear un presupuesto no se bloquea (si usaran la misma clave, esperaria).
 */
async function lockDistinto() {
  console.log("--- Numerar presupuestos no espera al lock de las ventas ---");
  const anio = HOY.getUTCFullYear();
  comprobar("la clave de lock no es la del año", String(CLAVE_LOCK_PRESUPUESTOS + anio !== anio), "true");
  const otro = nuevoCliente();
  let liberar: () => void = () => {};
  const tomado = new Promise<void>((resolver) => {
    const sostenida = otro.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${anio})`;
        resolver();
        await new Promise<void>((fin) => (liberar = fin));
      },
      { timeout: 30_000 },
    );
    sostenida.catch(() => resolver());
  });
  await tomado;
  try {
    const termino = await Promise.race([
      prisma
        .$transaction(async (tx) => {
          const t = await preparar(tx);
          await crearPresupuestoEnTx(tx, datos(t.sinLista.id, [{ articuloId: t.y.id, cantidad: 1 }]), HOY);
          throw new Deshacer();
        })
        .catch((e) => (e instanceof Deshacer ? "creado" : `error ${e}`)),
      new Promise<string>((r) => setTimeout(() => r("bloqueado"), 5_000)),
    ]);
    comprobar("crea mientras el lock de ventas está tomado", String(termino), "creado");
  } finally {
    liberar();
    await otro.$disconnect();
  }
}

type Cuentas = Record<string, number>;
async function contarTodo(cliente: PrismaClient): Promise<Cuentas> {
  const [presupuestos, items, ventas, ventaItems, movimientos, clientes, articulos, materiales, listas, usuarios] = await Promise.all([
    cliente.presupuesto.count(),
    cliente.presupuestoItem.count(),
    cliente.venta.count(),
    cliente.ventaItem.count(),
    cliente.movimientoStock.count(),
    cliente.cliente.count(),
    cliente.articulo.count(),
    cliente.material.count(),
    cliente.listaPrecio.count(),
    cliente.usuario.count(),
  ]);
  return { presupuestos, items, ventas, ventaItems, movimientos, clientes, articulos, materiales, listas, usuarios };
}

// ─── Concurrencia ─────────────────────────────────────────────────────────────

const ANIO_FICTICIO = f("2099-06-15");
const PREFIJO = "ZZ prueba presupuestos concurrencia";

/** Borra todo lo que crea la prueba de concurrencia (por prefijo y por anio ficticio). */
async function limpiarConcurrencia() {
  const clientes = await prisma.cliente.findMany({ where: { nombre: { startsWith: PREFIJO } }, select: { id: true } });
  const clienteIds = clientes.map((c) => c.id);
  const ventas = await prisma.venta.findMany({ where: { clienteId: { in: clienteIds } }, select: { id: true } });
  const ventaIds = ventas.map((v) => v.id);
  await prisma.presupuesto.deleteMany({ where: { clienteId: { in: clienteIds } } });
  await prisma.movimientoStock.deleteMany({ where: { ventaId: { in: ventaIds } } });
  await prisma.venta.deleteMany({ where: { id: { in: ventaIds } } });
  await prisma.articulo.deleteMany({ where: { nombre: { startsWith: PREFIJO } } });
  await prisma.material.deleteMany({ where: { nombre: { startsWith: PREFIJO } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clienteIds } } });
}

async function concurrencia() {
  console.log("--- Concurrencia (transacciones reales, año ficticio 2099, se limpia al terminar) ---");
  const a = prisma;
  const b = nuevoCliente();
  try {
    await limpiarConcurrencia(); // restos de una corrida interrumpida

    const material = await prisma.material.create({
      data: { nombre: `${PREFIJO} material`, unidad: "U", stockActual: d(1000), costoUnitario: d(10) },
    });
    const articulo = await prisma.articulo.create({
      data: {
        nombre: `${PREFIJO} X`,
        precioVenta: d(1000),
        receta: { create: { componentes: { create: [{ tipo: "MATERIAL", materialId: material.id, cantidad: d(2) }] } } },
      },
    });
    const cliente = await prisma.cliente.create({ data: { nombre: `${PREFIJO} cliente` } });
    const nuevo = (cantidad: number) =>
      prisma.$transaction((tx) => crearPresupuestoEnTx(tx, datos(cliente.id, [{ articuloId: articulo.id, cantidad }]), ANIO_FICTICIO));

    // 1. Seis altas simultaneas: numeros 1..6 sin repetir ni dejar huecos.
    const altas = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => (n % 2 ? a : b).$transaction((tx) => crearPresupuestoEnTx(tx, datos(cliente.id, [{ articuloId: articulo.id, cantidad: n }]), ANIO_FICTICIO))));
    comprobar("altas simultáneas: numeración sin repetidos ni huecos", altas.map((x) => x.numero).sort((p, q) => p - q).join(","), "1,2,3,4,5,6");

    // 2. Dos conversiones simultaneas (varias rondas): una sola venta, la otra recibe un error claro.
    for (const ronda of [1, 2, 3]) {
      const { id } = await nuevo(3);
      const stockAntes = (await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).stockActual;
      const resultados = await Promise.allSettled([
        a.$transaction((tx) => convertirPresupuestoEnTx(tx, id, ANIO_FICTICIO), { timeout: 30_000 }),
        b.$transaction((tx) => convertirPresupuestoEnTx(tx, id, ANIO_FICTICIO), { timeout: 30_000 }),
        a.$transaction((tx) => convertirPresupuestoEnTx(tx, id, ANIO_FICTICIO), { timeout: 30_000 }),
        b.$transaction((tx) => convertirPresupuestoEnTx(tx, id, ANIO_FICTICIO), { timeout: 30_000 }),
      ]);
      const ok = resultados.filter((r) => r.status === "fulfilled");
      const fallidas = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      comprobar(`ronda ${ronda}: una sola conversión exitosa`, String(ok.length), "1");
      comprobar(
        `ronda ${ronda}: las otras reciben un error claro`,
        String(fallidas.length === 3 && fallidas.every((r) => r.reason instanceof ErrorDeNegocio && r.reason.message.includes("ya se convirtió"))),
        "true",
      );
      const p = await prisma.presupuesto.findUniqueOrThrow({ where: { id } });
      const ventas = await prisma.venta.findMany({ where: { id: p.ventaId ?? "" } });
      comprobar(`ronda ${ronda}: presupuesto CONVERTIDO con su venta`, `${p.estado} ${ventas.length}`, "CONVERTIDO 1");
      const stockDespues = (await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).stockActual;
      comprobar(`ronda ${ronda}: stock descontado una sola vez (3 × 2)`, num(stockAntes.minus(stockDespues)), "6");
    }
    const ventasTotales = await prisma.venta.count({ where: { clienteId: cliente.id } });
    comprobar("tres presupuestos convertidos = tres ventas", String(ventasTotales), "3");
    const numeros = (await prisma.venta.findMany({ where: { clienteId: cliente.id }, select: { numero: true } })).map((v) => v.numero).sort((p, q) => p - q);
    comprobar("numeración de ventas correlativa", numeros.join(","), "1,2,3");

    // 3. Convertir y editar a la vez: gane quien gane, la venta tiene el total del presupuesto final.
    for (const ronda of [1, 2, 3]) {
      const { id } = await nuevo(2);
      const convertir = () => a.$transaction((tx) => convertirPresupuestoEnTx(tx, id, ANIO_FICTICIO), { timeout: 30_000 });
      const editar = () =>
        b.$transaction((tx) => editarPresupuestoEnTx(tx, id, datos(cliente.id, [{ articuloId: articulo.id, cantidad: 7 }]), ANIO_FICTICIO), { timeout: 30_000 });
      // Se alterna quien sale primero.
      const [conv, edit] =
        ronda % 2 === 1
          ? await Promise.allSettled([convertir(), editar()])
          : ((await Promise.allSettled([editar(), convertir()])).reverse() as [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]);
      const p = await prisma.presupuesto.findUniqueOrThrow({ where: { id }, include: { items: true } });
      const venta = await prisma.venta.findUniqueOrThrow({ where: { id: p.ventaId ?? "" } });
      const totalPresupuesto = totalizarPresupuesto(p.items.map((i) => ({ cantidad: d(i.cantidad), precioUnitario: d(i.precioUnitario), ivaPct: d(i.ivaPct) }))).totalBruto;
      comprobar(`editar vs convertir (${ronda}): convirtió`, conv.status, "fulfilled");
      comprobar(`editar vs convertir (${ronda}): total de la venta = total del presupuesto`, num(venta.totalBruto), num(totalPresupuesto));
      comprobar(
        `editar vs convertir (${ronda}): si la edición perdió, falló con error claro`,
        edit.status === "fulfilled" ? "editó antes" : String(edit.reason instanceof ErrorDeNegocio && edit.reason.message.includes("ya se convirtió")),
        edit.status === "fulfilled" ? "editó antes" : "true",
      );
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
