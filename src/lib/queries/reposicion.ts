import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoMateriales } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { CERO, d, type Dinero } from "@/lib/money";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import {
  armarReposicion,
  leerFactor,
  type LineaReposicion,
  type MaterialParaReponer,
  type Reposicion,
} from "@/lib/reposicion";
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
  await completarConsumo(reposicion.lineas);

  return { ...reposicion, factor, conMinimo: materiales.filter((m) => m.stockMinimo.gt(0)).length };
}

/** Consumo solo de los que hay que reponer: es contexto, no entra en la cuenta. */
async function completarConsumo(lineas: { id: string; consumo: Dinero }[]): Promise<void> {
  const ids = lineas.map((l) => l.id);
  if (ids.length === 0) return;
  const desde = new Date(Date.now() - DIAS_CONSUMO * 24 * 60 * 60 * 1000);
  const salidas = await prisma.movimientoStock.groupBy({
    by: ["materialId"],
    where: { tipo: "VENTA", materialId: { in: ids }, creadoEn: { gte: desde } },
    _sum: { cantidad: true },
  });
  // Las salidas son negativas y las anulaciones las devuelven en positivo.
  const consumo = new Map(salidas.map((s) => [s.materialId, d(s._sum.cantidad).neg()]));
  for (const linea of lineas) {
    const c = consumo.get(linea.id);
    if (c && c.gt(0)) linea.consumo = c;
  }
}

// ─── Sin costos ───────────────────────────────────────────────────────────────

/** Una linea de la lista de reposicion sin plata: material, cantidad a comprar y contexto. */
export type LineaReposicionSinCostos = Omit<LineaReposicion<MaterialReposicion>, "costoUnitario" | "costoEstimado">;

export type DatosReposicionSinCostos = {
  lineas: LineaReposicionSinCostos[];
  factor: Dinero;
  conMinimo: number;
};

/**
 * La lista de reposicion para quien no puede `verCostos`: mismas lineas y
 * cantidades, pero sin costo por unidad, costo estimado ni total. La base no
 * se consulta por `costoUnitario` (la cantidad sugerida no depende del costo).
 */
export const getReposicionSinCostos = cache(
  (): Promise<DatosReposicionSinCostos> =>
    conRespaldo(
      async () => {
        const [config, materiales] = await Promise.all([
          getConfig(),
          prisma.material.findMany({
            where: { activo: true },
            orderBy: { nombre: "asc" },
            select: { id: true, nombre: true, unidad: true, stockActual: true, stockMinimo: true },
          }),
        ]);
        const factor = leerFactor(config);
        const base = materiales.map((m) => ({
          ...m,
          unidad: m.unidad as string,
          etiquetaUnidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
          consumo: CERO,
          costoUnitario: CERO,
        }));
        const { lineas } = armarReposicion(base, factor);
        await completarConsumo(lineas);
        return {
          lineas: lineas.map(sinCostos),
          factor,
          conMinimo: materiales.filter((m) => m.stockMinimo.gt(0)).length,
        };
      },
      () => {
        const { lineas, factor, conMinimo } = reposicionDemo();
        return { lineas: lineas.map(sinCostos), factor, conMinimo };
      },
    ),
);

function sinCostos(linea: LineaReposicion<MaterialReposicion>): LineaReposicionSinCostos {
  const { costoUnitario: _costo, costoEstimado: _estimado, ...resto } = linea;
  return resto;
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
