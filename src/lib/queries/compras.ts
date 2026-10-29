import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoCompras, demoMovimientos } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import type { Dinero } from "@/lib/money";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";

export { ETIQUETA_UNIDAD };

export type CompraListada = {
  id: string;
  fecha: Date;
  proveedor: string;
  comprobante: string | null;
  total: Dinero;
  /** Nombre de quien la cargo; null = historico (se muestra "—"). */
  registradoPor: string | null;
  items: { material: string; unidad: string; cantidad: Dinero; costoUnitario: Dinero }[];
};

export type MovimientoListado = {
  id: string;
  fecha: Date;
  tipo: "COMPRA" | "VENTA" | "AJUSTE";
  cantidad: Dinero;
  stockResultante: Dinero;
  motivo: string | null;
  /** Nombre de quien hizo el movimiento; null = historico (se muestra "—"). */
  registradoPor: string | null;
};


export const getCompras = cache(
  (limite = 50): Promise<CompraListada[]> =>
    conRespaldo(
      () => comprasDesdeBase(limite),
      () => demoCompras().slice(0, limite),
    ),
);

async function comprasDesdeBase(limite: number): Promise<CompraListada[]> {
  const compras = await prisma.compra.findMany({
    orderBy: [{ fecha: "desc" }, { creadoEn: "desc" }],
    take: limite,
    include: {
      items: { include: { material: { select: { nombre: true, unidad: true } } } },
      usuario: { select: { nombre: true } },
    },
  });

  return compras.map((c) => ({
    id: c.id,
    fecha: c.fecha,
    proveedor: c.proveedor,
    comprobante: c.comprobante,
    total: c.total,
    registradoPor: c.usuario?.nombre ?? null,
    items: c.items.map((i) => ({
      material: i.material.nombre,
      unidad: ETIQUETA_UNIDAD[i.material.unidad] ?? i.material.unidad,
      cantidad: i.cantidad,
      costoUnitario: i.costoUnitario,
    })),
  }));
}

/**
 * Libro de stock de un material, del movimiento mas reciente al mas antiguo.
 *
 * El motivo de una COMPRA dice a que proveedor se le compro ("Compra a X"):
 * con `sinProveedor` se descarta para quien no puede ver compras. El libro no
 * guarda costos, pero el proveedor tampoco es para todos.
 */
export const getMovimientos = cache(
  (materialId: string, limite = 100, sinProveedor = false): Promise<MovimientoListado[]> =>
    conRespaldo(
      async () => quitarProveedor(await movimientosDesdeBase(materialId, limite), sinProveedor),
      () => quitarProveedor(demoMovimientos(materialId).slice(0, limite), sinProveedor),
    ),
);

function quitarProveedor(movimientos: MovimientoListado[], quitar: boolean): MovimientoListado[] {
  return quitar ? movimientos.map((m) => (m.tipo === "COMPRA" ? { ...m, motivo: null } : m)) : movimientos;
}

async function movimientosDesdeBase(materialId: string, limite: number): Promise<MovimientoListado[]> {
  const movimientos = await prisma.movimientoStock.findMany({
    where: { materialId },
    orderBy: { creadoEn: "desc" },
    take: limite,
    include: { usuario: { select: { nombre: true } } },
  });
  return movimientos.map((m) => ({
    id: m.id,
    fecha: m.creadoEn,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stockResultante: m.stockResultante,
    motivo: m.motivo,
    registradoPor: m.usuario?.nombre ?? null,
  }));
}
