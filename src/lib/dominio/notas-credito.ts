import type { PrismaClient } from "@/generated/prisma/client";
import { ErrorDeNegocio, hoyArgentina } from "@/lib/acciones";
import {
  CODIGO_ARCA,
  CODIGO_CONDICION_IVA_RECEPTOR,
  type DocTipo,
  NOMBRE_TIPO,
  numeroFormateado,
  TIPOS_FACTURA,
  tipoNotaCredito,
  type TipoComprobante,
  type TipoFactura,
} from "@/lib/comprobantes";
import type { ResultadoCae, SolicitudCae } from "@/lib/fiscal/emisor";
import { d } from "@/lib/money";
import {
  claveLockSerie,
  registrarResultadoEnTx,
  traducirErrorDeEmision,
  type BaseDeDatos,
  type ComprobanteProcesado,
  type OpcionesEmision,
} from "./comprobantes";
import type { Tx } from "./tx";

// Emision de notas de credito (tarea 5.4).
//
// Mismo diseño en dos fases que la factura (ver el encabezado de
// `dominio/comprobantes.ts`, que es la explicacion completa):
//
//   1. `reservarNotaCreditoEnTx` (transaccion corta): bloquea la venta, valida,
//      reserva el numero y guarda la NC PENDIENTE con la foto completa. Se
//      CONFIRMA antes de seguir.
//   2. `emisor.solicitarCae(...)` FUERA de toda transaccion.
//   3. `registrarResultadoEnTx` (el mismo de las facturas): PENDIENTE → EMITIDO o
//      RECHAZADO.
//
// ─── Que es la nota de credito aca ────────────────────────────────────────────
// Es TOTAL: anula la factura EMITIDA de la venta por el mismo importe (las
// parciales estan fuera de alcance, ver docs/fiscal-5.1-decisiones.md §8.11).
// Es una COPIA de la factura, no un recalculo: emisor y receptor de la FACTURA
// (no de la configuracion ni del cliente de hoy), mismas lineas y alicuotas,
// misma letra y mismo punto de venta; solo cambian el tipo, el numero (serie
// propia de notas de credito), la fecha (hoy en Argentina), el usuario y la
// asociacion a la factura. Asi cierra exacto con la factura aunque despues se
// haya editado el cliente, un articulo o la configuracion fiscal.
//
// ─── Que impone la base (migracion 20260301000000) ────────────────────────────
// Una NC solo anula una factura EMITIDA de la misma venta, ambiente y letra; una
// sola NC vigente (PENDIENTE o EMITIDO) por factura; y una venta con factura
// vigente no se anula hasta que exista una NC EMITIDA. Aca se verifica antes para
// dar un mensaje claro en vez del error crudo de la base.
//
// ─── Concurrencia ─────────────────────────────────────────────────────────────
// Dos pedidos de NC de la misma venta: la venta se bloquea (FOR UPDATE) y el
// segundo ve la NC vigente del primero → error claro. Dos NC de ventas distintas
// en la misma serie: la segunda espera el lock de la serie y despues encuentra
// el PENDIENTE de la primera → "probá de nuevo en unos segundos".

export type OpcionesNotaCredito = OpcionesEmision & {
  /**
   * La factura que la persona vio en pantalla. Si la factura vigente de la venta
   * es otra (alguien la cambio mientras tanto), se frena: no se anula a ciegas.
   */
  facturaId?: string;
};

export type NotaCreditoReservada = {
  comprobanteId: string;
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  solicitud: SolicitudCae;
};

const nombre = (tipo: TipoComprobante, puntoVenta: number, numero: number) =>
  `${NOMBRE_TIPO[tipo]} ${numeroFormateado(puntoVenta, numero)}`;

/** Concepto ARCA: igual que la factura (siempre "productos", ver docs/fiscal-5.1-decisiones.md). */
const CONCEPTO_PRODUCTOS = 1;

// ─── Fase 1: reservar ─────────────────────────────────────────────────────────

/**
 * Valida y guarda la nota de credito PENDIENTE (con su numero y la foto copiada
 * de la factura). No pide el CAE: para un emisor real, la transaccion se
 * confirma antes de pedirlo.
 */
