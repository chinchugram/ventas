import type { PrismaClient } from "@/generated/prisma/client";
import { ErrorDeNegocio, hoyArgentina } from "@/lib/acciones";
import {
  calcularImportes,
  CODIGO_ARCA,
  CODIGO_CONDICION_IVA_RECEPTOR,
  NOMBRE_TIPO,
  numeroFormateado,
  TIPOS_FACTURA,
  tipoDeComprobante,
  validarReceptor,
  type TipoComprobante,
  type TipoFactura,
} from "@/lib/comprobantes";
import { datosFiscalesDesdeConfiguracion, faltantesParaEmitir, mensajeFaltantes } from "@/lib/datos-fiscales";
import type { AmbienteFiscal, EmisorFiscal, ResultadoCae, SolicitudCae } from "@/lib/fiscal/emisor";
import type { AccesoComprobantesSimulados } from "@/lib/fiscal/emisor-simulado";
import { d } from "@/lib/money";
import { conNegocio, type OpcionesConNegocio } from "@/lib/negocio";
import type { Tx } from "./tx";

// Emision de facturas.
//
// ─── Decision clave: dos fases ────────────────────────────────────────────────
// El numero lo reserva el emisor (ultimo autorizado + 1) y el comprobante se
// guarda PENDIENTE ANTES de pedir el CAE, para que un corte entre medio no
// pierda el numero. Si todo pasara en una sola transaccion, un corte (o un
// error al guardar el resultado) desharia tambien el PENDIENTE: el emisor real
// podria haber autorizado un numero del que la base no tiene rastro. Por eso el
// flujo para un emisor real es:
//
//   1. `reservarFacturaEnTx` (transaccion corta): bloquea la venta, valida todo,
//      reserva el numero y guarda el comprobante PENDIENTE con la foto completa.
//      Se CONFIRMA (commit) antes de seguir.
//   2. `emisor.solicitarCae(...)` FUERA de toda transaccion (red, puede tardar).
//   3. `registrarResultadoEnTx` (otra transaccion corta): PENDIENTE → EMITIDO
//      (CAE y vencimiento) o RECHAZADO (observaciones).
//
// `emitirFactura(db, ...)` encadena las tres; es lo que usa la server action
// (5.5). Si el paso 2 lanza (corte, timeout), el comprobante queda PENDIENTE y
// `resolverPendiente` lo resuelve despues consultando al emisor.
//
// `emitirFacturaEnTx(tx, ventaId, usuarioId, ...)` hace lo mismo dentro de UNA
// transaccion ajena: sirve para el simulador (seed, pruebas), donde no hay red
// ni nada que perder. Con un emisor que no sea SIMULADO se niega.
//
// ─── Numeracion ───────────────────────────────────────────────────────────────
// Por (negocio, ambiente, punto de venta, tipo), serializada con un advisory lock
// por serie. La serie es DEL NEGOCIO (multi-tenant): dos negocios pueden emitir la
// factura B 0001-00000001 sin chocar, cada uno con su CUIT y su punto de venta, y
// el lock de uno no hace esperar al otro. Numero = ultimo autorizado SEGUN EL EMISOR + 1, y ademas:
//  - con un PENDIENTE en la misma serie no se emite (no se sabe si el emisor lo
//    autorizo, asi que no se sabe cual es el proximo); la base lo garantiza con
//    un indice unico parcial (que incluye el negocio);
//  - el ultimo autorizado del emisor tiene que coincidir con el ultimo EMITIDO
//    de la base; si no, algo se autorizo sin quedar registrado (o al reves) y no
//    se emite hasta aclararlo.
// Un RECHAZADO no consume el numero (ARCA tampoco): queda como registro del
// intento y el proximo intento reusa ese numero.
//
// ─── Concurrencia ─────────────────────────────────────────────────────────────
// Dos emisiones de la misma venta: la venta se bloquea (FOR UPDATE) y la segunda
// ve la factura vigente de la primera → error claro. Dos ventas distintas a la
// vez en la misma serie: la segunda espera el lock y despues encuentra el
// PENDIENTE de la primera → "probá de nuevo en unos segundos" (con la emision en
// una sola transaccion, simplemente espera y toma el numero siguiente).
//
// ─── Negocio ──────────────────────────────────────────────────────────────────
// Todo corre dentro de `conNegocio` (RLS fija el negocio en la base) y ademas cada
// consulta filtra por `negocioId`: la segunda barrera sigue sirviendo si alguna vez
// se corre con un rol que se salta RLS (migraciones, seed, pruebas). Los datos
// fiscales del emisor (CUIT, punto de venta, razon social...) salen de la
// `Configuracion` del negocio; el comprobante guarda una FOTO y no cambia despues.

