/**
 * Prueba el alta y edicion de articulos con receta, y su baja y reactivacion,
 * contra Postgres real y sin Next.
 *
 *   npx tsx scripts/test-articulos.ts
 *
 * Como `test-acciones.ts`: cada escenario corre en una transaccion que se
 * deshace al final, asi que la base queda como estaba.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { d } from "../src/lib/money";
import { ErrorDeNegocio, hoyArgentinaISO } from "../src/lib/acciones";
import { recetaResuelta } from "../src/lib/receta";
import { costearBorrador, validarArticulo, type DatosArticulo, type LineaBorrador } from "../src/lib/recetas";
import type { Tx } from "../src/lib/dominio/tx";
import { cambiarActivoArticuloEnTx, guardarArticuloEnTx } from "../src/lib/dominio/articulos";
import { registrarVentaEnTx } from "../src/lib/dominio/ventas";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

async function rechaza(etiqueta: string, fragmento: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    comprobar(etiqueta, "no lanzó error", `error "${fragmento}"`);
  } catch (error) {
    const ok = error instanceof ErrorDeNegocio && error.message.includes(fragmento);
    comprobar(etiqueta, ok ? "rechazada" : String(error), "rechazada");
  }
}

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

const linea = (l: Partial<LineaBorrador> & Pick<LineaBorrador, "tipo">): LineaBorrador => ({
  materialId: "",
  maquinaId: "",
  cantidad: "",
  override: "",
  notas: "",
  ...l,
});

/** Valida como lo hace la server action y lanza si el formulario no pasa. */
function validado(datos: DatosArticulo) {
  const r = validarArticulo(datos);
  if (!r.ok) throw new Error(`validacion: ${r.error}`);
  return r.valor;
}

/** Costo del articulo leido de la base con el mismo camino que el listado del catalogo. */
async function costoDesdeBase(tx: Tx, articuloId: string, costoHora = d(1000)) {
  const a = await tx.articulo.findUniqueOrThrow({
    where: { id: articuloId },
    include: { receta: { include: { componentes: { include: { material: true, maquina: true }, orderBy: { id: "asc" } } } } },
  });
  return recetaResuelta(a.receta?.componentes ?? [], costoHora);
}

/** Material A $100/m2, maquina $2.000/h, mano de obra $1.000/h, y piezas de baja. */
async function preparar(tx: Tx) {
  await tx.configuracion.upsert({
    where: { clave: "costoHoraManoObra" },
    update: { valor: "1000" },
    create: { clave: "costoHoraManoObra", valor: "1000" },
  });
  const material = await tx.material.create({
    data: { nombre: "Prueba A", unidad: "M2", stockActual: d(10), costoUnitario: d(100) },
  });
  const materialBaja = await tx.material.create({
    data: { nombre: "Material de baja", unidad: "U", costoUnitario: d(1), activo: false },
  });
  const maquina = await tx.maquina.create({ data: { nombre: "Máquina de prueba", costoHora: d(2000) } });
  const maquinaBaja = await tx.maquina.create({ data: { nombre: "Máquina de baja", costoHora: d(1), activo: false } });
  const cliente = await tx.cliente.create({ data: { nombre: "Cliente de prueba" } });
  return { material, materialBaja, maquina, maquinaBaja, cliente };
}

const NOMBRE = "Artículo de prueba único 7f3a";

