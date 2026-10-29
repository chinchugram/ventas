import { randomUUID } from "node:crypto";
import { ErrorDeNegocio } from "@/lib/acciones";
import type { ArticuloValidado } from "@/lib/recetas";
import type { Tx } from "./tx";

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Alta o edicion de un articulo junto con su receta, en una sola transaccion.
 *
 * La receta se guarda reemplazando sus componentes: se borran y se vuelven a
 * crear. Los componentes no tienen historial (las ventas congelan su costo en
 * `venta_items`), asi que no hay nada que preservar.
 *
 * Controla contra la base lo que el formulario no puede: que cada material y
 * maquina exista y este activo, y que no haya otro articulo activo con el mismo
 * nombre (en la venta se elige por nombre: dos iguales serian una trampa).
 */
export async function guardarArticuloEnTx(tx: Tx, a: ArticuloValidado): Promise<{ id: string }> {
  if (a.id) {
    const existente = await tx.articulo.findUnique({ where: { id: a.id }, select: { id: true } });
    if (!existente) throw new ErrorDeNegocio("El artículo no existe.");
  }

  const repetido = await tx.articulo.findFirst({
    where: {
      activo: true,
      nombre: { equals: a.nombre, mode: "insensitive" },
      ...(a.id ? { id: { not: a.id } } : {}),
    },
    select: { id: true },
  });
  if (repetido) throw new ErrorDeNegocio(`Ya hay un artículo activo llamado "${a.nombre}".`);

  await controlarComponentes(tx, a);

  const datos = {
    nombre: a.nombre,
    descripcion: a.descripcion,
    precioVenta: a.precioVenta,
    ivaPct: a.ivaPct,
    esServicio: a.esServicio,
  };
  const articulo = a.id
    ? await tx.articulo.update({ where: { id: a.id }, data: datos, select: { id: true } })
    : await tx.articulo.create({ data: datos, select: { id: true } });

  const receta = await tx.receta.findUnique({ where: { articuloId: articulo.id }, select: { id: true } });
  if (receta) {
    await tx.recetaComponente.deleteMany({ where: { recetaId: receta.id } });
  }
  // Sin lineas y sin receta previa no se crea una receta vacia: el articulo
  // queda "sin receta", que es lo mismo pero sin una fila de mas.
  if (a.componentes.length > 0) {
    const recetaId =
      receta?.id ?? (await tx.receta.create({ data: { articuloId: articulo.id }, select: { id: true } })).id;
    // Los componentes se leen `orderBy: { id: "asc" }` (editor, catalogo,
    // venta). Con uuid al azar el orden que cargo el usuario se perderia: se
    // generan los ids, se ordenan y se asignan en el orden de las lineas.
    // Postgres compara uuid byte a byte, igual que el texto hexadecimal.
    const ids = a.componentes.map(() => randomUUID()).sort();
    await tx.recetaComponente.createMany({
      data: a.componentes.map((c, i) => ({ id: ids[i]!, recetaId, ...c })),
    });
  }

  return { id: articulo.id };
}

async function controlarComponentes(tx: Tx, a: ArticuloValidado) {
  const idsMateriales = [...new Set(a.componentes.flatMap((c) => (c.materialId ? [c.materialId] : [])))];
  const idsMaquinas = [...new Set(a.componentes.flatMap((c) => (c.maquinaId ? [c.maquinaId] : [])))];

  if (idsMateriales.some((id) => !PATRON_UUID.test(id))) throw new ErrorDeNegocio("Algún material de la receta no existe.");
  if (idsMaquinas.some((id) => !PATRON_UUID.test(id))) throw new ErrorDeNegocio("Alguna máquina de la receta no existe.");

  const [materiales, maquinas] = await Promise.all([
    tx.material.findMany({ where: { id: { in: idsMateriales } }, select: { id: true, nombre: true, activo: true } }),
    tx.maquina.findMany({ where: { id: { in: idsMaquinas } }, select: { id: true, nombre: true, activo: true } }),
  ]);

  if (materiales.length !== idsMateriales.length) throw new ErrorDeNegocio("Algún material de la receta no existe.");
  if (maquinas.length !== idsMaquinas.length) throw new ErrorDeNegocio("Alguna máquina de la receta no existe.");

  const materialDeBaja = materiales.find((m) => !m.activo);
  if (materialDeBaja) {
    throw new ErrorDeNegocio(
      `El material "${materialDeBaja.nombre}" está dado de baja: quitalo de la receta o reactivalo en Materiales.`,
    );
  }
  const maquinaDeBaja = maquinas.find((m) => !m.activo);
  if (maquinaDeBaja) {
    throw new ErrorDeNegocio(
      `La máquina "${maquinaDeBaja.nombre}" está dada de baja: quitala de la receta o reactivala en Configuración.`,
    );
  }
}

/**
 * Baja logica o reactivacion. Un articulo de baja no aparece en la venta ni en
 * el catalogo, pero sigue en las ventas viejas. Al reactivar se controla que no
 * choque de nombre con otro articulo activo.
 */
export async function cambiarActivoArticuloEnTx(tx: Tx, id: string, activo: boolean): Promise<void> {
  const articulo = await tx.articulo.findUnique({ where: { id }, select: { nombre: true } });
  if (!articulo) throw new ErrorDeNegocio("El artículo no existe.");

  if (activo) {
    const repetido = await tx.articulo.findFirst({
      where: { activo: true, id: { not: id }, nombre: { equals: articulo.nombre, mode: "insensitive" } },
      select: { id: true },
    });
    if (repetido) {
      throw new ErrorDeNegocio(`Ya hay un artículo activo llamado "${articulo.nombre}": renombrá uno de los dos.`);
    }
  }

  await tx.articulo.update({ where: { id }, data: { activo } });
}