export type OpcionesEmision = {
  emisor: EmisorFiscal;
  /** Fecha del comprobante. Por defecto, hoy en Argentina. */
  hoy?: Date;
};

export type FacturaReservada = {
  comprobanteId: string;
  tipo: TipoFactura;
  puntoVenta: number;
  numero: number;
  solicitud: SolicitudCae;
  /** Avisos de la conciliacion (por ejemplo, factura C con IVA en la venta). */
  advertencias: string[];
};

export type ComprobanteProcesado = {
  id: string;
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  estado: "PENDIENTE" | "EMITIDO" | "RECHAZADO";
  cae: string | null;
  caeVencimiento: Date | null;
  observaciones: string[];
  advertencias: string[];
  /** Para mostrar: que paso, en una oracion. */
  mensaje: string;
};

/**
 * Clave textual de la serie (negocio, ambiente, punto de venta, tipo). Series
 * distintas (y negocios distintos) tienen claves distintas, asi que no se esperan.
 * El prefijo la separa de los otros advisory locks (ventas por anio, presupuestos...).
 */
export function claveLockSerie(negocioId: string, ambiente: AmbienteFiscal, puntoVenta: number, tipo: TipoComprobante): string {
  return `comprobantes:${negocioId}:${ambiente}:${puntoVenta}:${CODIGO_ARCA[tipo]}`;
}

