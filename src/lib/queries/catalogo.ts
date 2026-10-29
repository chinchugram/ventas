import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { DEMO_CONFIG, demoArticulos } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { configNumero, recetaResuelta } from "@/lib/receta";
import type { Dinero } from "@/lib/money";
import { calcularMargen, Margen, ResultadoReceta } from "@/lib/costing";

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

export { configNumero, recetaResuelta };
