"use server";

import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { CERO, d, fmtNumero, type Dinero } from "@/lib/money";
import { costearLineaVenta, totalizarVenta } from "@/lib/costing";
import { configNumero, recetaResuelta } from "@/lib/queries/catalogo";
import { ETIQUETA_UNIDAD } from "@/lib/queries/compras";
import { revalidarVentas } from "@/lib/revalidar";

export type ResultadoVenta =
  | { ok: true; id: string; numero: number; anio: number; advertencias: string[] }
  | { ok: false; error: string };

const decimalPositivo = z
  .string()
  .trim()
  .refine((v) => /^\d+([.,]\d+)?$/.test(v) && Number(v.replace(",", ".")) > 0, "Debe ser un número mayor a 0");

const esquemaVenta = z.object({
  clienteId: z.uuid("Cliente inválido"),
  observaciones: z.string().trim().max(500).optional(),
  entregada: z.boolean(),
  items: z
    .array(z.object({ articuloId: z.uuid("Artículo inválido"), cantidad: decimalPositivo }))
    .min(1, "Agregá al menos un artículo"),
  pago: z
    .object({
      monto: decimalPositivo,
      metodo: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"]),
    })
    .nullable(),
});

export type DatosVenta = z.input<typeof esquemaVenta>;

class ErrorDeNegocio extends Error {}

