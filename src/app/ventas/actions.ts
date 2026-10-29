"use server";

import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { d } from "@/lib/money";
import { decimalPositivo, hoyArgentina, mensajeDeError, primerError, SIN_BASE, textoOpcional } from "@/lib/acciones";
import { registrarVentaEnTx } from "@/lib/dominio/ventas";
import { revalidarVentas } from "@/lib/revalidar";

export type ResultadoVenta =
  | { ok: true; id: string; numero: number; anio: number; advertencias: string[] }
  | { ok: false; error: string };

const esquemaVenta = z.object({
  clienteId: z.uuid("Cliente inválido"),
  observaciones: textoOpcional(500),
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

/**
 * Confirma una venta con fecha de hoy. El servidor recalcula precio, IVA y
 * costo desde la base: el navegador solo informa que se vendio, cuanto y a quien.
 * Ver `registrarVentaEnTx`.
 */
export async function registrarVenta(datos: DatosVenta): Promise<ResultadoVenta> {
  const parsed = esquemaVenta.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const { items, pago, ...resto } = parsed.data;
  try {
    const { id, numero, anio, advertencias } = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, {
        ...resto,
        fecha: hoyArgentina(),
        items: items.map((i) => ({ articuloId: i.articuloId, cantidad: d(i.cantidad) })),
        pago: pago ? { monto: d(pago.monto), metodo: pago.metodo } : null,
      }),
    );
    revalidarVentas();
    return { ok: true, id, numero, anio, advertencias };
  } catch (error) {
    console.error("[registrarVenta]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la venta.") };
  }
}
