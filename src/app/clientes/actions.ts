"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { dbDisponible, prisma } from "@/lib/prisma";
import { verificarPermiso } from "@/lib/permisos";
import { mensajeDeError, primerError, SIN_BASE, textoOpcional, type Resultado } from "@/lib/acciones";
import { cambiarActivoClienteEnTx, crearClienteEnTx, editarClienteEnTx } from "@/lib/dominio/clientes";

export type { Resultado } from "@/lib/acciones";

// El CUIT llega como texto libre ("30-71234567-1"): la forma y el digito
// verificador los valida el dominio (`src/lib/cuit.ts`), que lo normaliza.
const esquemaCliente = z.object({
  nombre: z.string().trim().min(1, "Falta el nombre o razón social").max(120, "Máximo 120 caracteres"),
  cuit: textoOpcional(20),
  telefono: textoOpcional(40),
  email: textoOpcional(120).refine((v) => v === null || z.email().safeParse(v).success, "El email no es válido"),
  direccion: textoOpcional(200),
  notas: textoOpcional(500),
});

export type DatosCliente = z.input<typeof esquemaCliente>;

const idCliente = z.uuid("Cliente inválido");

/** Choque con el indice unico de CUIT (dos altas a la vez con el mismo CUIT). */
function esCuitDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidarClientes(id?: string) {
  revalidatePath("/clientes");
  if (id) revalidatePath(`/clientes/${id}`);
  // El nombre del cliente aparece en el tablero, las ventas y los reportes.
  for (const ruta of ["/", "/ventas", "/ventas/nueva", "/reportes", "/cobranzas"]) revalidatePath(ruta);
}

export async function crearCliente(datos: DatosCliente): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const permiso = await verificarPermiso("editarClientes");
  if (!permiso.ok) return permiso;
  const parsed = esquemaCliente.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  let id: string;
  try {
    ({ id } = await prisma.$transaction((tx) => crearClienteEnTx(tx, parsed.data)));
  } catch (error) {
    if (esCuitDuplicado(error)) return { ok: false, error: "Ya hay un cliente con ese CUIT." };
    console.error("[crearCliente]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el cliente.") };
  }

  revalidarClientes(id);
  return { ok: true, id };
}

export async function editarCliente(datos: DatosCliente & { id: string }): Promise<Resultado> {
  const permiso = await verificarPermiso("editarClientes");
  if (!permiso.ok) return permiso;
  const id = idCliente.safeParse(datos.id);
  if (!id.success) return { ok: false, error: primerError(id.error) };
  const parsed = esquemaCliente.safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => editarClienteEnTx(tx, id.data, parsed.data));
  } catch (error) {
    if (esCuitDuplicado(error)) return { ok: false, error: "Ya hay un cliente con ese CUIT." };
    console.error("[editarCliente]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo guardar el cliente.") };
  }

  revalidarClientes(id.data);
  return { ok: true };
}

/** Baja logica (`activo: false`) o reactivacion (`activo: true`). */
export async function cambiarActivoCliente(datos: { id: string; activo: boolean }): Promise<Resultado> {
  const permiso = await verificarPermiso("editarClientes");
  if (!permiso.ok) return permiso;
  const parsed = z.object({ id: idCliente, activo: z.boolean() }).safeParse(datos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error) };
  if (!(await dbDisponible())) return { ok: false, error: SIN_BASE };

  try {
    await prisma.$transaction((tx) => cambiarActivoClienteEnTx(tx, parsed.data.id, parsed.data.activo));
  } catch (error) {
    console.error("[cambiarActivoCliente]", error);
    return { ok: false, error: mensajeDeError(error, "No se pudo actualizar el cliente.") };
  }

  revalidarClientes(parsed.data.id);
  return { ok: true };
}
