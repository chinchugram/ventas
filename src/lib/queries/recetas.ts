import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoArticulos, demoMateriales } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import type { CatalogoCostos, LineaBorrador, OpcionCosto } from "@/lib/recetas";

// Lecturas del editor de articulos y recetas. Todo viaja al cliente como texto
// (los Decimal no son serializables): el formulario reconstruye los Decimal
// para el costeo en vivo.

/** Articulo listo para cargar en el formulario de edicion. */
export type ArticuloParaEditar = {
  id: string;
  nombre: string;
  descripcion: string;
  precioVenta: string;
  ivaPct: string;
  esServicio: boolean;
  activo: boolean;
  lineas: LineaBorrador[];
};

export type EditorArticulo = {
  articulo: ArticuloParaEditar;
  /**
   * Materiales y maquinas activos, mas los de baja que la receta todavia usa
   * (con `activo: false`), para poder mostrarlos y pedir que se reemplacen.
   */
  catalogo: CatalogoCostos;
};

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Materiales y maquinas activos con su costo vigente, para un articulo nuevo. */
export const getCatalogoCostos = cache(
  (): Promise<CatalogoCostos> => conRespaldo(() => catalogoDesdeBase([], []), catalogoDemo),
);

async function catalogoDesdeBase(materialesExtra: string[], maquinasExtra: string[]): Promise<CatalogoCostos> {
  const [materiales, maquinas] = await Promise.all([
    prisma.material.findMany({
      where: { OR: [{ activo: true }, { id: { in: materialesExtra } }] },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, costoUnitario: true, unidad: true, activo: true },
    }),
    prisma.maquina.findMany({
      where: { OR: [{ activo: true }, { id: { in: maquinasExtra } }] },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, costoHora: true, activo: true },
    }),
  ]);

  return {
    materiales: materiales.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      costo: m.costoUnitario.toString(),
      unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
      activo: m.activo,
    })),
    maquinas: maquinas.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      costo: m.costoHora.toString(),
      unidad: "h",
      activo: m.activo,
    })),
  };
}

/**
 * Articulo (activo o de baja) con su receta y el catalogo de costos para
 * editarlo. `null` si no existe.
 */
export const getEditorArticulo = cache(
  (id: string): Promise<EditorArticulo | null> => conRespaldo(() => editorDesdeBase(id), () => editorDemo(id)),
);

async function editorDesdeBase(id: string): Promise<EditorArticulo | null> {
  // Un id mal formado haria fallar la consulta y `conRespaldo` mostraria datos
  // de demostracion: se corta antes.
  if (!PATRON_UUID.test(id)) return null;

  const a = await prisma.articulo.findUnique({
    where: { id },
    include: { receta: { include: { componentes: { orderBy: { id: "asc" } } } } },
  });
  if (!a) return null;

  const componentes = a.receta?.componentes ?? [];
  const catalogo = await catalogoDesdeBase(
    componentes.flatMap((c) => (c.materialId ? [c.materialId] : [])),
    componentes.flatMap((c) => (c.maquinaId ? [c.maquinaId] : [])),
  );

  return {
    articulo: {
      id: a.id,
      nombre: a.nombre,
      descripcion: a.descripcion ?? "",
      precioVenta: a.precioVenta.toString(),
      ivaPct: a.ivaPct.toString(),
      esServicio: a.esServicio,
      activo: a.activo,
      lineas: componentes.map((c) => ({
        tipo: c.tipo,
        materialId: c.materialId ?? "",
        maquinaId: c.maquinaId ?? "",
        cantidad: c.cantidad.toString(),
        override: c.costoUnitarioOverride?.toString() ?? "",
        notas: c.notas ?? "",
      })),
    },
    catalogo,
  };
}

/** Articulos dados de baja, para poder abrirlos y reactivarlos. */
export const getArticulosDeBaja = cache(
  (): Promise<{ id: string; nombre: string }[]> =>
    conRespaldo(
      () =>
        prisma.articulo.findMany({
          where: { activo: false },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true },
        }),
      () => [],
    ),
);

// ─── Demostracion ─────────────────────────────────────────────────────────────
// Derivada de `demo-data.ts` sin tocarlo: las maquinas no tienen listado propio
// ahi, asi que se arman con las que aparecen en las recetas de ejemplo.

const idMaquinaDemo = (nombre: string) => `demo-maq-${nombre}`;

function catalogoDemo(): CatalogoCostos {
  const maquinas = new Map<string, OpcionCosto>();
  for (const a of demoArticulos()) {
    for (const c of a.receta.componentes) {
      if (c.tipo === "MAQUINA" && !maquinas.has(c.etiqueta)) {
        maquinas.set(c.etiqueta, {
          id: idMaquinaDemo(c.etiqueta),
          nombre: c.etiqueta,
          costo: c.costoUnitario.toString(),
          unidad: "h",
          activo: true,
        });
      }
    }
  }
  return {
    materiales: demoMateriales().map((m) => ({
      id: m.id,
      nombre: m.nombre,
      costo: m.costoUnitario.toString(),
      unidad: m.unidad,
      activo: true,
    })),
    maquinas: [...maquinas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
  };
}

function editorDemo(id: string): EditorArticulo | null {
  const a = demoArticulos().find((x) => x.id === id);
  if (!a) return null;
  const catalogo = catalogoDemo();
  const idMaterial = (nombre: string) => catalogo.materiales.find((m) => m.nombre === nombre)?.id ?? "";

  return {
    articulo: {
      id: a.id,
      nombre: a.nombre,
      descripcion: a.descripcion ?? "",
      precioVenta: a.precioVenta.toString(),
      ivaPct: a.ivaPct.toString(),
      esServicio: a.esServicio,
      activo: true,
      lineas: a.receta.componentes.map((c) => ({
        tipo: c.tipo,
        materialId: c.tipo === "MATERIAL" ? idMaterial(c.etiqueta) : "",
        maquinaId: c.tipo === "MAQUINA" ? idMaquinaDemo(c.etiqueta) : "",
        cantidad: c.cantidad.toString(),
        override: "",
        notas: c.notas ?? "",
      })),
    },
    catalogo,
  };
}
