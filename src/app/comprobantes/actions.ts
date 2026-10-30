"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { idParaGuardar, usuarioParaAccion } from "@/lib/auth";
import { mensajeDeError, primerError, SIN_BASE } from "@/lib/acciones";
import { accesoSimulado, emitirFactura as emitirFacturaDeDominio, resolverPendiente } from "@/lib/dominio/comprobantes";
import { esFactura } from "@/lib/comprobantes";
import { entornoDelProceso, obtenerEmisorFiscal } from "@/lib/fiscal";
import { revalidarVentas } from "@/lib/revalidar";

// Acciones de facturacion (tarea 5.5). La logica de emision vive en
// `src/lib/dominio/comprobantes.ts`; aca solo se verifica permiso y sesion, se
// elige el emisor (con la guarda contra la emision falsa en produccion), se
// traducen los errores de negocio y se revalida.

const esquemaVenta = z.object({ ventaId: z.uuid("Venta inválida") });
const esquemaComprobante = z.object({ comprobanteId: z.uuid("Comprobante inválido") });

/** Que paso con el pedido (la factura puede quedar rechazada o pendiente sin que sea un error del sistema). */
export type ResultadoEmision =
  | {
      ok: true;
      comprobanteId: string;
      estado: "PENDIENTE" | "EMITIDO" | "RECHAZADO";
      /** Una oracion lista para mostrar. */
      mensaje: string;
      advertencias: string[];
    }
  | { ok: false; error: string };

function revalidarFacturacion(ventaId?: string, comprobanteId?: string) {
  revalidarVentas();
  revalidatePath("/comprobantes");
  if (ventaId) revalidatePath(`/ventas/${ventaId}`);
  if (comprobanteId) {
    revalidatePath(`/comprobantes/${comprobanteId}`);
    revalidatePath(`/comprobantes/${comprobanteId}/imprimir`);
  }
}

/**
 * Emite la factura de una venta con el emisor que corresponde al entorno. Si
 * facturar esta deshabilitado (emisor simulado en produccion sin
 * `PERMITIR_EMISOR_SIMULADO`, `EMISOR_FISCAL=arca` sin implementar) devuelve el
 * motivo y no toca la base.
 */
export async function emitirFactura(datos: z.input<typeof esquemaVenta>): Promise<ResultadoEmision> {
  const permiso = await verificarPermiso("emitirComprobante");
  if (!permiso.ok) return permiso;
  const parsed = esquemaVenta.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const { ventaId } = parsed.data;
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const usuarioId = idParaGuardar(sesion.usuario);

  const obtenido = obtenerEmisorFiscal(entornoDelProceso(), accesoSimulado(prisma));
  if (!obtenido.ok) return { ok: false, error: obtenido.error };

  try {
    const c = await emitirFacturaDeDominio(prisma, ventaId, usuarioId, { emisor: obtenido.emisor });
    revalidarFacturacion(ventaId, c.id);
    return { ok: true, comprobanteId: c.id, estado: c.estado, mensaje: c.mensaje, advertencias: c.advertencias };
  } catch (error) {
    console.error("[emitirFactura]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo emitir la factura.") };
  }
}

/**
 * Resuelve un comprobante PENDIENTE (el emisor no respondio) consultandolo: si el
 * emisor lo tiene autorizado queda EMITIDO, si no, RECHAZADO y su numero vuelve a
 * estar disponible. Mismo permiso que emitir.
 */
export async function resolverComprobantePendiente(datos: z.input<typeof esquemaComprobante>): Promise<ResultadoEmision> {
  const permiso = await verificarPermiso("emitirComprobante");
  if (!permiso.ok) return permiso;
  const parsed = esquemaComprobante.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const { comprobanteId } = parsed.data;

  // Resolver una nota de credito pendiente deshace una factura: es del dueño, igual que emitirla.
  const tipo = (await prisma.comprobante.findUnique({ where: { id: comprobanteId }, select: { tipo: true } }))?.tipo;
  if (tipo && !esFactura(tipo)) {
    const permisoNota = await verificarPermiso("emitirNotaCredito");
    if (!permisoNota.ok) return permisoNota;
  }

  const obtenido = obtenerEmisorFiscal(entornoDelProceso(), accesoSimulado(prisma));
  if (!obtenido.ok) return { ok: false, error: obtenido.error };

  try {
    const c = await resolverPendiente(prisma, comprobanteId, obtenido.emisor);
    const ventaId = (await prisma.comprobante.findUnique({ where: { id: comprobanteId }, select: { ventaId: true } }))?.ventaId;
    revalidarFacturacion(ventaId, c.id);
    return { ok: true, comprobanteId: c.id, estado: c.estado, mensaje: c.mensaje, advertencias: c.advertencias };
  } catch (error) {
    console.error("[resolverComprobantePendiente]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo resolver el comprobante.") };
  }
}
