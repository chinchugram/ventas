"use server";

import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { primerError, SIN_BASE } from "@/lib/acciones";
import { verificarPermiso } from "@/lib/permisos";
import { preciosDeClienteEnTx } from "@/lib/dominio/listas-precios";
import type { OrigenPrecio } from "@/lib/precios";

export type PreciosCliente =
  | {
      ok: true;
      /** Lista activa del cliente (para rotular la pantalla), o null. */
      lista: { nombre: string; descuentoPct: string } | null;
      /** articuloId → precio unitario que se le cobraria a este cliente. */
      precios: Record<string, { precio: string; origen: OrigenPrecio }>;
    }
  | { ok: false; error: string };

const esquema = z.object({
  clienteId: z.uuid("Cliente inválido"),
  articuloIds: z.array(z.uuid("Artículo inválido")).max(1000, "Demasiados artículos"),
});

/**
 * Precios resueltos para un cliente, para que las pantallas de venta nueva y de
 * presupuesto los muestren al elegirlo. Liviana a proposito: devuelve SOLO
 * precios de venta, nunca costos ni margenes, asi la puede usar cualquier
 * usuario. No guarda nada y no es la fuente de verdad: `registrarVenta` y
 * `crearPresupuesto` recalculan en el servidor.
 *
 * Son dos acciones con el mismo cuerpo porque cada pantalla pide su propio
 * permiso (cargar una venta, cargar un presupuesto): si un rol tuviera una y no
 * la otra, no se le abre la lectura de precios de la que no tiene.
 */
async function preciosDe(datos: z.input<typeof esquema>): Promise<PreciosCliente> {
  const parsed = esquema.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    const r = await preciosDeClienteEnTx(prisma, parsed.data.clienteId, [...new Set(parsed.data.articuloIds)]);
    return {
      ok: true,
      lista: r.lista ? { nombre: r.lista.nombre, descuentoPct: r.lista.descuentoPct.toString() } : null,
      precios: Object.fromEntries([...r.precios].map(([id, p]) => [id, { precio: p.precio.toString(), origen: p.origen }])),
    };
  } catch (error) {
    console.error("[preciosParaCliente]", error);
    return { ok: false, error: "No se pudieron cargar los precios del cliente." };
  }
}

/** Para la pantalla de venta nueva (`cargarVenta`). */
export async function preciosParaCliente(datos: z.input<typeof esquema>): Promise<PreciosCliente> {
  const permiso = await verificarPermiso("cargarVenta");
  if (!permiso.ok) return permiso;
  return preciosDe(datos);
}

/** Para las pantallas de presupuesto nuevo y de edicion (`cargarPresupuesto`). */
export async function preciosParaPresupuesto(datos: z.input<typeof esquema>): Promise<PreciosCliente> {
  const permiso = await verificarPermiso("cargarPresupuesto");
  if (!permiso.ok) return permiso;
  return preciosDe(datos);
}
