import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoMateriales } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { d, type Dinero } from "@/lib/money";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";

export type MaterialListado = {
  id: string;
  nombre: string;
  unidad: string;
  stockActual: Dinero;
  stockMinimo: Dinero;
  costoUnitario: Dinero;
  precioVenta: Dinero | null;
  /** Cuanto dinero hay parado en el material, a costo. */
  valorInventario: Dinero;
  estado: "SIN_STOCK" | "BAJO" | "OK";
};

/** Materiales con su valorizacion y estado contra el minimo. */
export const getMateriales = cache(
  (): Promise<MaterialListado[]> => conRespaldo(materialesDesdeBase, demoMateriales),
);

async function materialesDesdeBase(): Promise<MaterialListado[]> {
  const materiales = await prisma.material.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      unidad: true,
      stockActual: true,
      stockMinimo: true,
      costoUnitario: true,
      precioVenta: true,
    },
  });

  return materiales.map((m) => {
    const sinMinimo = m.stockMinimo.cmp(0) <= 0;
    const agotado = m.stockActual.cmp(0) <= 0;
    const bajo = m.stockActual.cmp(m.stockMinimo) <= 0;

    return {
      id: m.id,
      nombre: m.nombre,
      unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
      stockActual: m.stockActual,
      stockMinimo: m.stockMinimo,
      costoUnitario: m.costoUnitario,
      precioVenta: m.precioVenta,
      valorInventario: d(m.stockActual).times(m.costoUnitario).toDecimalPlaces(2),
      // Sin minimo cargado no hay alerta posible: se informa OK, no se inventan.
      estado: sinMinimo ? "OK" : agotado ? "SIN_STOCK" : bajo ? "BAJO" : "OK",
    };
  });
}
