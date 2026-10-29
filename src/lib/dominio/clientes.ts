import { ErrorDeNegocio } from "@/lib/acciones";
import { normalizarCuit, validarCuit } from "@/lib/cuit";
import type { Tx } from "./tx";

export type DatosCliente = {
  nombre: string;
  /** Tal como lo tipeo el usuario; null o "" si no informo CUIT. */
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  notas: string | null;
};

/**
 * CUIT listo para guardar (11 digitos) o null.
 *
 * `cuitActual` es el que ya tiene guardado el cliente que se edita: si no se
 * toca, se conserva aunque no pase el digito verificador. Son datos cargados
 * antes de que existiera la validacion; obligar a corregirlos para cambiar un
 * telefono seria un estorbo. Cualquier CUIT nuevo o modificado si se valida.
 */
function cuitParaGuardar(texto: string | null, cuitActual: string | null = null): string | null {
  if (!texto || !texto.trim()) return null;
  if (cuitActual) {
    const tipeado = normalizarCuit(texto);
    const guardado = normalizarCuit(cuitActual);
    if (texto.trim() === cuitActual || (tipeado !== null && tipeado === guardado)) return guardado ?? cuitActual;
  }
  const r = validarCuit(texto);
  if (!r.ok) throw new ErrorDeNegocio(r.error);
  return r.cuit;
}

/**
 * El indice unico parcial de la base es la garantia final; esto da antes un
 * mensaje que dice con quien choca (incluso si ese cliente esta de baja).
 */
async function verificarCuitLibre(tx: Tx, cuit: string | null, excepto?: string) {
  if (!cuit) return;
  const otro = await tx.cliente.findFirst({
    where: { cuit, ...(excepto ? { id: { not: excepto } } : {}) },
    select: { nombre: true, activo: true },
  });
  if (otro) {
    throw new ErrorDeNegocio(`Ya hay un cliente con ese CUIT: ${otro.nombre}${otro.activo ? "" : " (dado de baja)"}.`);
  }
}

export async function crearClienteEnTx(tx: Tx, datos: DatosCliente): Promise<{ id: string }> {
  const cuit = cuitParaGuardar(datos.cuit);
  await verificarCuitLibre(tx, cuit);
  const creado = await tx.cliente.create({
    data: { ...datos, nombre: datos.nombre.trim(), cuit },
    select: { id: true },
  });
  return creado;
}

export async function editarClienteEnTx(tx: Tx, id: string, datos: DatosCliente): Promise<void> {
  const actual = await tx.cliente.findUnique({ where: { id }, select: { cuit: true } });
  if (!actual) throw new ErrorDeNegocio("El cliente no existe.");
  const cuit = cuitParaGuardar(datos.cuit, actual.cuit);
  await verificarCuitLibre(tx, cuit, id);
  await tx.cliente.update({ where: { id }, data: { ...datos, nombre: datos.nombre.trim(), cuit } });
}

/**
 * Baja logica (`activo = false`) o reactivacion. Un cliente nunca se borra: sus
 * ventas y pagos siguen en los reportes. De baja no aparece al cargar una venta
 * nueva, pero su ficha y su saldo se siguen viendo.
 */
export async function cambiarActivoClienteEnTx(tx: Tx, id: string, activo: boolean): Promise<void> {
  const r = await tx.cliente.updateMany({ where: { id }, data: { activo } });
  if (r.count === 0) throw new ErrorDeNegocio("El cliente no existe.");
}
