import { aCosto, d, type Dinero } from "@/lib/money";
import { ErrorDeNegocio } from "@/lib/acciones";
import { claveDeNombre, costoCambio } from "@/lib/materiales";
import type { UnidadMedida } from "@/generated/prisma/client";
import type { Tx } from "./tx";

export const MOTIVO_STOCK_INICIAL = "Stock inicial";

type DatosComunes = {
  nombre: string;
  unidad: UnidadMedida;
  stockMinimo: Dinero;
  costoUnitario: Dinero;
  /** null = solo insumo, no se vende suelto. */
  precioVenta: Dinero | null;
  notas: string | null;
};

export type MaterialNuevo = DatosComunes & {
  stockInicial: Dinero;
  /** Quien lo da de alta: queda en el movimiento "Stock inicial". Ausente = sin usuario. */
  usuarioId?: string | null;
};

export type MaterialEditado = DatosComunes & {
  id: string;
  /** Costo que tenia el material cuando se abrio el formulario. */
  costoOriginal: Dinero;
};

/** Rechaza un nombre que ya usa otro material activo (sin mirar mayusculas ni tildes). */
async function verificarNombreLibre(tx: Tx, nombre: string, excepto?: string) {
  const clave = claveDeNombre(nombre);
  const activos = await tx.material.findMany({
    where: { activo: true, ...(excepto ? { id: { not: excepto } } : {}) },
    select: { nombre: true },
  });
  const repetido = activos.find((m) => claveDeNombre(m.nombre) === clave);
  if (repetido) throw new ErrorDeNegocio(`Ya hay un material activo llamado "${repetido.nombre}".`);
}

/**
 * Alta de material. Si trae stock inicial, deja un movimiento AJUSTE "Stock
 * inicial" en la misma transaccion: el libro de movimientos tiene que cuadrar
 * con el stock desde el primer dia.
 */
export async function crearMaterialEnTx(tx: Tx, m: MaterialNuevo): Promise<{ id: string }> {
  await verificarNombreLibre(tx, m.nombre);

  const creado = await tx.material.create({
    data: {
      nombre: m.nombre,
      unidad: m.unidad,
      stockActual: m.stockInicial,
      stockMinimo: m.stockMinimo,
      costoUnitario: aCosto(m.costoUnitario),
      precioVenta: m.precioVenta === null ? null : aCosto(m.precioVenta),
      notas: m.notas,
    },
    select: { id: true },
  });

  if (m.stockInicial.gt(0)) {
    await tx.movimientoStock.create({
      data: {
        materialId: creado.id,
        tipo: "AJUSTE",
        cantidad: m.stockInicial,
        stockResultante: m.stockInicial,
        motivo: MOTIVO_STOCK_INICIAL,
        usuarioId: m.usuarioId ?? null,
      },
    });
  }
  return creado;
}

/**
 * Edicion de material. El stock NO se toca aca: solo cambia por compras,
 * ventas y ajustes, que dejan movimiento.
 *
 * El costo solo se escribe si el usuario lo cambio. Si mientras editaba entro
 * una compra que actualizo el costo, se rechaza en vez de pisarlo en silencio.
 *
 * La unidad no se puede cambiar si el material ya tiene movimientos o esta en
 * alguna receta: las cantidades guardadas quedarian en otra unidad.
 */
export async function editarMaterialEnTx(tx: Tx, m: MaterialEditado): Promise<{ cambioCosto: boolean }> {
  // FOR UPDATE: una compra concurrente espera a esta edicion (o al reves).
  const filas = await tx.$queryRaw<{ costoUnitario: string; unidad: UnidadMedida; activo: boolean }[]>`
    SELECT "costoUnitario"::text AS "costoUnitario", unidad::text AS unidad, activo
    FROM "materiales" WHERE id = ${m.id}::uuid FOR UPDATE`;
  const actual = filas[0];
  if (!actual) throw new ErrorDeNegocio("El material no existe.");
  if (!actual.activo) throw new ErrorDeNegocio("El material está dado de baja: reactivalo para editarlo.");

  await verificarNombreLibre(tx, m.nombre, m.id);

  if (m.unidad !== actual.unidad) {
    const [movimientos, componentes] = await Promise.all([
      tx.movimientoStock.count({ where: { materialId: m.id } }),
      tx.recetaComponente.count({ where: { materialId: m.id } }),
    ]);
    if (movimientos > 0 || componentes > 0) {
      throw new ErrorDeNegocio(
        "No se puede cambiar la unidad: el material ya tiene movimientos o está en recetas. Creá uno nuevo.",
      );
    }
  }

  const cambioCosto = costoCambio(aCosto(m.costoOriginal), aCosto(m.costoUnitario));
  if (cambioCosto && costoCambio(aCosto(m.costoOriginal), d(actual.costoUnitario))) {
    throw new ErrorDeNegocio("El costo cambió mientras editabas (por ejemplo, por una compra). Recargá la página.");
  }

  await tx.material.update({
    where: { id: m.id },
    data: {
      nombre: m.nombre,
      unidad: m.unidad,
      stockMinimo: m.stockMinimo,
      precioVenta: m.precioVenta === null ? null : aCosto(m.precioVenta),
      notas: m.notas,
      ...(cambioCosto ? { costoUnitario: aCosto(m.costoUnitario) } : {}),
    },
  });
  return { cambioCosto };
}

/**
 * Baja o reactivacion. Es baja logica: el material conserva movimientos,
 * compras y su lugar en las recetas. Las compras nuevas ya no lo ofrecen.
 * Al reactivar se vuelve a controlar que el nombre no choque con otro activo.
 */
export async function cambiarEstadoMaterialEnTx(tx: Tx, id: string, activo: boolean): Promise<void> {
  const material = await tx.material.findUnique({ where: { id }, select: { nombre: true, activo: true } });
  if (!material) throw new ErrorDeNegocio("El material no existe.");
  if (material.activo === activo) {
    throw new ErrorDeNegocio(activo ? "El material ya está activo." : "El material ya está dado de baja.");
  }
  if (activo) await verificarNombreLibre(tx, material.nombre, id);
  await tx.material.update({ where: { id }, data: { activo } });
}