export async function reservarNotaCreditoEnTx(
  tx: Tx,
  ventaId: string,
  usuarioId: string | null | undefined,
  { emisor, hoy = hoyArgentina(), facturaId }: OpcionesNotaCredito,
): Promise<NotaCreditoReservada> {
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM "ventas" WHERE id = ${ventaId}::uuid FOR UPDATE`;
  if (!filas[0]) throw new ErrorDeNegocio("La venta no existe.");

  const factura = await tx.comprobante.findFirst({
    where: { ventaId, tipo: { in: [...TIPOS_FACTURA] }, estado: { in: ["PENDIENTE", "EMITIDO"] } },
    include: { items: { orderBy: { orden: "asc" } }, alicuotas: { orderBy: { alicuotaPct: "asc" } } },
  });
  if (!factura) {
    throw new ErrorDeNegocio("La venta no tiene una factura emitida: no hay nada que anular con una nota de crédito.");
  }
  const cualFactura = nombre(factura.tipo, factura.puntoVenta, factura.numero);
  if (factura.estado !== "EMITIDO") {
    throw new ErrorDeNegocio(
      `La ${cualFactura} está esperando respuesta del emisor: resolvela desde Comprobantes antes de emitir la nota de crédito.`,
    );
  }
  if (facturaId !== undefined && factura.id !== facturaId) {
    throw new ErrorDeNegocio("La factura de la venta cambió mientras tanto: actualizá la pantalla y revisá antes de continuar.");
  }

  const vigente = await tx.comprobante.findFirst({
    where: { comprobanteAsociadoId: factura.id, estado: { in: ["PENDIENTE", "EMITIDO"] } },
    select: { tipo: true, puntoVenta: true, numero: true, estado: true },
  });
  if (vigente) {
    const cual = nombre(vigente.tipo, vigente.puntoVenta, vigente.numero);
    throw new ErrorDeNegocio(
      vigente.estado === "EMITIDO"
        ? `La ${cualFactura} ya está anulada por la ${cual}.`
        : `La ${cualFactura} ya tiene la ${cual} esperando respuesta del emisor: consultala desde Comprobantes antes de volver a intentar.`,
    );
  }

  const { ambiente } = emisor;
  if (factura.ambiente !== ambiente) {
    throw new ErrorDeNegocio(
      `La factura es del ambiente ${factura.ambiente} y el emisor configurado es ${ambiente}: la nota de crédito tiene que salir por el mismo ambiente.`,
    );
  }

  const facturaTipo = factura.tipo as TipoFactura;
  const tipo = tipoNotaCredito(facturaTipo);
  const puntoVenta = factura.puntoVenta;

  // Numeracion de la serie de notas de credito: igual que la factura.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${claveLockSerie(ambiente, puntoVenta, tipo)})`;
  const pendiente = await tx.comprobante.findFirst({
    where: { ambiente, puntoVenta, tipo, estado: "PENDIENTE" },
    select: { numero: true },
  });
  if (pendiente) {
    throw new ErrorDeNegocio(
      `Hay otra ${nombre(tipo, puntoVenta, pendiente.numero)} esperando respuesta del emisor. ` +
        "Probá de nuevo en unos segundos; si sigue igual, consultala desde Comprobantes.",
    );
  }
  const ultimo = await emisor.ultimoAutorizado(puntoVenta, tipo);
  const local =
    (await tx.comprobante.aggregate({ where: { ambiente, puntoVenta, tipo, estado: "EMITIDO" }, _max: { numero: true } }))._max
      .numero ?? 0;
  if (ultimo !== local) {
    throw new ErrorDeNegocio(
      `El emisor tiene autorizada la ${NOMBRE_TIPO[tipo]} del punto de venta ${puntoVenta} hasta el número ${ultimo}, ` +
        `pero el sistema registra hasta el ${local}. No se emite hasta aclararlo.`,
    );
  }
  const numero = ultimo + 1;

  const creado = await tx.comprobante.create({
    data: {
      ambiente,
      tipo,
      codigoArca: CODIGO_ARCA[tipo],
      puntoVenta,
      numero,
      fecha: hoy,
      estado: "PENDIENTE",
      emisorRazonSocial: factura.emisorRazonSocial,
      emisorCuit: factura.emisorCuit,
      emisorCondicionIva: factura.emisorCondicionIva,
      emisorDomicilio: factura.emisorDomicilio,
      emisorInicioActividades: factura.emisorInicioActividades,
      emisorIibb: factura.emisorIibb,
      receptorNombre: factura.receptorNombre,
      receptorDocTipo: factura.receptorDocTipo,
      receptorDocNro: factura.receptorDocNro,
      receptorCondicionIva: factura.receptorCondicionIva,
      receptorDomicilio: factura.receptorDomicilio,
      importeNeto: factura.importeNeto,
      importeIva: factura.importeIva,
      importeTotal: factura.importeTotal,
      comprobanteAsociadoId: factura.id,
      ventaId,
      usuarioId: usuarioId ?? null,
      items: {
        create: factura.items.map((i) => ({
          orden: i.orden,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precioUnitario: i.precioUnitario,
          ivaPct: i.ivaPct,
          subtotalNeto: i.subtotalNeto,
          subtotalIva: i.subtotalIva,
          subtotalBruto: i.subtotalBruto,
        })),
      },
      alicuotas: {
        create: factura.alicuotas.map((a) => ({
          alicuotaPct: a.alicuotaPct,
          codigoArca: a.codigoArca,
          baseImponible: a.baseImponible,
          importe: a.importe,
        })),
      },
    },
    select: { id: true },
  });

  return {
    comprobanteId: creado.id,
    tipo,
    puntoVenta,
    numero,
    solicitud: {
      cuitEmisor: factura.emisorCuit,
      puntoVenta,
      tipo,
      codigoArca: CODIGO_ARCA[tipo],
      numero,
      fecha: hoy,
      concepto: CONCEPTO_PRODUCTOS,
      receptor: {
        docTipo: factura.receptorDocTipo as DocTipo,
        docNro: factura.receptorDocNro,
        condicionIvaCodigo: CODIGO_CONDICION_IVA_RECEPTOR[factura.receptorCondicionIva],
      },
      importes: {
        total: d(factura.importeTotal.toString()),
        neto: d(factura.importeNeto.toString()),
        iva: d(factura.importeIva.toString()),
        alicuotas: factura.alicuotas.map((a) => ({
          codigo: a.codigoArca,
          base: d(a.baseImponible.toString()),
          importe: d(a.importe.toString()),
        })),
      },
      comprobanteAsociado: {
        tipo: factura.tipo,
        codigoArca: factura.codigoArca,
        puntoVenta: factura.puntoVenta,
        numero: factura.numero,
      },
    },
  };
}

