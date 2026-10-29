import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { conRespaldo } from "@/lib/respaldo";
import { d, type Dinero } from "@/lib/money";
import { demoArticulos } from "@/lib/demo-data";
import { getConfig } from "@/lib/queries/catalogo";
import { leerConfiguracion, type ConfiguracionNegocio } from "@/lib/configuracion";

/**
 * Configuracion del negocio con tipos y valores por defecto aplicados.
 * Sale de `getConfig()`, que ya tiene su respaldo de demostracion.
 */
export const getConfiguracion = cache(
  async (): Promise<ConfiguracionNegocio> => leerConfiguracion(await getConfig()),
);

/**
 * IVA por defecto para precargar el alta de articulos (21 si nunca se guardo).
 *
 *   const iva = await getIvaPorDefecto(); // Dinero
 */
export async function getIvaPorDefecto(): Promise<Dinero> {
  return (await getConfiguracion()).ivaPorDefecto;
}

/**
 * Cuantos articulos activos se costean con la mano de obra general: los que
 * tienen un componente MANO_OBRA sin costo propio (override). Son los que
 * cambian de costo y margen cuando cambia el costo/hora.
 */
export const getArticulosConManoObra = cache(
  (): Promise<number> =>
    conRespaldo(
      () =>
        prisma.articulo.count({
          where: {
            activo: true,
            receta: { componentes: { some: { tipo: "MANO_OBRA", costoUnitarioOverride: null } } },
          },
        }),
      () =>
        demoArticulos().filter((a) =>
          a.receta.componentes.some((c) => c.tipo === "MANO_OBRA" && !c.costoUnitarioOverride),
        ).length,
    ),
);

export type MaquinaListada = {
  id: string;
  nombre: string;
  costoHora: Dinero;
  notas: string | null;
  activo: boolean;
  /** Recetas de articulos activos que usan la maquina. */
  recetas: number;
};

/** Todas las maquinas (activas primero), con cuantas recetas las usan. */
export const getMaquinas = cache(
  (): Promise<MaquinaListada[]> => conRespaldo(maquinasDesdeBase, demoMaquinas),
);

export async function getMaquina(id: string): Promise<MaquinaListada | null> {
  return (await getMaquinas()).find((m) => m.id === id) ?? null;
}

async function maquinasDesdeBase(): Promise<MaquinaListada[]> {
  const [maquinas, usos] = await Promise.all([
    prisma.maquina.findMany({
      orderBy: [{ activo: "desc" }, { nombre: "asc" }],
      select: { id: true, nombre: true, costoHora: true, notas: true, activo: true },
    }),
    // Pares (maquina, receta) distintos: una receta que usa la maquina dos veces cuenta una.
    prisma.recetaComponente.findMany({
      where: { maquinaId: { not: null }, receta: { articulo: { activo: true } } },
      distinct: ["maquinaId", "recetaId"],
      select: { maquinaId: true },
    }),
  ]);

  const recetasPorMaquina = new Map<string, number>();
  for (const u of usos) {
    if (u.maquinaId) recetasPorMaquina.set(u.maquinaId, (recetasPorMaquina.get(u.maquinaId) ?? 0) + 1);
  }

  return maquinas.map((m) => ({ ...m, costoHora: d(m.costoHora), recetas: recetasPorMaquina.get(m.id) ?? 0 }));
}

/**
 * Respaldo local hasta que `demo-data.ts` exporte sus maquinas (parche
 * pendiente para el orquestador). Mismos nombres y costos que usan las recetas
 * de demostracion.
 */
function demoMaquinas(): MaquinaListada[] {
  return [
    { id: "q1", nombre: "Láser CO2", costoHora: d("8000"), notas: null, activo: true, recetas: 3 },
    { id: "q2", nombre: "Plotter de impresión", costoHora: d("2500"), notas: null, activo: true, recetas: 3 },
    { id: "q3", nombre: "Viniladora", costoHora: d("1500"), notas: null, activo: true, recetas: 2 },
  ];
}
