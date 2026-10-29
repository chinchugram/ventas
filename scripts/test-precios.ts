/**
 * Prueba las listas de precios contra Postgres real, sin Next:
 *
 *   npm run test:precios:db
 *
 * Venta de un cliente con lista (cada rama de la regla), con lista inactiva y
 * sin lista; override de precio; costo congelado; ABM de listas y asignacion a
 * clientes. Como `test-acciones.ts`: cada escenario corre en una transaccion
 * que se deshace al final, asi que no deja rastro en la base.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d, type Dinero } from "../src/lib/money";
import { ErrorDeNegocio, hoyArgentinaISO } from "../src/lib/acciones";
import type { Tx } from "../src/lib/dominio/tx";
import { registrarVentaEnTx } from "../src/lib/dominio/ventas";
import {
  cambiarActivoListaEnTx,
  crearListaEnTx,
  editarListaEnTx,
  guardarPrecioListaEnTx,
  preciosDeClienteEnTx,
  quitarPrecioListaEnTx,
} from "../src/lib/dominio/listas-precios";
import { crearClienteEnTx, editarClienteEnTx, type DatosCliente } from "../src/lib/dominio/clientes";

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

const num = (v: Dinero) => v.toString();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

class Deshacer extends Error {}

async function escenario(titulo: string, fn: (tx: Tx) => Promise<void>) {
  console.log(`--- ${titulo} ---`);
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Deshacer();
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Deshacer)) {
      fallos += 1;
      console.log("FALLA error inesperado:", error);
    }
  }
}

const hoy = new Date(`${hoyArgentinaISO()}T00:00:00Z`);
const datosCliente = (extra: Partial<DatosCliente> = {}): DatosCliente => ({
  nombre: "Cliente con lista",
  cuit: null,
  telefono: null,
  email: null,
  direccion: null,
  notas: null,
  ...extra,
});

/**
 * Tres articulos: X (con receta, catalogo 1210), Y (servicio, catalogo 500) y
 * Z (servicio, catalogo 1000). Lista "Mayoristas": 10% de descuento y precio
 * especifico de X en 800. Un cliente con la lista, otro sin lista.
 */
async function preparar(tx: Tx, listaActiva = true) {
  const material = await tx.material.create({
    data: { nombre: "Material de prueba", unidad: "U", stockActual: d(100), costoUnitario: d(100) },
  });
  const x = await tx.articulo.create({
    data: {
      nombre: "Artículo X",
      precioVenta: d(1210),
      ivaPct: d(21),
      receta: { create: { componentes: { create: [{ tipo: "MATERIAL", materialId: material.id, cantidad: d(2) }] } } },
    },
  });
  const y = await tx.articulo.create({ data: { nombre: "Servicio Y", precioVenta: d(500), esServicio: true } });
  const z = await tx.articulo.create({ data: { nombre: "Servicio Z", precioVenta: d(1000), esServicio: true } });
  const lista = await tx.listaPrecio.create({
    data: {
      nombre: "Mayoristas de prueba",
      descuentoPct: d(10),
      activo: listaActiva,
      items: { create: [{ articuloId: x.id, precio: d(800) }] },
    },
  });
  const conLista = await tx.cliente.create({ data: { nombre: "Cliente con lista", listaPrecioId: lista.id } });
  const sinLista = await tx.cliente.create({ data: { nombre: "Cliente sin lista" } });
  return { x, y, z, lista, conLista, sinLista };
}

async function vender(tx: Tx, clienteId: string, items: { articuloId: string; cantidad: Dinero; precioUnitario?: Dinero }[]) {
  const r = await registrarVentaEnTx(tx, { clienteId, fecha: hoy, observaciones: null, entregada: true, items, pago: null });
  const v = await tx.venta.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
  const linea = (articuloId: string) => v.items.find((i) => i.articuloId === articuloId)!;
  return { r, v, linea };
}

