"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { idParaGuardar } from "@/lib/auth";
import { dbDisponible } from "@/lib/prisma";
import { conNegocio } from "@/lib/negocio";
import { negocioActual } from "@/lib/queries/stock";
import { mensajeSinPermiso, puede, verificarPermiso } from "@/lib/permisos";
import {
  decimalNoNegativo,
  fechaDesdeISO,
  fechaISO,
  hoyArgentinaISO,
  mensajeDeError,
  primerError,
  SIN_BASE,
  textoOpcional,
} from "@/lib/acciones";
import { d } from "@/lib/money";
import { anularTrabajoEnTx, ajustarStockDeTrabajoEnTx, cargarTrabajoYAjustarEnTx } from "@/lib/dominio/produccion";

// Escrituras de produccion. El cliente solo informa lo medido (minutos y cantidades);
// el servidor valida todo, pone la fecha de carga y CONGELA los costos (que el cliente
// nunca manda ni recibe). Las cantidades viajan como texto y se convierten a Decimal.

/** Numero no negativo tipeado (coma o punto); vacio cuenta como 0. */
const numero = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v))
  .pipe(decimalNoNegativo);

const esquemaCarga = z.object({
  ventaItemId: z.uuid("Línea inválida"),
  fecha: fechaISO,
  minutosManoObra: numero,
  tiempos: z.array(z.object({ maquinaId: z.uuid("Máquina inválida"), minutos: numero })).max(50, "Demasiadas máquinas"),
  consumos: z.array(z.object({ materialId: z.uuid("Material inválido"), cantidad: numero })).max(100, "Demasiados materiales"),
  notas: textoOpcional(500),
  /** Ajustar el stock por la diferencia contra la receta. Solo lo puede pedir quien puede `ajustarStock`. */
  ajustarStock: z.boolean().optional(),
});

export type DatosCarga = z.input<typeof esquemaCarga>;

const REPETIDO = "trabajos_produccion_vigente_key";

/**
 * Carga el trabajo de una linea de venta (minutos por maquina, mano de obra y
 * materiales realmente usados). Un solo trabajo vigente por linea: si ya hay uno, el
 * error lo dice (corregir = anular y recargar). NO mueve stock, salvo que se pida el
 * ajuste y el usuario pueda `ajustarStock`: entonces se hace en la misma transaccion.
 */
export async function cargarTrabajo(datos: DatosCarga): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("cargarProduccion");
  if (!permiso.ok) return permiso;
  const parsed = esquemaCarga.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  const carga = parsed.data;

  if (carga.fecha > hoyArgentinaISO()) return { ok: false, error: "La fecha del trabajo no puede ser futura." };
  const ajustar = carga.ajustarStock === true;
  if (ajustar && !puede(permiso.usuario, "ajustarStock")) return { ok: false, error: mensajeSinPermiso("ajustarStock") };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const usuarioId = idParaGuardar(permiso.usuario);

  try {
    const negocioId = await negocioActual();
    const { id } = await conNegocio(
      negocioId,
      async (tx) =>
        cargarTrabajoYAjustarEnTx(
          tx,
          negocioId,
          {
            ventaItemId: carga.ventaItemId,
            fecha: fechaDesdeISO(carga.fecha),
            minutosManoObra: d(carga.minutosManoObra),
            tiempos: carga.tiempos.map((t) => ({ maquinaId: t.maquinaId, minutos: d(t.minutos) })),
            consumos: carga.consumos.map((c) => ({ materialId: c.materialId, cantidad: d(c.cantidad) })),
            notas: carga.notas,
            usuarioId,
          },
          ajustar,
        ),
      { timeout: 20_000 },
    );
    revalidarProduccion(ajustar);
    return { ok: true, id };
  } catch (error) {
    console.error("[cargarTrabajo]", error);
    if (String(error).includes(REPETIDO)) {
      return { ok: false, error: "Esta línea ya tiene un trabajo cargado. Para corregirlo, anulalo y cargalo de nuevo." };
    }
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el trabajo.") };
  }
}

const esquemaAnulacion = z.object({
  trabajoId: z.uuid("Trabajo inválido"),
  motivo: z.string().trim().min(1, "Escribí el motivo de la anulación").max(200, "Máximo 200 caracteres"),
});

/** Anula un trabajo (baja lógica con motivo). La línea vuelve a quedar sin cargar. No toca el stock. */
export async function anularTrabajo(datos: z.input<typeof esquemaAnulacion>): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("cargarProduccion");
  if (!permiso.ok) return permiso;
  const parsed = esquemaAnulacion.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const usuarioId = idParaGuardar(permiso.usuario);

  try {
    const negocioId = await negocioActual();
    await conNegocio(negocioId, (tx) => anularTrabajoEnTx(tx, negocioId, { ...parsed.data, usuarioId }));
  } catch (error) {
    console.error("[anularTrabajo]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo anular el trabajo.") };
  }
  revalidarProduccion(false);
  return { ok: true };
}

const esquemaAjuste = z.object({
  trabajoId: z.uuid("Trabajo inválido"),
  /** La casilla de confirmación de la pantalla: sin ella no se ajusta nada. */
  confirmar: z.literal(true, { error: "Marcá la casilla para confirmar el ajuste de stock" }),
});

/**
 * Ajusta el stock por la diferencia entre el consumo real y la receta, DESPUES de
 * cargar el trabajo. Es del dueño (`ajustarStock`): el empleado carga producción sin
 * esta opción. Nunca descuenta dos veces (ver `ajustarStockDeTrabajoEnTx`).
 */
export async function ajustarStockDeTrabajo(datos: z.input<typeof esquemaAjuste>): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("ajustarStock");
  if (!permiso.ok) return permiso;
  const parsed = esquemaAjuste.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const usuarioId = idParaGuardar(permiso.usuario);

  try {
    const negocioId = await negocioActual();
    await conNegocio(negocioId, (tx) => ajustarStockDeTrabajoEnTx(tx, negocioId, { trabajoId: parsed.data.trabajoId, usuarioId }), { timeout: 20_000 });
  } catch (error) {
    console.error("[ajustarStockDeTrabajo]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo ajustar el stock.") };
  }
  revalidarProduccion(true);
  return { ok: true };
}

function revalidarProduccion(tocoStock: boolean) {
  revalidatePath("/produccion");
  revalidatePath("/ventas/[id]", "page");
  if (tocoStock) {
    revalidatePath("/materiales");
    revalidatePath("/materiales/[id]", "page");
  }
}
