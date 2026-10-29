import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { DEMO_CONFIG, demoMateriales } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { d, type Dinero } from "@/lib/money";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { configNumero } from "@/lib/receta";
import type { ArticuloConReceta } from "@/lib/materiales";
import type { UnidadMedida } from "@/generated/prisma/client";
import { getConfig } from "./catalogo";

/** Lo que ve cualquier usuario con sesion de un material: cantidades, sin plata. */
export type MaterialStock = {
  id: string;
  nombre: string;
  unidad: string;
  stockActual: Dinero;
  stockMinimo: Dinero;
  estado: "SIN_STOCK" | "BAJO" | "OK";
};

/** El material trae costo, precio y valorizacion (solo lo arma `getMateriales`, nunca `getMaterialesStock`). */
export function tieneCostos(material: MaterialStock): material is MaterialListado {
  return "costoUnitario" in material;
}

export type MaterialListado = MaterialStock & {
  costoUnitario: Dinero;
  precioVenta: Dinero | null;
  /** Cuanto dinero hay parado en el material, a costo. */
  valorInventario: Dinero;
};

/** Materiales con su valorizacion y estado contra el minimo. */
export const getMateriales = cache(
  (): Promise<MaterialListado[]> => conRespaldo(materialesDesdeBase, demoMateriales),
);

/**
 * Materiales SOLO con cantidades (sin costo, precio ni valorizacion), para quien
 * no puede `verCostos`. A diferencia de `getMateriales`, ni siquiera lee las
 * columnas de plata de la base.
 */
export const getMaterialesStock = cache(
  (): Promise<MaterialStock[]> =>
    conRespaldo(
      async () => {
        const materiales = await prisma.material.findMany({
          where: { activo: true },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true, unidad: true, stockActual: true, stockMinimo: true },
        });
        return materiales.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
          stockActual: m.stockActual,
          stockMinimo: m.stockMinimo,
          estado: estadoDeStock(m.stockActual, m.stockMinimo),
        }));
      },
      () =>
        demoMateriales().map(({ id, nombre, unidad, stockActual, stockMinimo, estado }) => ({
          id,
          nombre,
          unidad,
          stockActual,
          stockMinimo,
          estado,
        })),
    ),
);

/** Sin minimo cargado no hay alerta posible: se informa OK, no se inventan. */
function estadoDeStock(stockActual: Dinero, stockMinimo: Dinero): MaterialStock["estado"] {
  if (stockMinimo.cmp(0) <= 0) return "OK";
  if (stockActual.cmp(0) <= 0) return "SIN_STOCK";
  return stockActual.cmp(stockMinimo) <= 0 ? "BAJO" : "OK";
}

const SELECT_LISTADO = {
  id: true,
  nombre: true,
  unidad: true,
  stockActual: true,
  stockMinimo: true,
  costoUnitario: true,
  precioVenta: true,
} as const;

async function materialesDesdeBase(): Promise<MaterialListado[]> {
  const materiales = await prisma.material.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    select: SELECT_LISTADO,
  });
  return materiales.map(aListado);
}

type FilaListado = {
  id: string;
  nombre: string;
  unidad: string;
  stockActual: Dinero;
  stockMinimo: Dinero;
  costoUnitario: Dinero;
  precioVenta: Dinero | null;
};

function aListado(m: FilaListado): MaterialListado {
  return {
    id: m.id,
    nombre: m.nombre,
    unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
    stockActual: m.stockActual,
    stockMinimo: m.stockMinimo,
    costoUnitario: m.costoUnitario,
    precioVenta: m.precioVenta,
    valorInventario: d(m.stockActual).times(m.costoUnitario).toDecimalPlaces(2),
    estado: estadoDeStock(m.stockActual, m.stockMinimo),
  };
}

// ─── Gestion (alta, edicion, baja) ────────────────────────────────────────────

export type MaterialDeBaja = MaterialListado & {
  /** Articulos activos que todavia lo tienen en la receta. */
  articulosQueLoUsan: number;
};

/** Materiales dados de baja, para poder verlos y reactivarlos. */
export const getMaterialesDeBaja = cache(
  (): Promise<MaterialDeBaja[]> => conRespaldo(materialesDeBajaDesdeBase, () => []),
);

