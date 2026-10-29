"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { d } from "@/lib/money";
import {
  decimalNoNegativo,
  decimalPositivo,
  fechaDesdeISO,
  fechaISO,
  mensajeDeError,
  primerError,
  SIN_BASE,
  textoOpcional,
  type Resultado,
} from "@/lib/acciones";
import { idParaGuardar, usuarioParaAccion } from "@/lib/auth";
import { registrarCompraEnTx } from "@/lib/dominio/compras";

export type { Resultado } from "@/lib/acciones";

const esquemaCompra = z.object({
  fecha: fechaISO,
  proveedor: z.string().trim().min(1, "Falta el proveedor").max(120),
  comprobante: textoOpcional(60),
  notas: textoOpcional(500),
  actualizarCosto: z.boolean(),
  items: z
    .array(
      z.object({
        materialId: z.uuid("Material inválido"),
        cantidad: decimalPositivo,
        costoUnitario: decimalNoNegativo,
      }),
    )
    .min(1, "Agregá al menos un material"),
});

export type DatosCompra = z.input<typeof esquemaCompra>;

/** Registra una compra en una transaccion: o entra completa o no entra nada. */
export async function registrarCompra(datos: DatosCompra): Promise<Resultado> {
  const permiso = await verificarPermiso("registrarCompra");
  if (!permiso.ok) return permiso;
  const parsed = esquemaCompra.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  const { fecha, items, ...resto } = parsed.data;
  const sesion = await usuarioParaAccion();
  if (!sesion.ok) return sesion;
  const usuarioId = idParaGuardar(sesion.usuario);
  try {
    await prisma.$transaction((tx) =>
      registrarCompraEnTx(tx, {
        ...resto,
        fecha: fechaDesdeISO(fecha),
        usuarioId,
        items: items.map((i) => ({ materialId: i.materialId, cantidad: d(i.cantidad), costoUnitario: d(i.costoUnitario) })),
      }),
    );
  } catch (error) {
    console.error("[registrarCompra]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar la compra.") };
  }

  revalidatePath("/");
  revalidatePath("/compras");
  revalidatePath("/materiales");
  return { ok: true };
}
