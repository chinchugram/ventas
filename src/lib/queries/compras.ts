import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoCompras, demoMovimientos } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import type { Dinero } from "@/lib/money";

export type CompraListada = {
  id: string;
  fecha: Date;
  proveedor: string;
  comprobante: string | null;
  total: Dinero;
  items: { material: string; unidad: string; cantidad: Dinero; costoUnitario: Dinero }[];
};

export type MovimientoListado = {
  id: string;
  fecha: Date;
  tipo: "COMPRA" | "VENTA" | "AJUSTE";
  cantidad: Dinero;
  stockResultante: Dinero;
  motivo: string | null;
};

export const ETIQUETA_UNIDAD: Record<string, string> = {
  M2: "m2",
  M: "m",
  KG: "kg",
  L: "L",
  U: "u",
  HOJA: "hoja",
  ROLLO: "rollo",
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
    },
  });

  return compras.map((c) => ({
    id: c.id,
    fecha: c.fecha,
    proveedor: c.proveedor,
    comprobante: c.comprobante,
    total: c.total,
    items: c.items.map((i) => ({
      material: i.material.nombre,
      unidad: ETIQUETA_UNIDAD[i.material.unidad] ?? i.material.unidad,
      cantidad: i.cantidad,
      costoUnitario: i.costoUnitario,
    })),
  }));
}

/** Libro de stock de un material, del movimiento mas reciente al mas antiguo. */
export const getMovimientos = cache(
  (materialId: string, limite = 100): Promise<MovimientoListado[]> =>
    conRespaldo(
      () => movimientosDesdeBase(materialId, limite),
      () => demoMovimientos(materialId).slice(0, limite),
    ),
);

async function movimientosDesdeBase(materialId: string, limite: number): Promise<MovimientoListado[]> {
  const movimientos = await prisma.movimientoStock.findMany({
    where: { materialId },
    orderBy: { creadoEn: "desc" },
    take: limite,
  });
  return movimientos.map((m) => ({
    id: m.id,
    fecha: m.creadoEn,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stockResultante: m.stockResultante,
    motivo: m.motivo,
  }));
}