async function main() {
  await escenario("Cliente con lista: cada rama de la regla", async (tx) => {
    const { x, y, z, conLista } = await preparar(tx);
    const { v, linea } = await vender(tx, conLista.id, [
      { articuloId: x.id, cantidad: d(2) },
      { articuloId: y.id, cantidad: d(1) },
    ]);
    comprobar("específico (X): precio unitario", num(linea(x.id).precioUnitario), "800");
    comprobar("específico (X): subtotal bruto", num(linea(x.id).subtotalBruto), "1600");
    comprobar("descuento general (Y): 500 − 10%", num(linea(y.id).precioUnitario), "450");
    comprobar("total de la venta", num(v.totalBruto), "2050");
    comprobar("IVA de X sigue siendo el del artículo", num(linea(x.id).ivaPct), "21");

    const otra = await vender(tx, conLista.id, [{ articuloId: z.id, cantidad: d(3) }]);
    comprobar("descuento general (Z): 1000 − 10%", num(otra.linea(z.id).precioUnitario), "900");
  });

  await escenario("Cliente sin lista: catálogo", async (tx) => {
    const { x, y, sinLista } = await preparar(tx);
    const { linea } = await vender(tx, sinLista.id, [
      { articuloId: x.id, cantidad: d(1) },
      { articuloId: y.id, cantidad: d(1) },
    ]);
    comprobar("X a catálogo", num(linea(x.id).precioUnitario), "1210");
    comprobar("Y a catálogo", num(linea(y.id).precioUnitario), "500");
  });

  await escenario("Lista inactiva: se ignora (ni específico ni descuento)", async (tx) => {
    const { x, y, conLista } = await preparar(tx, false);
    const { linea } = await vender(tx, conLista.id, [
      { articuloId: x.id, cantidad: d(1) },
      { articuloId: y.id, cantidad: d(1) },
    ]);
    comprobar("X a catálogo", num(linea(x.id).precioUnitario), "1210");
    comprobar("Y a catálogo", num(linea(y.id).precioUnitario), "500");
  });

  await escenario("Lista con descuento 0 y sin específico: catálogo", async (tx) => {
    const { y, lista, conLista } = await preparar(tx);
    await tx.listaPrecio.update({ where: { id: lista.id }, data: { descuentoPct: d(0) } });
    const { linea } = await vender(tx, conLista.id, [{ articuloId: y.id, cantidad: d(1) }]);
    comprobar("Y a catálogo", num(linea(y.id).precioUnitario), "500");
  });

  await escenario("El costo congelado no depende de la lista", async (tx) => {
    const { x, conLista, sinLista } = await preparar(tx);
    const a = await vender(tx, conLista.id, [{ articuloId: x.id, cantidad: d(2) }]);
    const b = await vender(tx, sinLista.id, [{ articuloId: x.id, cantidad: d(2) }]);
    comprobar("costo unitario (con lista)", num(a.linea(x.id).costoUnitarioSnapshot), "200");
    comprobar("costo unitario (sin lista)", num(b.linea(x.id).costoUnitarioSnapshot), "200");
    comprobar("costo total (con lista)", num(a.linea(x.id).costoTotalSnapshot), "400");
    comprobar("venta con lista: costoTotal", num(a.v.costoTotal), "400");
    comprobar("venta con lista: total 2 × 800", num(a.v.totalBruto), "1600");
    comprobar("venta sin lista: total 2 × 1210", num(b.v.totalBruto), "2420");
  });

  await escenario("Override de precio (solo servidor): gana sobre lista y catálogo", async (tx) => {
    const { x, y, conLista, sinLista } = await preparar(tx);
    const a = await vender(tx, conLista.id, [{ articuloId: x.id, cantidad: d(1), precioUnitario: d("123.4") }]);
    comprobar("override con lista", num(a.linea(x.id).precioUnitario), "123.4");
    const b = await vender(tx, sinLista.id, [
      { articuloId: y.id, cantidad: d(1), precioUnitario: d(0) },
      { articuloId: x.id, cantidad: d(1) },
    ]);
    comprobar("override en 0 es válido", num(b.linea(y.id).precioUnitario), "0");
    comprobar("la otra línea sigue su regla", num(b.linea(x.id).precioUnitario), "1210");
    comprobar("subtotal con override", num(a.linea(x.id).subtotalBruto), "123.4");
    await rechaza("override negativo", "negativo", () =>
      vender(tx, sinLista.id, [{ articuloId: y.id, cantidad: d(1), precioUnitario: d(-1) }]),
    );
  });

  await escenario("Precios para la pantalla de venta (sin costos)", async (tx) => {
    const { x, y, z, conLista, sinLista, lista } = await preparar(tx);
    const ids = [x.id, y.id, z.id];
    const con = await preciosDeClienteEnTx(tx, conLista.id, ids);
    comprobar("lista informada", `${con.lista?.nombre} ${num(con.lista!.descuentoPct)}`, "Mayoristas de prueba 10");
    comprobar(
      "precios resueltos",
      ids.map((id) => `${num(con.precios.get(id)!.precio)}/${con.precios.get(id)!.origen}`).join(" "),
      "800/ESPECIFICO 450/DESCUENTO 900/DESCUENTO",
    );
    const sin = await preciosDeClienteEnTx(tx, sinLista.id, ids);
    comprobar("sin lista: nada que informar", String(sin.lista), "null");
    comprobar("sin lista: catálogo", ids.map((id) => num(sin.precios.get(id)!.precio)).join(" "), "1210 500 1000");

    await tx.listaPrecio.update({ where: { id: lista.id }, data: { activo: false } });
    const baja = await preciosDeClienteEnTx(tx, conLista.id, ids);
    comprobar("lista de baja: no se informa", String(baja.lista), "null");
    comprobar("lista de baja: catálogo", ids.map((id) => num(baja.precios.get(id)!.precio)).join(" "), "1210 500 1000");
  });

  await escenario("ABM de listas y precios específicos", async (tx) => {
    const { id } = await crearListaEnTx(tx, { nombre: "  Gremio  ", descuentoPct: d("12.5") });
    const l = await tx.listaPrecio.findUniqueOrThrow({ where: { id } });
    comprobar("nombre sin espacios", l.nombre, "Gremio");
    comprobar("descuento", num(l.descuentoPct), "12.5");
    comprobar("activa por defecto", String(l.activo), "true");
    await rechaza("nombre repetido (sin distinguir mayúsculas)", "Ya hay una lista", () =>
      crearListaEnTx(tx, { nombre: "gremio", descuentoPct: d(0) }),
    );
    await rechaza("descuento > 100", "entre 0 y 100", () => crearListaEnTx(tx, { nombre: "Otra", descuentoPct: d(101) }));

    await editarListaEnTx(tx, id, { nombre: "Gremio 2", descuentoPct: d(20) });
    const e = await tx.listaPrecio.findUniqueOrThrow({ where: { id } });
    comprobar("editada", `${e.nombre} ${num(e.descuentoPct)}`, "Gremio 2 20");
    await rechaza("editar lista inexistente", "no existe", () =>
      editarListaEnTx(tx, "00000000-0000-4000-8000-0000000000aa", { nombre: "X", descuentoPct: d(0) }),
    );

    const articulo = await tx.articulo.create({ data: { nombre: "Artículo ABM", precioVenta: d(1000) } });
    const baja = await tx.articulo.create({ data: { nombre: "Artículo de baja", precioVenta: d(1), activo: false } });
    await guardarPrecioListaEnTx(tx, id, articulo.id, d(700));
    await guardarPrecioListaEnTx(tx, id, articulo.id, d(650));
    const items = await tx.listaPrecioItem.findMany({ where: { listaPrecioId: id } });
    comprobar("un solo ítem por par (upsert)", `${items.length} ${num(items[0]!.precio)}`, "1 650");
    await rechaza("precio negativo", "negativo", () => guardarPrecioListaEnTx(tx, id, articulo.id, d(-1)));
    await rechaza("artículo de baja", "dado de baja", () => guardarPrecioListaEnTx(tx, id, baja.id, d(1)));
    await quitarPrecioListaEnTx(tx, id, articulo.id);
    comprobar("quitado", String(await tx.listaPrecioItem.count({ where: { listaPrecioId: id } })), "0");

    await cambiarActivoListaEnTx(tx, id, false);
    comprobar("baja lógica (la fila sigue)", String((await tx.listaPrecio.findUniqueOrThrow({ where: { id } })).activo), "false");
    await cambiarActivoListaEnTx(tx, id, true);
    comprobar("reactivada", String((await tx.listaPrecio.findUniqueOrThrow({ where: { id } })).activo), "true");
  });

  await escenario("Asignación de lista al cliente", async (tx) => {
    const activa = await tx.listaPrecio.create({ data: { nombre: "Activa de prueba" } });
    const deBaja = await tx.listaPrecio.create({ data: { nombre: "De baja de prueba", activo: false } });

    const { id } = await crearClienteEnTx(tx, datosCliente({ listaPrecioId: activa.id }));
    comprobar("alta con lista", String((await tx.cliente.findUniqueOrThrow({ where: { id } })).listaPrecioId === activa.id), "true");
    await rechaza("alta con lista de baja", "dada de baja", () => crearClienteEnTx(tx, datosCliente({ nombre: "Otro", listaPrecioId: deBaja.id })));
    await rechaza("alta con lista inexistente", "no existe", () =>
      crearClienteEnTx(tx, datosCliente({ nombre: "Otro", listaPrecioId: "00000000-0000-4000-8000-0000000000bb" })),
    );

    await editarClienteEnTx(tx, id, datosCliente({ nombre: "Renombrado" }));
    comprobar("editar sin informar lista: no la toca", String((await tx.cliente.findUniqueOrThrow({ where: { id } })).listaPrecioId === activa.id), "true");
    await editarClienteEnTx(tx, id, datosCliente({ listaPrecioId: null }));
    comprobar("null quita la lista", String((await tx.cliente.findUniqueOrThrow({ where: { id } })).listaPrecioId), "null");

    // Un cliente que ya tenia una lista que luego se dio de baja puede editarse sin perderla.
    const viejo = await tx.cliente.create({ data: { nombre: "Cliente viejo", listaPrecioId: deBaja.id } });
    await editarClienteEnTx(tx, viejo.id, datosCliente({ nombre: "Cliente viejo 2", listaPrecioId: deBaja.id }));
    comprobar("conserva su lista de baja", String((await tx.cliente.findUniqueOrThrow({ where: { id: viejo.id } })).listaPrecioId === deBaja.id), "true");
  });

  await prisma.$disconnect();
  if (fallos > 0) {
    console.log(`\n${fallos} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("\nTodo OK.");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