function quedoPendiente(reserva: NotaCreditoReservada): ComprobanteProcesado {
  const cual = nombre(reserva.tipo, reserva.puntoVenta, reserva.numero);
  return {
    id: reserva.comprobanteId,
    tipo: reserva.tipo,
    puntoVenta: reserva.puntoVenta,
    numero: reserva.numero,
    estado: "PENDIENTE",
    cae: null,
    caeVencimiento: null,
    observaciones: [],
    advertencias: [],
    mensaje: `No hubo respuesta del emisor: la ${cual} quedó pendiente con su número reservado. Consultala desde Comprobantes antes de reintentar.`,
  };
}

// ─── Todo junto ───────────────────────────────────────────────────────────────

/**
 * Emite la nota de credito de una venta dentro de UNA transaccion (la del que
 * llama). Solo con el emisor SIMULADO (seed, pruebas): con uno real hay que usar
 * `emitirNotaCredito` (dos fases). Un rechazo no es una excepcion: queda
 * RECHAZADO y se devuelve; si el emisor no responde, queda PENDIENTE.
 */
export async function emitirNotaCreditoEnTx(
  tx: Tx,
  ventaId: string,
  usuarioId: string | null | undefined,
  opciones: OpcionesNotaCredito,
): Promise<ComprobanteProcesado> {
  if (opciones.emisor.ambiente !== "SIMULADO") {
    throw new Error("emitirNotaCreditoEnTx es solo para el emisor simulado: con un emisor real usá emitirNotaCredito (dos fases).");
  }
  const reserva = await reservarNotaCreditoEnTx(tx, ventaId, usuarioId, opciones);
  let resultado: ResultadoCae;
  try {
    resultado = await opciones.emisor.solicitarCae(reserva.solicitud);
  } catch {
    return quedoPendiente(reserva);
  }
  return registrarResultadoEnTx(tx, reserva.comprobanteId, resultado);
}

const OPCIONES_TX = { timeout: 30_000 } as const;

/**
 * Flujo completo en dos fases (el de la server action). Lanza `ErrorDeNegocio` si
 * no se puede emitir (antes de reservar nada). Devuelve la nota EMITIDA,
 * RECHAZADA o, si el emisor no respondio, PENDIENTE (se resuelve despues con
 * `resolverPendiente`, que sirve para cualquier comprobante).
 */
export async function emitirNotaCredito(
  db: BaseDeDatos,
  ventaId: string,
  usuarioId: string | null | undefined,
  opciones: OpcionesNotaCredito,
): Promise<ComprobanteProcesado> {
  let reserva: NotaCreditoReservada;
  try {
    reserva = await db.$transaction((tx) => reservarNotaCreditoEnTx(tx, ventaId, usuarioId, opciones), OPCIONES_TX);
  } catch (error) {
    throw traducirErrorDeEmision(error);
  }
  let resultado: ResultadoCae;
  try {
    resultado = await opciones.emisor.solicitarCae(reserva.solicitud);
  } catch {
    return quedoPendiente(reserva);
  }
  return db.$transaction((tx) => registrarResultadoEnTx(tx, reserva.comprobanteId, resultado), OPCIONES_TX);
}

// ─── Para la pantalla ─────────────────────────────────────────────────────────

export type FacturaAnulable = { id: string; etiqueta: string };

/**
 * La factura de la venta que se puede anular con una nota de credito ahora: la
 * vigente EMITIDA que todavia no tiene una nota de credito vigente (EMITIDA o
 * esperando respuesta). Si no hay, null. No da permiso: solo sirve para decidir
 * si se muestra el boton (la accion y el dominio lo vuelven a verificar).
 */
export async function facturaAnulableDeVenta(
  db: Pick<PrismaClient, "comprobante">,
  ventaId: string,
): Promise<FacturaAnulable | null> {
  const factura = await db.comprobante.findFirst({
    where: {
      ventaId,
      tipo: { in: [...TIPOS_FACTURA] },
      estado: "EMITIDO",
      notasDeCredito: { none: { estado: { in: ["PENDIENTE", "EMITIDO"] } } },
    },
    select: { id: true, tipo: true, puntoVenta: true, numero: true },
  });
  return factura ? { id: factura.id, etiqueta: nombre(factura.tipo, factura.puntoVenta, factura.numero) } : null;
}
