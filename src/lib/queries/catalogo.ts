import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { DEMO_CONFIG, demoArticulos } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { CERO, d, Dinero } from "@/lib/money";
import {
  calcularMargen,
  ComponenteResuelto,
  costearReceta,
  Margen,
  ResultadoReceta,
} from "@/lib/costing";

/**
 * Configuracion del negocio, memoizada por request.
 *
 * Se lee en casi todos los renders (costo/hora de mano de obra, IVA por defecto,
 * margen objetivo) y cambiar muy seguido, asi que un SELECT por pagina alcanza.
 */
export const getConfig = cache(
  (): Promise<Record<string, string>> =>
    conRespaldo(
      async () => {
        const filas = await prisma.configuracion.findMany();
        return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
      },
      () => DEMO_CONFIG,
    ),
);

export function configNumero(config: Record<string, string>, clave: string, porDefecto: string): Dinero {
  return d(config[clave] ?? porDefecto);
}

/**
 * Articulos con su costo de receta resuelto y el margen calculado.
 *
 * Es la consulta que responde la pregunta central del negocio: cuanto le sale,
 * a cuanto lo vende, cuanto gana. Todo el catalogo se trae en una sola query con
 * include anidado; el volumen esperado (cientos de articulos) lo tolera de
 * sobra y evita N+1.
 */
export const getArticulosConMargen = cache(
  (): Promise<ArticuloConMargen[]> => conRespaldo(articulosDesdeBase, demoArticulos),
);

async function articulosDesdeBase(): Promise<ArticuloConMargen[]> {
  const config = await getConfig();
  const costoHoraManoObra = configNumero(config, "costoHoraManoObra", "0");

  const articulos = await prisma.articulo.findMany({
    where: { activo: true },
    orderBy: { nombre: "asc" },
    include: {
      receta: {
        include: {
          componentes: {
            include: { material: true, maquina: true },
            orderBy: { id: "asc" },
          },
        },
      },
    },
  });

  return articulos.map((a) => {
    const receta = recetaResuelta(a.receta?.componentes ?? [], costoHoraManoObra);
    const margen = calcularMargen({
      precioBruto: a.precioVenta,
      costo: receta.costoTotal,
      ivaPct: a.ivaPct,
      costoConfiable: receta.confiable,
    });

    return {
      id: a.id,
      nombre: a.nombre,
      descripcion: a.descripcion,
      precioVenta: a.precioVenta,
      ivaPct: a.ivaPct,
      esServicio: a.esServicio,
      receta,
      margen,
    };
  });
}

export type ArticuloConMargen = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precioVenta: Dinero;
  ivaPct: Dinero;
  esServicio: boolean;
  receta: ResultadoReceta;
  margen: Margen;
};

type ComponenteDb = {
  id: string;
  tipo: "MATERIAL" | "MAQUINA" | "MANO_OBRA";
  cantidad: Dinero;
  costoUnitarioOverride: Dinero | null;
  notas: string | null;
  material: { nombre: string; costoUnitario: Dinero; unidad: string } | null;
  maquina: { nombre: string; costoHora: Dinero } | null;
};

/**
 * Traduce componentes de la base a valores planos para el motor de costeo.
 *
 * El orden de resolucion del costo unitario, en palabras:
 *   1. override explicito en la receta (gana sobre todo)
 *   2. costo/hora de la maquina
 *   3. costo unitario del material
 *   4. costo/hora de mano de obra general
 */
export function recetaResuelta(
  componentes: ComponenteDb[],
  costoHoraManoObra: Dinero,
): ResultadoReceta {
  const resueltos: ComponenteResuelto[] = componentes.map((c) => {
    const conOverride = c.costoUnitarioOverride !== null;

    switch (c.tipo) {
      case "MATERIAL": {
        const material = c.material;
        return {
          id: c.id,
          tipo: c.tipo,
          etiqueta: material?.nombre ?? "Material eliminado",
          cantidad: c.cantidad,
          costoUnitario: conOverride ? c.costoUnitarioOverride! : (material?.costoUnitario ?? CERO),
          costoUnitarioOverride: conOverride,
          notas: c.notas,
        };
      }
      case "MAQUINA": {
        const maquina = c.maquina;
        return {
          id: c.id,
          tipo: c.tipo,
          etiqueta: maquina?.nombre ?? "Maquina eliminada",
          cantidad: c.cantidad,
          costoUnitario: conOverride ? c.costoUnitarioOverride! : (maquina?.costoHora ?? CERO),
          costoUnitarioOverride: conOverride,
          notas: c.notas,
        };
      }
      case "MANO_OBRA":
        return {
          id: c.id,
          tipo: c.tipo,
          etiqueta: "Mano de obra",
          cantidad: c.cantidad,
          costoUnitario: conOverride ? c.costoUnitarioOverride! : costoHoraManoObra,
          costoUnitarioOverride: conOverride,
          notas: c.notas,
        };
    }
  });

  return costearReceta(resueltos, costoHoraManoObra);
}
