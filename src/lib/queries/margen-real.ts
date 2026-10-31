import { conNegocioActual } from "./stock";
import type { TxNegocio } from "@/lib/negocio";
import { conRespaldo } from "@/lib/respaldo";
import { d } from "@/lib/money";
import type { RangoFechas } from "@/lib/rango-fechas";
import { armarReporteMargenReal, type ReporteMargenReal, type TrabajoParaMargen } from "@/lib/margen-real";

/**
 * Margen real (ola 6, 6.2): lee los trabajos de produccion y los pasa a
 * `lib/margen-real.ts`, que hace toda la cuenta.
 *
 * Que entra: trabajos VIGENTES (`anuladoEn` nulo) de lineas de ventas NO anuladas,
 * con `TrabajoProduccion.fecha` en [desde, hasta) (el dia en que se hizo el
 * trabajo, no el de la venta). Solo lo lee el dueño: la pagina y el CSV verifican
 * `verMargenReal` ANTES de llamar a esta consulta.
 *
 * Sin base (modo demostracion) no hay trabajos de produccion: el respaldo es un
 * reporte vacio, y la pantalla lo dice. No se toca `demo-data.ts`.
 */

export type MargenRealPeriodo = ReporteMargenReal & {
  /** Periodo pedido: desde inclusivo, hasta exclusivo. */
  desde: Date;
  hasta: Date;
};

export function getMargenReal(rango: Pick<RangoFechas, "desde" | "hasta">): Promise<MargenRealPeriodo> {
  const { desde, hasta } = rango;
  return conRespaldo(
    async () => ({ ...armarReporteMargenReal(await conNegocioActual((tx) => trabajosVigentes(tx, desde, hasta))), desde, hasta }),
    () => ({ ...armarReporteMargenReal([]), desde, hasta }),
  );
}

async function trabajosVigentes(tx: TxNegocio, desde: Date, hasta: Date): Promise<TrabajoParaMargen[]> {
  const trabajos = await tx.trabajoProduccion.findMany({
    where: {
      fecha: { gte: desde, lt: hasta },
      anuladoEn: null,
      ventaItem: { venta: { estado: { not: "ANULADA" } } },
    },
    select: {
      id: true,
      fecha: true,
      minutosManoObra: true,
      costoHoraManoObraSnapshot: true,
      consumos: { select: { cantidad: true, costoUnitarioSnapshot: true } },
      tiempos: { select: { minutos: true, costoHoraSnapshot: true } },
      ventaItem: {
        select: {
          articuloId: true,
          articulo: { select: { nombre: true } },
          cantidad: true,
          subtotalNeto: true,
          costoTotalSnapshot: true,
          venta: { select: { id: true, numero: true, anio: true } },
        },
      },
    },
  });

  return trabajos.map((t) => ({
    id: t.id,
    fecha: t.fecha,
    ventaId: t.ventaItem.venta.id,
    ventaNumero: t.ventaItem.venta.numero,
    ventaAnio: t.ventaItem.venta.anio,
    articuloId: t.ventaItem.articuloId,
    articuloNombre: t.ventaItem.articulo.nombre,
    unidades: d(t.ventaItem.cantidad),
    precioNeto: d(t.ventaItem.subtotalNeto),
    costoReceta: d(t.ventaItem.costoTotalSnapshot),
    minutosManoObra: d(t.minutosManoObra),
    costoHoraManoObraSnapshot: d(t.costoHoraManoObraSnapshot),
    consumos: t.consumos.map((c) => ({ cantidad: d(c.cantidad), costoUnitarioSnapshot: d(c.costoUnitarioSnapshot) })),
    tiempos: t.tiempos.map((x) => ({ minutos: d(x.minutos), costoHoraSnapshot: d(x.costoHoraSnapshot) })),
  }));
}
