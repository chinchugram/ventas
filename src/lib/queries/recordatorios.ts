import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoDeudas } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { hoyArgentina } from "@/lib/acciones";
import { agruparPorCliente } from "@/lib/cobranzas";
import type { Dinero } from "@/lib/money";
import {
  recordatoriosDeHoy,
  etiquetaTramo,
  type ContactoRegistrado,
  type Deudor,
  type TramoRecordatorio,
} from "@/lib/recordatorios-cobranza";
import { getVentasConSaldo } from "@/app/cobranzas/consultas";

// "A quien llamar hoy". El saldo y la antiguedad salen de las ventas y pagos no
// anulados (`getVentasConSaldo` + `agruparPorCliente`, las mismas de /cobranzas);
// aca solo se agrega el historial de contactos. Sin costos ni margenes.

export type UltimaNota = {
  fecha: Date;
  nota: string;
  proximoContacto: Date | null;
  /** Nombre para mostrar de quien lo registro; null = historico o sin usuario ("—"). */
  registradoPor: string | null;
};

export type RecordatorioHoy = {
  /** Id del cliente. */
  id: string;
  nombre: string;
  telefono: string | null;
  saldo: Dinero;
  /** Dias desde la venta impaga mas antigua. */
  dias: number;
  tramo: TramoRecordatorio;
  tramoEtiqueta: string;
  ultimaNota: UltimaNota | null;
};

/** Lista de "a quien llamar hoy", ya filtrada y ordenada (tramo mas viejo primero, luego monto). */
export const getRecordatoriosHoy = cache(
  (): Promise<RecordatorioHoy[]> => conRespaldo(recordatoriosDesdeBase, recordatoriosDemo),
);

async function recordatoriosDesdeBase(): Promise<RecordatorioHoy[]> {
  const deudas = agruparPorCliente(await getVentasConSaldo());
  const contactos = deudas.length
    ? await prisma.contactoCobranza.findMany({
        where: { clienteId: { in: deudas.map((x) => x.clienteId) } },
        // Del usuario solo el nombre para mostrar: nunca el hash ni datos de sesion.
        select: {
          clienteId: true,
          fecha: true,
          nota: true,
          proximoContacto: true,
          creadoEn: true,
          usuario: { select: { nombre: true } },
        },
      })
    : [];

  // `recordatoriosDeHoy` devuelve el mismo objeto de contacto que recibe: por eso
  // el autor se busca por identidad, sin tocar el tipo puro `ContactoRegistrado`.
  const autores = new Map<ContactoRegistrado, string | null>();
  const porCliente = new Map<string, ContactoRegistrado[]>();
  for (const { clienteId, usuario, ...c } of contactos) {
    autores.set(c, usuario?.nombre ?? null);
    porCliente.set(clienteId, [...(porCliente.get(clienteId) ?? []), c]);
  }

  return aRecordatorios(
    deudas.map((x) => ({
      clienteId: x.clienteId,
      nombre: x.nombre,
      telefono: x.telefono,
      saldo: x.saldo,
      desde: x.desde,
      contactos: porCliente.get(x.clienteId) ?? [],
    })),
    autores,
  );
}

/** Demo: las deudas del juego de demostracion (con telefono), sin contactos registrados. */
function recordatoriosDemo(): RecordatorioHoy[] {
  return aRecordatorios(
    demoDeudas().flatMap((x) =>
      x.masAntigua
        ? [{ clienteId: x.clienteId, nombre: x.nombre, telefono: x.telefono, saldo: x.saldo, desde: x.masAntigua, contactos: [] }]
        : [],
    ),
  );
}

function aRecordatorios(deudores: Deudor[], autores: ReadonlyMap<ContactoRegistrado, string | null> = new Map()): RecordatorioHoy[] {
  return recordatoriosDeHoy(deudores, hoyArgentina()).map((r) => ({
    id: r.clienteId,
    nombre: r.nombre,
    telefono: r.telefono,
    saldo: r.saldo,
    dias: r.dias,
    tramo: r.tramo,
    tramoEtiqueta: etiquetaTramo(r.tramo),
    ultimaNota: r.ultimoContacto
      ? {
          fecha: r.ultimoContacto.fecha,
          nota: r.ultimoContacto.nota,
          proximoContacto: r.ultimoContacto.proximoContacto,
          registradoPor: autores.get(r.ultimoContacto) ?? null,
        }
      : null,
  }));
}