async function main() {
  await escenario("Alta con receta de los tres tipos y override", async (tx) => {
    const { material, maquina } = await preparar(tx);
    const lineas = [
      linea({ tipo: "MATERIAL", materialId: material.id, cantidad: "0,5" }), // 50
      linea({ tipo: "MAQUINA", maquinaId: maquina.id, cantidad: "0,25" }), // 500
      linea({ tipo: "MANO_OBRA", cantidad: "0,5", override: "1200", notas: "terminación" }), // 600
    ];
    const { id } = await guardarArticuloEnTx(
      tx,
      validado({ nombre: NOMBRE, descripcion: "", precioVenta: "2420", ivaPct: "21", esServicio: false, lineas }),
    );
    const articulo = await tx.articulo.findUniqueOrThrow({ where: { id }, include: { receta: { include: { componentes: true } } } });
    comprobar("precio", articulo.precioVenta.toString(), "2420");
    comprobar("componentes", String(articulo.receta?.componentes.length), "3");
    const costo = await costoDesdeBase(tx, id);
    comprobar("costo desde la base", costo.costoTotal.toString(), "1150");

    // El costo en vivo del formulario tiene que dar lo mismo que el listado.
    const enVivo = costearBorrador(
      lineas,
      {
        materiales: [{ id: material.id, nombre: material.nombre, costo: "100", unidad: "m2", activo: true }],
        maquinas: [{ id: maquina.id, nombre: maquina.nombre, costo: "2000", unidad: "h", activo: true }],
      },
      d(1000),
    );
    comprobar("costo en vivo = costo guardado", enVivo.costoTotal.toString(), costo.costoTotal.toString());

    // Leida como la leen el editor y el catalogo, la receta conserva el orden de carga.
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const desordenadas = [
        linea({ tipo: "MANO_OBRA", cantidad: "1" }),
        linea({ tipo: "MATERIAL", materialId: material.id, cantidad: "2" }),
        linea({ tipo: "MAQUINA", maquinaId: maquina.id, cantidad: "3" }),
        linea({ tipo: "MATERIAL", materialId: material.id, cantidad: "4" }),
        linea({ tipo: "MANO_OBRA", cantidad: "5" }),
      ];
      await guardarArticuloEnTx(
        tx,
        validado({ id, nombre: NOMBRE, descripcion: "", precioVenta: "1", ivaPct: "21", esServicio: false, lineas: desordenadas }),
      );
    }
    const leidas = await tx.recetaComponente.findMany({ where: { receta: { articuloId: id } }, orderBy: { id: "asc" } });
    comprobar("orden de las líneas", leidas.map((c) => `${c.tipo}:${c.cantidad}`).join(","), "MANO_OBRA:1,MATERIAL:2,MAQUINA:3,MATERIAL:4,MANO_OBRA:5");

    const mo = articulo.receta!.componentes.find((c) => c.tipo === "MANO_OBRA")!;
    comprobar("override guardado", String(mo.costoUnitarioOverride), "1200");
    comprobar("nota guardada", String(mo.notas), "terminación");
  });

  await escenario("Edición: reemplaza la receta, quita líneas y sin receta", async (tx) => {
    const { material, maquina } = await preparar(tx);
    const base: DatosArticulo = {
      nombre: NOMBRE,
      descripcion: "",
      precioVenta: "1000",
      ivaPct: "21",
      esServicio: false,
      lineas: [
        linea({ tipo: "MATERIAL", materialId: material.id, cantidad: "1" }),
        linea({ tipo: "MAQUINA", maquinaId: maquina.id, cantidad: "1" }),
      ],
    };
    const { id } = await guardarArticuloEnTx(tx, validado(base));

    await guardarArticuloEnTx(
      tx,
      validado({
        ...base,
        id,
        nombre: `${NOMBRE} editado`,
        precioVenta: "1500",
        ivaPct: "10.5",
        esServicio: true,
        lineas: [linea({ tipo: "MANO_OBRA", cantidad: "2" })],
      }),
    );
    const editado = await tx.articulo.findUniqueOrThrow({ where: { id }, include: { receta: { include: { componentes: true } } } });
    comprobar("nombre editado", editado.nombre, `${NOMBRE} editado`);
    comprobar("iva editado", editado.ivaPct.toString(), "10.5");
    comprobar("servicio", String(editado.esServicio), "true");
    comprobar("componentes reemplazados", editado.receta!.componentes.map((c) => c.tipo).join(","), "MANO_OBRA");
    comprobar("costo editado", (await costoDesdeBase(tx, id)).costoTotal.toString(), "2000");
    const recetas = await tx.receta.count({ where: { articuloId: id } });
    comprobar("una sola receta", String(recetas), "1");

    await guardarArticuloEnTx(tx, validado({ ...base, id, lineas: [] }));
    const sinReceta = await costoDesdeBase(tx, id);
    comprobar("sin líneas: costo 0", sinReceta.costoTotal.toString(), "0");
    comprobar("sin líneas: no confiable", String(sinReceta.confiable), "false");

    const { id: sinNada } = await guardarArticuloEnTx(
      tx,
      validado({ ...base, nombre: `${NOMBRE} sin receta`, lineas: [] }),
    );
    comprobar("alta sin líneas no crea receta", String(await tx.receta.count({ where: { articuloId: sinNada } })), "0");
  });

  await escenario("Validaciones contra la base", async (tx) => {
    const { material, materialBaja, maquina, maquinaBaja } = await preparar(tx);
    const base: DatosArticulo = { nombre: NOMBRE, descripcion: "", precioVenta: "1000", ivaPct: "21", esServicio: false, lineas: [] };

    await rechaza("material de baja", "dado de baja", () =>
      guardarArticuloEnTx(tx, validado({ ...base, lineas: [linea({ tipo: "MATERIAL", materialId: materialBaja.id, cantidad: "1" })] })),
    );
    await rechaza("máquina de baja", "dada de baja", () =>
      guardarArticuloEnTx(tx, validado({ ...base, lineas: [linea({ tipo: "MAQUINA", maquinaId: maquinaBaja.id, cantidad: "1" })] })),
    );
    await rechaza("material inexistente", "no existe", () =>
      guardarArticuloEnTx(
        tx,
        validado({ ...base, lineas: [linea({ tipo: "MATERIAL", materialId: "00000000-0000-4000-8000-000000000000", cantidad: "1" })] }),
      ),
    );
    await rechaza("id que no es uuid", "no existe", () =>
      guardarArticuloEnTx(tx, validado({ ...base, lineas: [linea({ tipo: "MAQUINA", maquinaId: "maq-1", cantidad: "1" })] })),
    );
    await rechaza("artículo inexistente", "no existe", () =>
      guardarArticuloEnTx(tx, validado({ ...base, id: "00000000-0000-4000-8000-000000000000" })),
    );

    const { id } = await guardarArticuloEnTx(
      tx,
      validado({
        ...base,
        lineas: [
          linea({ tipo: "MATERIAL", materialId: material.id, cantidad: "1" }),
          linea({ tipo: "MAQUINA", maquinaId: maquina.id, cantidad: "1" }),
        ],
      }),
    );
    await rechaza("nombre repetido (sin importar mayúsculas)", "Ya hay un artículo activo", () =>
      guardarArticuloEnTx(tx, validado({ ...base, nombre: NOMBRE.toUpperCase() })),
    );
    await guardarArticuloEnTx(tx, validado({ ...base, id, precioVenta: "999" }));
    comprobar("editar con su propio nombre", (await tx.articulo.findUniqueOrThrow({ where: { id } })).precioVenta.toString(), "999");

    // Si el material se da de baja despues, la receta vieja no se puede guardar tal cual.
    await tx.material.update({ where: { id: material.id }, data: { activo: false } });
    await rechaza("receta con material dado de baja después", "dado de baja", () =>
      guardarArticuloEnTx(
        tx,
        validado({ ...base, id, lineas: [linea({ tipo: "MATERIAL", materialId: material.id, cantidad: "1" })] }),
      ),
    );
  });

  await escenario("Baja, reactivación y venta con costo congelado", async (tx) => {
    const { material, cliente } = await preparar(tx);
    const base: DatosArticulo = {
      nombre: NOMBRE,
      descripcion: "",
      precioVenta: "1210",
      ivaPct: "21",
      esServicio: false,
      lineas: [
        linea({ tipo: "MATERIAL", materialId: material.id, cantidad: "2" }), // 200
        linea({ tipo: "MANO_OBRA", cantidad: "0.5" }), // 500
      ],
    };
    const { id } = await guardarArticuloEnTx(tx, validado(base));
    const hoy = new Date(`${hoyArgentinaISO()}T00:00:00Z`);
    const vender = () =>
      registrarVentaEnTx(tx, {
        clienteId: cliente.id,
        fecha: hoy,
        observaciones: null,
        entregada: false,
        items: [{ articuloId: id, cantidad: d(1) }],
        pago: null,
      });

    const venta = await vender();
    const item = await tx.ventaItem.findFirstOrThrow({ where: { ventaId: venta.id } });
    comprobar("venta congela el costo de la receta", item.costoUnitarioSnapshot.toString(), "700");

    // Cambia la receta: la venta vieja no se entera.
    await guardarArticuloEnTx(tx, validado({ ...base, id, lineas: [linea({ tipo: "MANO_OBRA", cantidad: "3" })] }));
    const despues = await tx.ventaItem.findFirstOrThrow({ where: { ventaId: venta.id } });
    comprobar("costo congelado tras editar la receta", despues.costoUnitarioSnapshot.toString(), "700");

    await cambiarActivoArticuloEnTx(tx, id, false);
    comprobar("baja lógica", String((await tx.articulo.findUniqueOrThrow({ where: { id } })).activo), "false");
    await rechaza("no se vende de baja", "dado de baja", vender);

    // Otro articulo toma el nombre mientras este esta de baja: reactivar choca.
    const { id: otro } = await guardarArticuloEnTx(tx, validado({ ...base, lineas: [] }));
    await rechaza("reactivar con nombre tomado", "Ya hay un artículo activo", () => cambiarActivoArticuloEnTx(tx, id, true));
    await cambiarActivoArticuloEnTx(tx, otro, false);
    await cambiarActivoArticuloEnTx(tx, id, true);
    comprobar("reactivado", String((await tx.articulo.findUniqueOrThrow({ where: { id } })).activo), "true");
    const segunda = await vender();
    const item2 = await tx.ventaItem.findFirstOrThrow({ where: { ventaId: segunda.id } });
    comprobar("venta nueva con la receta nueva", item2.costoUnitarioSnapshot.toString(), "3000");
  });

  await prisma.$disconnect();
  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
