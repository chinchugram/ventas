"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { d } from "@/lib/money";
import {
  decimalPositivo,
  fechaDesdeISO,
  fechaISO,
  hoyArgentinaISO,
  mensajeDeError,
  primerError,
  SIN_BASE,
  textoOpcional,
  type Resultado,
} from "@/lib/acciones";
import { METODOS_PAGO, validarFechaPago } from "@/lib/cobranzas";
import { idParaGuardar, usuarioParaAccion } from "@/lib/auth";
import { anularVentaEnTx } from "@/lib/dominio/ventas";
import { anularPagoEnTx, marcarEntregadaEnTx, registrarPagoEnTx } from "@/lib/dominio/pagos";
import { revalidarVentas } from "@/lib/revalidar";

/** Todo lo que muestra el saldo o el estado de una venta. */
function revalidarCobranza(ventaId: string) {
  revalidarVentas();
  revalidatePath("/cobranzas");
  revalidatePath("/clientes/[id]", "page");
  revalidatePath(`/ventas/${ventaId}`);
}

const esquema = z.object({ ventaId: z.uuid("Venta inválida") });

/** Anula una venta (queda ANULADA, no se borra) y devuelve el stock que salio. */
export async function anularVenta(datos: z.input<typeof esquema>): Promise<Resultado> {
  const parsed = esquema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const { ventaId } = parsed.data;
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const usuarioId = idParaGuardar(sesion.usuario);

  try {
    await prisma.$transaction((tx) => anularVentaEnTx(tx, ventaId, usuarioId));
  } catch (error) {
    console.error("[anularVenta]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo anular la venta.") };
  }

  revalidarCobranza(ventaId);
  return { ok: true };
}

// ─── Cobranzas ────────────────────────────────────────────────────────────────

const esquemaPago = z.object({
  ventaId: z.uuid("Venta inválida"),
  monto: decimalPositivo,
  metodo: z.enum(METODOS_PAGO, "Elegí cómo pagó"),
  fecha: fechaISO,
  notas: textoOpcional(500),
});

export type DatosPago = z.input<typeof esquemaPago>;

/**
 * Registra un pago sobre una venta. El saldo se recalcula en el servidor con
 * la venta bloqueada: del formulario solo se usa el monto tipeado.
 */
export async function registrarPago(datos: DatosPago): Promise<Resultado> {
  const parsed = esquemaPago.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  const problemaFecha = validarFechaPago(parsed.data.fecha, hoyArgentinaISO());
  if (problemaFecha) return { ok: false, error: problemaFecha };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const { ventaId, monto, metodo, fecha, notas } = parsed.data;
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const usuarioId = idParaGuardar(sesion.usuario);

  try {
    await prisma.$transaction((tx) =>
      registrarPagoEnTx(tx, { ventaId, monto: d(monto), metodo, fecha: fechaDesdeISO(fecha), notas, usuarioId }),
    );
  } catch (error) {
    console.error("[registrarPago]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo registrar el pago.") };
  }

  revalidarCobranza(ventaId);
  return { ok: true };
}

const esquemaAnularPago = z.object({
  pagoId: z.uuid("Pago inválido"),
  motivo: z.string().trim().min(1, "Indicá el motivo de la anulación").max(200, "Máximo 200 caracteres"),
});

/** Anula un pago (baja logica, con motivo). El saldo de la venta vuelve a subir. */
export async function anularPago(datos: z.input<typeof esquemaAnularPago>): Promise<Resultado> {
  const parsed = esquemaAnularPago.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const { pagoId, motivo } = parsed.data;

  let ventaId: string;
  try {
    ({ ventaId } = await prisma.$transaction((tx) => anularPagoEnTx(tx, pagoId, motivo)));
  } catch (error) {
    console.error("[anularPago]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo anular el pago.") };
  }

  revalidarCobranza(ventaId);
  return { ok: true };
}

/** PENDIENTE → ENTREGADA. */
export async function marcarEntregada(datos: z.input<typeof esquema>): Promise<Resultado> {
  const parsed = esquema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const { ventaId } = parsed.data;

  try {
    await prisma.$transaction((tx) => marcarEntregadaEnTx(tx, ventaId));
  } catch (error) {
    console.error("[marcarEntregada]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo marcar la venta como entregada.") };
  }

  revalidarCobranza(ventaId);
  return { ok: true };
}
