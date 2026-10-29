import { ErrorDeNegocio } from "@/lib/acciones";
import { validarProximoContacto } from "@/lib/recordatorios-cobranza";
import type { Tx } from "./tx";

export type ContactoNuevo = {
  clienteId: string;
  /** Fecha del contacto: hoy en Argentina (la pone el servidor, no el formulario). */
  fecha: Date;
  nota: string;
  /** Cuando volver a llamar; null si no se prometio nada. */
  proximoContacto: Date | null;
  /** Quien lo registra; null/ausente = sin usuario (se muestra "—"). */
  usuarioId?: string | null;
};

const MAX_NOTA = 500;
const iso = (f: Date) => f.toISOString().slice(0, 10);

/**
 * Registra un llamado o mensaje de cobranza. No toca ventas ni pagos: el saldo
 * del cliente sigue calculandose desde ellos. Las reglas de la tabla
 * (`contactos_cobranza_*_check`) se verifican antes para dar un mensaje claro.
 *
 * El cliente tiene que existir; no hace falta que este activo ni que tenga
 * saldo (se puede dejar constancia de un llamado a alguien que ya pago).
 */
export async function registrarContactoEnTx(tx: Tx, contacto: ContactoNuevo): Promise<{ id: string }> {
  const nota = contacto.nota.trim();
  if (!nota) throw new ErrorDeNegocio("Escribí una nota del contacto.");
  if (nota.length > MAX_NOTA) throw new ErrorDeNegocio(`La nota admite hasta ${MAX_NOTA} caracteres.`);

  if (contacto.proximoContacto) {
    const problema = validarProximoContacto(iso(contacto.proximoContacto), iso(contacto.fecha));
    if (problema) throw new ErrorDeNegocio(problema);
  }

  const cliente = await tx.cliente.findUnique({ where: { id: contacto.clienteId }, select: { id: true } });
  if (!cliente) throw new ErrorDeNegocio("El cliente no existe.");

  return tx.contactoCobranza.create({
    data: {
      clienteId: contacto.clienteId,
      fecha: contacto.fecha,
      nota,
      proximoContacto: contacto.proximoContacto,
      usuarioId: contacto.usuarioId ?? null,
    },
    select: { id: true },
  });
}