async function materialesDeBajaDesdeBase(): Promise<MaterialDeBaja[]> {
  const materiales = await prisma.material.findMany({
    where: { activo: false },
    orderBy: { nombre: "asc" },
    select: {
      ...SELECT_LISTADO,
      componentes: {
        where: { receta: { articulo: { activo: true } } },
        select: { receta: { select: { articuloId: true } } },
      },
    },
  });
  return materiales.map(({ componentes, ...m }) => ({
    ...aListado(m),
    articulosQueLoUsan: new Set(componentes.map((c) => c.receta.articuloId)).size,
  }));
}

export type MaterialParaEditar = {
  id: string;
  nombre: string;
  unidad: UnidadMedida;
  stockActual: Dinero;
  stockMinimo: Dinero;
  costoUnitario: Dinero;
  precioVenta: Dinero | null;
  notas: string | null;
  activo: boolean;
  /** Tiene movimientos o esta en recetas: la unidad ya no se puede cambiar. */
  unidadBloqueada: boolean;
  /** Articulos activos cuya receta usa el material, con la receta completa. */
  articulos: ArticuloConReceta[];
  costoHoraManoObra: Dinero;
  margenObjetivoPct: Dinero;
};

/** Un material (activo o de baja) con lo necesario para editarlo y medir el impacto en margen. */
export const getMaterialParaEditar = cache(
  (id: string): Promise<MaterialParaEditar | null> =>
    conRespaldo(
      () => materialParaEditarDesdeBase(id),
      () => materialParaEditarDemo(id),
    ),
);

async function materialParaEditarDesdeBase(id: string): Promise<MaterialParaEditar | null> {
  // Un id que no es uuid haria fallar la consulta (y caer al modo demo): es un 404.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const [material, config] = await Promise.all([
    prisma.material.findUnique({
      where: { id },
      include: { _count: { select: { movimientos: true, componentes: true } } },
    }),
    getConfig(),
  ]);
  if (!material) return null;

  const articulos = await prisma.articulo.findMany({
    where: { activo: true, receta: { componentes: { some: { materialId: id } } } },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      precioVenta: true,
      ivaPct: true,
      receta: {
        select: {
          componentes: {
            orderBy: { id: "asc" },
            select: {
              id: true,
              tipo: true,
              materialId: true,
              cantidad: true,
              costoUnitarioOverride: true,
              notas: true,
              material: { select: { nombre: true, costoUnitario: true, unidad: true } },
              maquina: { select: { nombre: true, costoHora: true } },
            },
          },
        },
      },
    },
  });

  return {
    id: material.id,
    nombre: material.nombre,
    unidad: material.unidad,
    stockActual: material.stockActual,
    stockMinimo: material.stockMinimo,
    costoUnitario: material.costoUnitario,
    precioVenta: material.precioVenta,
    notas: material.notas,
    activo: material.activo,
    unidadBloqueada: material._count.movimientos > 0 || material._count.componentes > 0,
    articulos: articulos.map((a) => ({
      id: a.id,
      nombre: a.nombre,
      precioVenta: a.precioVenta,
      ivaPct: a.ivaPct,
      componentes: a.receta?.componentes ?? [],
    })),
    costoHoraManoObra: configNumero(config, "costoHoraManoObra", "0"),
    margenObjetivoPct: configNumero(config, "margenObjetivo", "40"),
  };
}

/** Sin base: el material del juego de demostracion, sin recetas para medir impacto. */
function materialParaEditarDemo(id: string): MaterialParaEditar | null {
  const m = demoMateriales().find((x) => x.id === id);
  if (!m) return null;
  const unidad = (Object.entries(ETIQUETA_UNIDAD).find(([, etiqueta]) => etiqueta === m.unidad)?.[0] ??
    "U") as UnidadMedida;
  return {
    id: m.id,
    nombre: m.nombre,
    unidad,
    stockActual: m.stockActual,
    stockMinimo: m.stockMinimo,
    costoUnitario: m.costoUnitario,
    precioVenta: m.precioVenta,
    notas: null,
    activo: true,
    unidadBloqueada: true,
    articulos: [],
    costoHoraManoObra: d(DEMO_CONFIG.costoHoraManoObra ?? "0"),
    margenObjetivoPct: d(DEMO_CONFIG.margenObjetivo ?? "40"),
  };
}