const hoyArgentina = () =>
  new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })}T00:00:00Z`);

/**
 * Confirma una venta. Todo se recalcula en el servidor a partir de la base:
 * precio, IVA y costo de receta del momento. Lo que manda el navegador es solo
 * que se vendio, cuanto y a quien, asi que un cliente alterado no puede fijar
 * precios ni costos.
 *
 * En una sola transaccion: numera la venta, congela los costos, descuenta el
 * stock de los materiales de cada receta (con un movimiento por material) y
 * registra el pago inicial si lo hubo.
 *
 * Nunca se frena una venta por falta de stock: el sistema puede estar
 * desactualizado y el pedido ya esta hecho. Se descuenta lo que hay, se deja
 * constancia en el movimiento y se devuelve una advertencia.
 */
export async function registrarVenta(datos: DatosVenta): Promise<ResultadoVenta> {
  const parsed = esquemaVenta.safeParse(datos);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  if (!(await dbDisponible())) {
    return { ok: false, error: "No hay base de datos conectada: esta pantalla está en modo demostración y no guarda." };
  }

  const { clienteId, observaciones, entregada, pago } = parsed.data;
  const lineas = parsed.data.items.map((i) => ({
    articuloId: i.articuloId,
    cantidad: d(i.cantidad.replace(",", ".")),
  }));
  const fecha = hoyArgentina();
  const anio = fecha.getUTCFullYear();

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.findFirst({ where: { id: clienteId, activo: true }, select: { id: true } });
      if (!cliente) throw new ErrorDeNegocio("El cliente no existe o está dado de baja.");

      const ids = [...new Set(lineas.map((l) => l.articuloId))];
      const articulos = await tx.articulo.findMany({
        where: { id: { in: ids }, activo: true },
        include: {
          receta: { include: { componentes: { include: { material: true, maquina: true }, orderBy: { id: "asc" } } } },
        },
      });
      if (articulos.length !== ids.length) throw new ErrorDeNegocio("Algún artículo ya no existe o está dado de baja.");
      const porId = new Map(articulos.map((a) => [a.id, a]));

      const config = await tx.configuracion.findMany();
      const costoHora = configNumero(Object.fromEntries(config.map((c) => [c.clave, c.valor])), "costoHoraManoObra", "0");

      const consumos = new Map<string, Dinero>();
      const items = lineas.map((l) => {
        const articulo = porId.get(l.articuloId)!;
        const componentes = articulo.receta?.componentes ?? [];
        const receta = recetaResuelta(componentes, costoHora);
        const cal = costearLineaVenta({
          cantidad: l.cantidad,
          precioUnitario: articulo.precioVenta,
          ivaPct: articulo.ivaPct,
          costoUnitario: receta.costoTotal,
        });

        if (!articulo.esServicio) {
          for (const c of componentes) {
            if (c.tipo === "MATERIAL" && c.materialId) {
              consumos.set(c.materialId, (consumos.get(c.materialId) ?? CERO).plus(c.cantidad.times(l.cantidad)));
            }
          }
        }

        return {
          articuloId: articulo.id,
          descripcion: articulo.nombre,
          cantidad: l.cantidad,
          precioUnitario: articulo.precioVenta,
          ivaPct: articulo.ivaPct,
          subtotalNeto: cal.subtotalNeto,
          subtotalIVA: cal.subtotalIVA,
          subtotalBruto: cal.subtotalBruto,
          costoUnitarioSnapshot: cal.costoUnitarioSnapshot,
          costoTotalSnapshot: cal.costoTotalSnapshot,
        };
      });
      const totales = totalizarVenta(items);

      if (pago && d(pago.monto.replace(",", ".")).gt(totales.totalBruto.plus("0.01"))) {
        throw new ErrorDeNegocio("El pago no puede superar el total de la venta.");
      }

      // Un solo escritor numera por anio a la vez: el correlativo no se repite ni deja huecos.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${anio})`;
      const ultimo = await tx.venta.aggregate({ where: { anio }, _max: { numero: true } });
      const numero = (ultimo._max.numero ?? 0) + 1;

      const venta = await tx.venta.create({
        data: {
          numero,
          anio,
          clienteId,
          fecha,
          estado: entregada ? "ENTREGADA" : "PENDIENTE",
          observaciones: observaciones || null,
          totalNeto: totales.totalNeto,
          totalIVA: totales.totalIVA,
          totalBruto: totales.totalBruto,
          costoTotal: totales.costoTotal,
          items: { create: items },
        },
      });

      if (pago) {
        await tx.pago.create({
          data: {
            ventaId: venta.id,
            clienteId,
            fecha,
            monto: d(pago.monto.replace(",", ".")),
            metodo: pago.metodo,
          },
        });
      }

      const advertencias: string[] = [];
      // Orden fijo por id: dos ventas simultaneas bloquean las filas en el mismo orden.
      for (const [materialId, consumo] of [...consumos].sort(([a], [b]) => a.localeCompare(b))) {
        const filas = await tx.$queryRaw<{ stockActual: string; nombre: string; unidad: string }[]>`
          SELECT "stockActual"::text AS "stockActual", nombre, unidad::text AS unidad
          FROM "materiales" WHERE id = ${materialId}::uuid FOR UPDATE`;
        const fila = filas[0];
        if (!fila) continue;

        const disponible = d(fila.stockActual);
        const descontar = consumo.lt(disponible) ? consumo : disponible;
        const faltante = consumo.minus(descontar);
        if (faltante.gt(0)) {
          advertencias.push(
            `${fila.nombre}: faltaron ${fmtNumero(faltante)} ${ETIQUETA_UNIDAD[fila.unidad] ?? fila.unidad} de stock (el sistema quedó en 0).`,
          );
        }
        if (descontar.lte(0)) continue;

        const material = await tx.material.update({
          where: { id: materialId },
          data: { stockActual: { decrement: descontar } },
          select: { stockActual: true },
        });
        await tx.movimientoStock.create({
          data: {
            materialId,
            tipo: "VENTA",
            cantidad: descontar.neg(),
            stockResultante: material.stockActual,
            motivo: `Venta #${numero}/${anio}${faltante.gt(0) ? ` (faltaron ${fmtNumero(faltante)})` : ""}`,
            ventaId: venta.id,
          },
        });
      }

      return { id: venta.id, numero, anio, advertencias };
    });

    revalidarVentas();
    return { ok: true, ...resultado };
  } catch (error) {
    if (error instanceof ErrorDeNegocio) return { ok: false, error: error.message };
    console.error("[registrarVenta]", error);
    return { ok: false, error: "No se pudo guardar la venta." };
  }
}
