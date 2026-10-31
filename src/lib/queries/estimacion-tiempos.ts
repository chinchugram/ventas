import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { conRespaldo } from "@/lib/respaldo";
import { SIN_BASE } from "@/lib/acciones";
import { d } from "@/lib/money";
import {
  estimarLinea,
  esIdValido,
  totalizarPedido,
  validarPedido,
  MIN_MUESTRAS,
  N_TRABAJOS_MUESTRA,
  type LineaEstimada,
  type LineaPedida,
  type TotalPedido,
  type TrabajoHistorico,
} from "@/lib/estimacion-tiempos";

// Estimacion de tiempos de un pedido (ola 6, 6.3). SOLO LECTURA y sin costos: el
// historial sale de los trabajos VIGENTES (`anuladoEn` nulo) del MISMO articulo
// (`TrabajoProduccion` → `ventaItem.articuloId`), los N mas recientes. La cuenta
// es de `src/lib/estimacion-tiempos.ts`; aca solo se leen los datos.
//
// Un trabajo cuenta aunque su venta se haya anulado despues: los minutos medidos
// fueron reales. Lo que no cuenta es un trabajo anulado (dado de baja por error).

export type ArticuloParaEstimar = { id: string; nombre: string };

export type ResultadoEstimacion =
  | {
      ok: true;
      lineas: LineaEstimada[];
      total: TotalPedido;
      /** Parametros con los que se calculo, para mostrarlos ("mediana de los ultimos 10, minimo 3"). */
      criterio: { n: number; minMuestras: number };
    }
  | { ok: false; errores: string[] };

const CRITERIO = { n: N_TRABAJOS_MUESTRA, minMuestras: MIN_MUESTRAS };

/** Articulos activos para elegir en la pantalla. */
export const getArticulosParaEstimar = cache(
  (): Promise<ArticuloParaEstimar[]> =>
    conRespaldo(
      () =>
        prisma.articulo.findMany({
          where: { activo: true },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true },
        }),
      () => [],
    ),
);

/**
 * Valida el pedido (texto crudo del formulario o de la URL), verifica que los
 * articulos existan y estima. Nunca lanza por una entrada invalida: devuelve
 * `{ ok: false, errores }` con mensajes para el usuario.
 */
export async function estimarTiempos(entradas: readonly { articuloId: string; cantidad: string }[]): Promise<ResultadoEstimacion> {
  const validado = validarPedido(entradas);
  if (!validado.ok) return validado;
  return conRespaldo<ResultadoEstimacion>(
    () => estimarDesdeBase(validado.lineas),
    () => ({ ok: false, errores: [SIN_BASE] }),
  );
}

async function estimarDesdeBase(pedidas: LineaPedida[]): Promise<ResultadoEstimacion> {
  const ids = [...new Set(pedidas.map((l) => l.articuloId))].filter(esIdValido);
  const articulos = await prisma.articulo.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } });
  const nombres = new Map(articulos.map((a) => [a.id, a.nombre]));

  const errores = pedidas.flatMap((l, i) => (nombres.has(l.articuloId) ? [] : [`Línea ${i + 1}: el artículo no existe.`]));
  if (errores.length) return { ok: false, errores };

  // Un historial por articulo, aunque aparezca en varias lineas.
  const historiales = new Map(await Promise.all(ids.map(async (id) => [id, await historialDe(id)] as const)));

  const lineas = pedidas.map((l) =>
    estimarLinea({ articuloId: l.articuloId, nombre: nombres.get(l.articuloId)!, cantidad: l.cantidad }, historiales.get(l.articuloId)!, CRITERIO),
  );
  return { ok: true, lineas, total: totalizarPedido(lineas), criterio: CRITERIO };
}

/** Ultimos N trabajos vigentes del articulo, del mas reciente al mas viejo. */
async function historialDe(articuloId: string): Promise<TrabajoHistorico[]> {
  const trabajos = await prisma.trabajoProduccion.findMany({
    where: { anuladoEn: null, ventaItem: { articuloId } },
    orderBy: [{ fecha: "desc" }, { creadoEn: "desc" }, { id: "desc" }],
    take: CRITERIO.n,
    // Solo tiempos y cantidades: ningun costo (snapshots) sale de la base.
    select: {
      minutosManoObra: true,
      ventaItem: { select: { cantidad: true } },
      tiempos: { select: { minutos: true, maquina: { select: { id: true, nombre: true } } } },
    },
  });
  return trabajos.map((t) => ({
    cantidad: d(t.ventaItem.cantidad),
    minutosManoObra: d(t.minutosManoObra),
    tiempos: t.tiempos.map((x) => ({ maquinaId: x.maquina.id, maquinaNombre: x.maquina.nombre, minutos: d(x.minutos) })),
  }));
}
