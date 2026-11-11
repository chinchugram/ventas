"use server";

import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { d } from "@/lib/money";
import { decimalPositivo, hoyArgentina, mensajeDeError, primerError, SIN_BASE, textoOpcional } from "@/lib/acciones";
import { idParaGuardar, usuarioParaAccion } from "@/lib/auth";
import { registrarVentaEnTx } from "@/lib/dominio/ventas";
import { revalidarVentas } from "@/lib/revalidar";
import { negocioUnico } from "@/lib/dominio/auth";
import { conNegocio } from "@/lib/negocio";
import { margenDelMesEnTx } from "@/lib/queries/dashboard";
import { cruzoLaMeta, type Logro } from "@/lib/logros";

export type ResultadoVenta =
  // `logro` es opcional: solo viene cuando esta venta dejo el margen del mes arriba de la meta.
  | { ok: true; id: string; numero: number; anio: number; advertencias: string[]; logro?: Logro }
  | { ok: false; error: string };

type MargenDelMes = Awaited<ReturnType<typeof margenDelMesEnTx>>;

/**
 * Margen y meta del mes, en una lectura aparte de la transaccion de la venta (no la toca ni la
 * alarga). Es solo para festejar: si falla, no hay logro y la venta sigue su curso.
 */
async function leerMargenDelMes(negocioId: string): Promise<MargenDelMes | null> {
  try {
    return await conNegocio(negocioId, (tx) => margenDelMesEnTx(tx));
  } catch (error) {
    console.error("[registrarVenta] margen del mes (logro)", error);
    return null;
  }
}

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
  const permiso = await verificarPermiso("cargarVenta");
  if (!permiso.ok) return permiso;
  const parsed = esquemaVenta.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const { items, pago, ...resto } = parsed.data;
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const usuarioId = idParaGuardar(sesion.usuario);
  try {
    const negocioId = await negocioUnico(prisma);
    // Logro "meta del mes" (momentos.md): margen antes y despues de la venta, con la misma regla
    // del tablero. Dos lecturas aparte: la venta se calcula y se guarda exactamente igual que antes.
    const antes = await leerMargenDelMes(negocioId);
    const { id, numero, anio, advertencias } = await conNegocio(negocioId, (tx) =>
      registrarVentaEnTx(tx, negocioId, {
        ...resto,
        fecha: hoyArgentina(),
        usuarioId,
        items: items.map((i) => ({ articuloId: i.articuloId, cantidad: d(i.cantidad) })),
        pago: pago ? { monto: d(pago.monto), metodo: pago.metodo } : null,
      }),
    );
    revalidarVentas();
    const despues = antes ? await leerMargenDelMes(negocioId) : null;
    const logro: Logro | undefined =
      antes && despues && cruzoLaMeta(antes.margenPct, despues.margenPct, despues.metaMargenPct)
        ? { tipo: "meta", margenPct: despues.margenPct.toString(), metaPct: despues.metaMargenPct.toString() }
        : undefined;
    return { ok: true, id, numero, anio, advertencias, ...(logro ? { logro } : {}) };
  } catch (error) {
    console.error("[registrarVenta]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la venta.") };
  }
}
