"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { idParaGuardar, usuarioParaAccion } from "@/lib/auth";
import { dbDisponible, prisma } from "@/lib/prisma";
import {
  fechaDesdeISO,
  fechaISO,
  hoyArgentina,
  hoyArgentinaISO,
  mensajeDeError,
  primerError,
  SIN_BASE,
  type Resultado,
} from "@/lib/acciones";
import { registrarContactoEnTx } from "@/lib/dominio/recordatorios";
import { validarProximoContacto } from "@/lib/recordatorios-cobranza";

export type { Resultado } from "@/lib/acciones";

const esquemaContacto = z.object({
  clienteId: z.uuid("Cliente inválido"),
  nota: z.string().trim().min(1, "Escribí una nota del contacto").max(500, "Máximo 500 caracteres"),
  /** "AAAA-MM-DD"; vacío o ausente = no se prometió nada. */
  proximoContacto: fechaISO
    .or(z.literal(""))
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type DatosContacto = z.input<typeof esquemaContacto>;

/**
 * Deja constancia de un llamado o mensaje de cobranza, con fecha de hoy
 * (Argentina, la pone el servidor). El proximo contacto es opcional y no puede
 * ser una fecha pasada. Ver `registrarContactoEnTx`.
 */
export async function registrarContacto(datos: DatosContacto): Promise<Resultado> {
  const parsed = esquemaContacto.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  const { clienteId, nota, proximoContacto } = parsed.data;

  if (proximoContacto) {
    const problema = validarProximoContacto(proximoContacto, hoyArgentinaISO());
    if (problema) return { ok: false, error: problema };
  }
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const usuarioId = idParaGuardar(sesion.usuario);

  try {
    await prisma.$transaction((tx) =>
      registrarContactoEnTx(tx, {
        clienteId,
        fecha: hoyArgentina(),
        nota,
        proximoContacto: proximoContacto ? fechaDesdeISO(proximoContacto) : null,
        usuarioId,
      }),
    );
  } catch (error) {
    console.error("[registrarContacto]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el contacto.") };
  }

  // Un contacto no cambia ventas ni saldos: solo la lista de hoy y la de cobranzas.
  revalidatePath("/cobranzas/hoy");
  revalidatePath("/cobranzas");
  return { ok: true };
}
