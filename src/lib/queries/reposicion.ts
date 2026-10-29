import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoMateriales } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { CERO, d, type Dinero } from "@/lib/money";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { armarReposicion, leerFactor, type MaterialParaReponer, type Reposicion } from "@/lib/reposicion";
import { getConfig } from "./catalogo";

/** Dias de consumo que se muestran como contexto junto a cada sugerencia. */
export const DIAS_CONSUMO = 30;

export type MaterialReposicion = MaterialParaReponer & {
  /** Unidad para mostrar ("m2", "u"). */
  etiquetaUnidad: string;
  /** Lo que salio por ventas en los ultimos `DIAS_CONSUMO` dias (neto de anulaciones). */
  consumo: Dinero;
};

export type DatosReposicion = Reposicion<MaterialReposicion> & {
  factor: Dinero;
  /** Materiales activos con minimo cargado: para distinguir "todo bien" de "no hay minimos". */
  conMinimo: number;
};

/** Lista de reposicion con el factor configurado. */
export const getReposicion = cache(
  (): Promise<DatosReposicion> =>
    conRespaldo(reposicionDesdeBase, reposicionDemo),
);

async function reposicionDesdeBase(): Promise<DatosReposicion> {
  const [config, materiales] = await Promise.all([
    getConfig(),
    prisma.material.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, unidad: true, stockActual: true, stockMinimo: true, costoUnitario: true },
    }),
  ]);
  const factor = leerFactor(config);

  const base = materiales.map((m) => ({
    ...m,
    unidad: m.unidad as string,
    etiquetaUnidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
    consumo: CERO,
  }));
  const reposicion = armarReposicion(base, factor);

  // Consumo solo de los que hay que reponer: es contexto, no entra en la cuenta.
  const ids = reposicion.lineas.map((l) => l.id);
  if (ids.length > 0) {
    const desde = new Date(Date.now() - DIAS_CONSUMO * 24 * 60 * 60 * 1000);
    const salidas = await prisma.movimientoStock.groupBy({
      by: ["materialId"],
      where: { tipo: "VENTA", materialId: { in: ids }, creadoEn: { gte: desde } },
      _sum: { cantidad: true },
    });
    // Las salidas son negativas y las anulaciones las devuelven en positivo.
    const consumo = new Map(salidas.map((s) => [s.materialId, d(s._sum.cantidad).neg()]));
    for (const linea of reposicion.lineas) {
      const c = consumo.get(linea.id);
      if (c && c.gt(0)) linea.consumo = c;
    }
  }

  return { ...reposicion, factor, conMinimo: materiales.filter((m) => m.stockMinimo.gt(0)).length };
}

/** Sin base: los materiales de ejemplo con el factor por defecto y sin consumo. */
function reposicionDemo(): DatosReposicion {
  const factor = leerFactor({});
  const codigoDe = (etiqueta: string) =>
    Object.entries(ETIQUETA_UNIDAD).find(([, e]) => e === etiqueta)?.[0] ?? etiqueta;
  const materiales = demoMateriales();
  const base = materiales.map((m) => ({
    id: m.id,
    nombre: m.nombre,
    unidad: codigoDe(m.unidad),
    etiquetaUnidad: m.unidad,
    stockActual: m.stockActual,
    stockMinimo: m.stockMinimo,
    costoUnitario: m.costoUnitario,
    consumo: CERO,
  }));
  return {
    ...armarReposicion(base, factor),
    factor,
    conMinimo: materiales.filter((m) => m.stockMinimo.gt(0)).length,
  };
}