/** Toma el lock de transaccion de la serie: un escritor por serie (y por negocio) a la vez. */
export async function bloquearSerie(
  tx: Tx,
  negocioId: string,
  ambiente: AmbienteFiscal,
  puntoVenta: number,
  tipo: TipoComprobante,
): Promise<void> {
  const clave = claveLockSerie(negocioId, ambiente, puntoVenta, tipo);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))`;
}

/**
 * Cuanto tiene que tener un PENDIENTE para que `resolverPendiente` lo consulte:
 * uno mas nuevo puede estar esperando la respuesta del emisor en otro pedido.
 */
export const ANTIGUEDAD_MINIMA_PENDIENTE_MS = 2 * 60_000;

/** Concepto ARCA: hoy siempre "productos" (ver docs/fiscal-5.1-decisiones.md). */
const CONCEPTO_PRODUCTOS = 1;

const nombre = (tipo: TipoComprobante, puntoVenta: number, numero: number) =>
  `${NOMBRE_TIPO[tipo]} ${numeroFormateado(puntoVenta, numero)}`;

// ─── Fase 1: reservar ─────────────────────────────────────────────────────────

/**
 * Valida la venta y guarda la factura PENDIENTE con su numero y la foto de
 * emisor, receptor, lineas e importes. No pide el CAE. Para un emisor real, la
 * transaccion se confirma antes de pedirlo (ver el encabezado).
 */
export async function reservarFacturaEnTx(
  tx: Tx,
  negocioId: string,
  ventaId: string,
  usuarioId: string | null | undefined,
  { emisor, hoy = hoyArgentina() }: OpcionesEmision,
): Promise<FacturaReservada> {
  const filas = await tx.$queryRaw<
    { estado: string; clienteId: string; totalNeto: string; totalIVA: string; totalBruto: string }[]
  >`
    SELECT estado::text AS estado, "clienteId"::text AS "clienteId", "totalNeto"::text AS "totalNeto",
           "totalIVA"::text AS "totalIVA", "totalBruto"::text AS "totalBruto"
    FROM "ventas" WHERE id = ${ventaId}::uuid AND "negocioId" = ${negocioId}::uuid FOR UPDATE`;
  const venta = filas[0];
  if (!venta) throw new ErrorDeNegocio("La venta no existe.");
  if (venta.estado === "ANULADA") throw new ErrorDeNegocio("No se factura una venta anulada.");

  const vigente = await tx.comprobante.findFirst({
    where: { negocioId, ventaId, tipo: { in: [...TIPOS_FACTURA] }, estado: { in: ["PENDIENTE", "EMITIDO"] } },
    select: { tipo: true, puntoVenta: true, numero: true, estado: true },
  });
  if (vigente) {
    const cual = nombre(vigente.tipo, vigente.puntoVenta, vigente.numero);
    throw new ErrorDeNegocio(
      vigente.estado === "EMITIDO"
        ? `La venta ya está facturada (${cual}).`
        : `La venta tiene la ${cual} esperando respuesta del emisor: consultala antes de volver a facturar.`,
    );
  }

  // Datos fiscales DEL NEGOCIO: su Configuracion (CUIT, punto de venta, razon social...).
  const config = Object.fromEntries((await tx.configuracion.findMany({ where: { negocioId } })).map((c) => [c.clave, c.valor]));
  const fiscales = datosFiscalesDesdeConfiguracion(config, hoy);
  if (!fiscales.ok) throw new ErrorDeNegocio(mensajeFaltantes(faltantesParaEmitir(config, hoy)));
  const emisorDatos = fiscales.datos;

  const cliente = await tx.cliente.findFirstOrThrow({
    where: { id: venta.clienteId, negocioId },
    select: { nombre: true, cuit: true, dni: true, condicionIva: true, direccion: true },
  });
  const tipo = tipoDeComprobante(emisorDatos, cliente);

  const items = await tx.ventaItem.findMany({ where: { negocioId, ventaId }, orderBy: { id: "asc" } });
  const calculo = calcularImportes(
    items.map((i) => ({
      descripcion: i.descripcion,
      cantidad: d(i.cantidad.toString()),
      precioUnitario: d(i.precioUnitario.toString()),
      ivaPct: d(i.ivaPct.toString()),
      subtotalNeto: d(i.subtotalNeto.toString()),
      subtotalIVA: d(i.subtotalIVA.toString()),
      subtotalBruto: d(i.subtotalBruto.toString()),
    })),
    { totalNeto: d(venta.totalNeto), totalIVA: d(venta.totalIVA), totalBruto: d(venta.totalBruto) },
    tipo,
  );
  if (!calculo.ok) throw new ErrorDeNegocio(calculo.error);
  const importes = calculo.importes;

  const rec = validarReceptor(cliente, { tipo, total: importes.total, umbral: emisorDatos.umbralIdentificacion });
  if (!rec.ok) throw new ErrorDeNegocio(rec.error);
  const receptor = rec.receptor;

  // Numeracion: un escritor por serie a la vez.
  const { ambiente } = emisor;
  const puntoVenta = emisorDatos.puntoVenta;
  await bloquearSerie(tx, negocioId, ambiente, puntoVenta, tipo);
  const pendiente = await tx.comprobante.findFirst({
    where: { negocioId, ambiente, puntoVenta, tipo, estado: "PENDIENTE" },
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
    (await tx.comprobante.aggregate({ where: { negocioId, ambiente, puntoVenta, tipo, estado: "EMITIDO" }, _max: { numero: true } }))
      ._max.numero ?? 0;
  if (ultimo !== local) {
    throw new ErrorDeNegocio(
      `El emisor tiene autorizada la ${NOMBRE_TIPO[tipo]} del punto de venta ${puntoVenta} hasta el número ${ultimo}, ` +
        `pero el sistema registra hasta el ${local}. No se emite hasta aclararlo.`,
    );
  }
  const numero = ultimo + 1;

  const creado = await tx.comprobante.create({
    data: {
      negocioId,
      ambiente,
      tipo,
      codigoArca: CODIGO_ARCA[tipo],
      puntoVenta,
      numero,
      fecha: hoy,
      estado: "PENDIENTE",
      emisorRazonSocial: emisorDatos.razonSocial,
      emisorCuit: emisorDatos.cuit,
      emisorCondicionIva: emisorDatos.condicionIva,
      emisorDomicilio: emisorDatos.domicilio,
      emisorInicioActividades: emisorDatos.inicioActividades,
      emisorIibb: emisorDatos.iibb,
      receptorNombre: receptor.nombre,
      receptorDocTipo: receptor.docTipo,
      receptorDocNro: receptor.docNro,
      receptorCondicionIva: receptor.condicionIva,
      receptorDomicilio: receptor.domicilio,
      importeNeto: importes.neto,
      importeIva: importes.iva,
      importeTotal: importes.total,
      ventaId,
      usuarioId: usuarioId ?? null,
      items: { create: importes.lineas.map((l) => ({ negocioId, ...l })) },
      alicuotas: {
        create: importes.alicuotas.map((a) => ({
          negocioId,
          alicuotaPct: a.pct,
          codigoArca: a.codigo,
          baseImponible: a.base,
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
    advertencias: importes.advertencias,
    solicitud: {
      cuitEmisor: emisorDatos.cuit,
      puntoVenta,
      tipo,
      codigoArca: CODIGO_ARCA[tipo],
      numero,
      fecha: hoy,
      concepto: CONCEPTO_PRODUCTOS,
      receptor: {
        docTipo: receptor.docTipo,
        docNro: receptor.docNro,
        condicionIvaCodigo: CODIGO_CONDICION_IVA_RECEPTOR[receptor.condicionIva],
      },
      importes: {
        total: importes.total,
        neto: importes.neto,
        iva: importes.iva,
        alicuotas: importes.alicuotas.map((a) => ({ codigo: a.codigo, base: a.base, importe: a.importe })),
      },
    },
  };
}

// ─── Fase 3: registrar el resultado ───────────────────────────────────────────

/**
 * PENDIENTE → EMITIDO (con CAE) o RECHAZADO (con observaciones). Si ya no esta
 * PENDIENTE, error claro; si ademas el emisor lo APROBO y la base lo tiene
 * RECHAZADO, es una inconsistencia grave y se lanza un error con el CAE para
 * que quede en el log.
 */
export async function registrarResultadoEnTx(
  tx: Tx,
  comprobanteId: string,
  resultado: ResultadoCae,
  advertencias: string[] = [],
): Promise<ComprobanteProcesado> {
  const filas = await tx.$queryRaw<{ estado: string }[]>`
    SELECT estado::text AS estado FROM "comprobantes" WHERE id = ${comprobanteId}::uuid FOR UPDATE`;
  const actual = filas[0];
  if (!actual) throw new ErrorDeNegocio("El comprobante no existe.");
  if (actual.estado !== "PENDIENTE") {
    if (resultado.aprobado && actual.estado === "RECHAZADO") {
      throw new Error(
        `Comprobante ${comprobanteId}: el emisor lo aprobó (CAE ${resultado.cae}) pero la base lo tiene RECHAZADO. Revisar a mano.`,
      );
    }
    throw new ErrorDeNegocio(`El comprobante ya estaba ${actual.estado}.`);
  }

  const observaciones = resultado.aprobado
    ? resultado.observaciones
    : resultado.observaciones.length > 0
      ? resultado.observaciones
      : ["Rechazado por el emisor (sin detalle)."];
  const c = await tx.comprobante.update({
    where: { id: comprobanteId },
    data: resultado.aprobado
      ? {
          estado: "EMITIDO",
          cae: resultado.cae,
          caeVencimiento: resultado.vencimiento,
          observaciones: observaciones.length > 0 ? observaciones.join("\n") : null,
        }
      : { estado: "RECHAZADO", observaciones: observaciones.join("\n") },
  });
  const cual = nombre(c.tipo, c.puntoVenta, c.numero);
  return {
    id: c.id,
    tipo: c.tipo,
    puntoVenta: c.puntoVenta,
    numero: c.numero,
    estado: c.estado,
    cae: c.cae,
    caeVencimiento: c.caeVencimiento,
    observaciones,
    advertencias,
    mensaje: resultado.aprobado
      ? `${cual} emitida (CAE ${c.cae}).`
      : `El emisor rechazó la ${cual}: ${observaciones.join(" ")}`,
  };
}

function quedoPendiente(reserva: FacturaReservada): ComprobanteProcesado {
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
    advertencias: reserva.advertencias,
    mensaje: `No hubo respuesta del emisor: la ${cual} quedó pendiente con su número reservado. Consultala desde Comprobantes antes de reintentar.`,
  };
}

// ─── Todo junto ───────────────────────────────────────────────────────────────

/**
 * Emite la factura de una venta dentro de UNA transaccion (la del que llama).
 * Solo con el emisor SIMULADO: con uno real hay que usar `emitirFactura` (dos
 * fases, ver el encabezado). Un rechazo no es una excepcion: queda RECHAZADO y
 * se devuelve. Si el emisor no responde, queda PENDIENTE.
 */
export async function emitirFacturaEnTx(
  tx: Tx,
  negocioId: string,
  ventaId: string,
  usuarioId: string | null | undefined,
  opciones: OpcionesEmision,
): Promise<ComprobanteProcesado> {
  if (opciones.emisor.ambiente !== "SIMULADO") {
    throw new Error("emitirFacturaEnTx es solo para el emisor simulado: con un emisor real usá emitirFactura (dos fases).");
  }
  const reserva = await reservarFacturaEnTx(tx, negocioId, ventaId, usuarioId, opciones);
  let resultado: ResultadoCae;
  try {
    resultado = await opciones.emisor.solicitarCae(reserva.solicitud);
  } catch {
    return quedoPendiente(reserva);
  }
  return registrarResultadoEnTx(tx, reserva.comprobanteId, resultado, reserva.advertencias);
}

/** Lo minimo de Prisma que necesita el flujo en dos fases: abrir transacciones. */
export type BaseDeDatos = Pick<PrismaClient, "$transaction">;

const OPCIONES_TX = { timeout: 30_000 } as const;

/**
 * La base "parada" en un negocio: cada transaccion que abre es un `conNegocio`
 * (RLS fija el negocio en Postgres). Es lo que las server actions le pasan a
 * `emitirFactura`, `emitirNotaCredito` y `resolverPendiente`, que abren varias
 * transacciones cortas (reservar, registrar) y todas tienen que ser del negocio.
 * Las pruebas con un rol que se salta RLS pueden pasar un `PrismaClient` comun.
 */
export function baseDeNegocio(negocioId: string): BaseDeDatos {
  return {
    $transaction: ((fn: (tx: Tx) => Promise<unknown>, opciones?: OpcionesConNegocio) =>
      conNegocio(negocioId, fn, opciones)) as BaseDeDatos["$transaction"],
  };
}

/**
 * Flujo completo en dos fases (el de la server action). Lanza `ErrorDeNegocio`
 * si no se puede facturar (antes de reservar nada). Devuelve el comprobante
 * EMITIDO, RECHAZADO o, si el emisor no respondio, PENDIENTE.
 */
export async function emitirFactura(
  db: BaseDeDatos,
  negocioId: string,
  ventaId: string,
  usuarioId: string | null | undefined,
  opciones: OpcionesEmision,
): Promise<ComprobanteProcesado> {
  let reserva: FacturaReservada;
  try {
    reserva = await db.$transaction((tx) => reservarFacturaEnTx(tx, negocioId, ventaId, usuarioId, opciones), OPCIONES_TX);
  } catch (error) {
    throw traducirErrorDeEmision(error);
  }
  let resultado: ResultadoCae;
  try {
    resultado = await opciones.emisor.solicitarCae(reserva.solicitud);
  } catch {
    return quedoPendiente(reserva);
  }
  return db.$transaction((tx) => registrarResultadoEnTx(tx, reserva.comprobanteId, resultado, reserva.advertencias), OPCIONES_TX);
}

/**
 * Resuelve un comprobante PENDIENTE (el emisor no respondio) consultando al
 * emisor: si lo tiene autorizado queda EMITIDO con ese CAE; si no, RECHAZADO
 * (y su numero vuelve a estar disponible). Solo si tiene al menos
 * `ANTIGUEDAD_MINIMA_PENDIENTE_MS`: uno mas nuevo puede estar en curso.
 */
export async function resolverPendiente(
  db: BaseDeDatos,
  comprobanteId: string,
  emisor: EmisorFiscal,
  ahora: Date = new Date(),
): Promise<ComprobanteProcesado> {
  const c = await db.$transaction((tx) => tx.comprobante.findUnique({ where: { id: comprobanteId } }), OPCIONES_TX);
  if (!c) throw new ErrorDeNegocio("El comprobante no existe.");
  if (c.estado !== "PENDIENTE") throw new ErrorDeNegocio(`El comprobante ya estaba ${c.estado}.`);
  if (c.ambiente !== emisor.ambiente) {
    throw new ErrorDeNegocio(`El comprobante es del ambiente ${c.ambiente} y el emisor configurado es ${emisor.ambiente}.`);
  }
  if (ahora.getTime() - c.creadoEn.getTime() < ANTIGUEDAD_MINIMA_PENDIENTE_MS) {
    throw new ErrorDeNegocio("El comprobante todavía puede estar esperando respuesta del emisor: probá en unos minutos.");
  }
  const consulta = await emisor.consultar(c.puntoVenta, c.tipo, c.numero);
  let resultado: ResultadoCae;
  if (!consulta.encontrado) {
    resultado = { aprobado: false, observaciones: ["El emisor no tiene autorizado este número (consulta posterior a una falta de respuesta)."] };
  } else if (!consulta.total.eq(d(c.importeTotal.toString()))) {
    throw new ErrorDeNegocio(
      `El emisor tiene autorizado el número ${c.numero} con otro total (${consulta.total.toString()}): revisar a mano.`,
    );
  } else {
    resultado = {
      aprobado: true,
      cae: consulta.cae,
      vencimiento: consulta.vencimiento,
      observaciones: ["Confirmado por consulta posterior al emisor."],
    };
  }
  return db.$transaction((tx) => registrarResultadoEnTx(tx, comprobanteId, resultado), OPCIONES_TX);
}

/**
 * Un choque con un indice unico de comprobantes (no deberia pasar: la venta y la
 * serie se bloquean antes) se traduce a un mensaje claro en vez del error crudo.
 */
export function traducirErrorDeEmision(error: unknown): unknown {
  if (error instanceof ErrorDeNegocio) return error;
  const texto = error instanceof Error ? error.message : String(error);
  const codigo = (error as { code?: string } | null)?.code;
  if (codigo === "P2002" || /23505|unique constraint|Unique constraint/i.test(texto)) {
    return new ErrorDeNegocio("Otra persona está facturando lo mismo en este momento: actualizá la pantalla y revisá antes de reintentar.");
  }
  return error;
}

// ─── Acceso a datos del emisor simulado ───────────────────────────────────────

/**
 * Lo que el simulador lee de la base, de UN negocio (su serie, no la de los demas).
 * Con un `tx`, ve lo de esa transaccion (para `emitirFacturaEnTx`); con el cliente
 * global, lo confirmado.
 */
export function accesoSimulado(db: Pick<Tx, "comprobante">, negocioId: string): AccesoComprobantesSimulados {
  return {
    async ultimoNumeroEmitido(puntoVenta, tipo) {
      const r = await db.comprobante.aggregate({
        where: { negocioId, ambiente: "SIMULADO", puntoVenta, tipo, estado: "EMITIDO" },
        _max: { numero: true },
      });
      return r._max.numero ?? 0;
    },
    async buscarEmitido(puntoVenta, tipo, numero) {
      const c = await db.comprobante.findFirst({
        where: { negocioId, ambiente: "SIMULADO", puntoVenta, tipo, numero, estado: "EMITIDO" },
        select: { cae: true, caeVencimiento: true, fecha: true, importeTotal: true },
      });
      if (!c || !c.cae || !c.caeVencimiento) return null;
      return { cae: c.cae, caeVencimiento: c.caeVencimiento, fecha: c.fecha, importeTotal: d(c.importeTotal.toString()) };
    },
  };
}

/**
 * Lo mismo para las server actions (que no tienen una transaccion a mano): cada
 * lectura abre su propio `conNegocio`, asi RLS ve el negocio correcto.
 */
export function accesoSimuladoDeNegocio(negocioId: string): AccesoComprobantesSimulados {
  return {
    ultimoNumeroEmitido: (puntoVenta, tipo) =>
      conNegocio(negocioId, (tx) => accesoSimulado(tx, negocioId).ultimoNumeroEmitido(puntoVenta, tipo)),
    buscarEmitido: (puntoVenta, tipo, numero) =>
      conNegocio(negocioId, (tx) => accesoSimulado(tx, negocioId).buscarEmitido(puntoVenta, tipo, numero)),
  };
}
