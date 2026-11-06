import {
  esFactura,
  esNotaCredito,
  TIPOS_FACTURA,
  TIPOS_NOTA_CREDITO,
  tipoDeComprobante,
  validarReceptor,
  type ClienteReceptor,
  type TipoComprobante,
  type TipoFactura,
} from "@/lib/comprobantes";
import { datosFiscalesDesdeConfiguracion, faltantesParaEmitir, mensajeFaltantes } from "@/lib/datos-fiscales";
import { fmtMoneda, type Dinero } from "@/lib/money";
import { rangoEntre, type ParamsFecha } from "@/lib/rango-fechas";

// Facturar desde la venta y listado de comprobantes (tarea 5.5): lo logico, puro
// (sin Prisma ni Next), para probarlo con `npm run test:facturar`.
//
//  1. Filtros del listado `/comprobantes` (URL → filtros → `where` de Prisma).
//  2. Estado de facturacion de una venta, derivado de sus comprobantes.
//  3. Avisos antes de emitir (datos fiscales, emisor deshabilitado, receptor...).

// ─── 1. Filtros del listado ───────────────────────────────────────────────────

export const TIPOS_LISTADO: readonly TipoComprobante[] = [...TIPOS_FACTURA, ...TIPOS_NOTA_CREDITO];
export const ESTADOS_COMPROBANTE = ["PENDIENTE", "EMITIDO", "RECHAZADO"] as const;
export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number];
export const AMBIENTES_COMPROBANTE = ["SIMULADO", "HOMOLOGACION", "PRODUCCION"] as const;
export type AmbienteComprobante = (typeof AMBIENTES_COMPROBANTE)[number];

export const ETIQUETA_ESTADO_COMPROBANTE: Record<EstadoComprobante, string> = {
  PENDIENTE: "Pendiente",
  EMITIDO: "Emitido",
  RECHAZADO: "Rechazado",
};
export const ETIQUETA_AMBIENTE: Record<AmbienteComprobante, string> = {
  SIMULADO: "Simulado",
  HOMOLOGACION: "Homologación",
  PRODUCCION: "Producción",
};

/** Cuantos comprobantes por pagina del listado. */
export const TAMANO_PAGINA = 30;

/** Marca obligatoria de todo comprobante que no es de produccion (contrato de la ola 5). */
export const MARCA_SIN_VALIDEZ_FISCAL = "SIN VALIDEZ FISCAL";

export function sinValidezFiscal(ambiente: AmbienteComprobante): boolean {
  return ambiente !== "PRODUCCION";
}

export type FiltrosComprobantes = {
  tipo: TipoComprobante | null;
  estado: EstadoComprobante | null;
  ambiente: AmbienteComprobante | null;
  /** Primer dia incluido, medianoche UTC (con `hasta`; siempre vienen los dos o ninguno). */
  desde: Date | null;
  /** Primer dia NO incluido, medianoche UTC. */
  hasta: Date | null;
  desdeISO: string | null;
  /** Ultimo dia incluido. */
  hastaISO: string | null;
  /** 1, 2, 3... */
  pagina: number;
  /** Que se ignoro o corrigio de la URL. */
  avisos: string[];
};

const primero = (v: string | string[] | undefined) => {
  const x = (Array.isArray(v) ? v[0] : v)?.trim();
  return x ? x : undefined;
};

function elegir<T extends string>(valor: string | undefined, validos: readonly T[], que: string, avisos: string[]): T | null {
  if (valor === undefined || valor === "") return null;
  const hallado = validos.find((v) => v === valor);
  if (!hallado) avisos.push(`El filtro de ${que} no es válido y se ignoró.`);
  return hallado ?? null;
}

/**
 * Lo que llega en la URL (`?tipo=&estado=&ambiente=&desde=&hasta=&pagina=`) →
 * filtros. NUNCA lanza: lo invalido se ignora y se cuenta en `avisos`. Sin
 * fechas no hay filtro de fechas (a diferencia de los reportes, que usan el mes
 * actual): el listado de comprobantes muestra todo, lo mas nuevo primero.
 */
export function parseFiltrosComprobantes(params: ParamsFecha): FiltrosComprobantes {
  const avisos: string[] = [];
  const tipo = elegir(primero(params.tipo), TIPOS_LISTADO, "tipo", avisos);
  const estado = elegir(primero(params.estado), ESTADOS_COMPROBANTE, "estado", avisos);
  const ambiente = elegir(primero(params.ambiente), AMBIENTES_COMPROBANTE, "ambiente", avisos);

  let desde: Date | null = null;
  let hasta: Date | null = null;
  let desdeISO: string | null = null;
  let hastaISO: string | null = null;
  const d0 = primero(params.desde);
  const h0 = primero(params.hasta);
  if (d0 !== undefined || h0 !== undefined) {
    const rango = d0 !== undefined && h0 !== undefined ? rangoEntre(d0, h0, avisos) : null;
    if (rango) {
      desde = rango.desde;
      hasta = rango.hasta;
      desdeISO = rango.desdeISO;
      hastaISO = rango.hastaISO;
    } else {
      avisos.push("Para filtrar por fecha hacen falta las dos fechas (desde y hasta) y que sean válidas; se ignoraron.");
    }
  }

  const textoPagina = primero(params.pagina);
  let pagina = 1;
  if (textoPagina !== undefined) {
    if (/^\d{1,6}$/.test(textoPagina) && Number(textoPagina) >= 1) pagina = Number(textoPagina);
    else avisos.push("El número de página no es válido; se muestra la primera.");
  }
  return { tipo, estado, ambiente, desde, hasta, desdeISO, hastaISO, pagina, avisos };
}

/** `where` de Prisma para el listado (estructural: no importa Prisma). */
export type WhereComprobantes = {
  tipo?: TipoComprobante;
  estado?: EstadoComprobante;
  ambiente?: AmbienteComprobante;
  fecha?: { gte: Date; lt: Date };
};

export function whereDeFiltros(f: Pick<FiltrosComprobantes, "tipo" | "estado" | "ambiente" | "desde" | "hasta">): WhereComprobantes {
  const where: WhereComprobantes = {};
  if (f.tipo) where.tipo = f.tipo;
  if (f.estado) where.estado = f.estado;
  if (f.ambiente) where.ambiente = f.ambiente;
  if (f.desde && f.hasta) where.fecha = { gte: f.desde, lt: f.hasta };
  return where;
}

/** Query string de los filtros (sin "?"), para armar los enlaces de pagina. */
export function queryDeFiltros(f: Pick<FiltrosComprobantes, "tipo" | "estado" | "ambiente" | "desdeISO" | "hastaISO">, pagina?: number): string {
  const partes: string[] = [];
  if (f.tipo) partes.push(`tipo=${f.tipo}`);
  if (f.estado) partes.push(`estado=${f.estado}`);
  if (f.ambiente) partes.push(`ambiente=${f.ambiente}`);
  if (f.desdeISO && f.hastaISO) partes.push(`desde=${f.desdeISO}`, `hasta=${f.hastaISO}`);
  if (pagina && pagina > 1) partes.push(`pagina=${pagina}`);
  return partes.join("&");
}

/** `skip` / `take` de una pagina, y la pagina real si se pidio una que no existe. */
export function paginar(total: number, pagina: number, tamano: number = TAMANO_PAGINA) {
  const totalPaginas = Math.max(1, Math.ceil(total / tamano));
  const actual = Math.min(Math.max(1, pagina), totalPaginas);
  return { pagina: actual, totalPaginas, skip: (actual - 1) * tamano, take: tamano };
}

// ─── 2. Estado de facturacion de una venta ────────────────────────────────────

/** Lo minimo de un comprobante para derivar el estado de facturacion de su venta. */
export type ComprobanteDeVenta = {
  id: string;
  tipo: TipoComprobante;
  estado: EstadoComprobante;
  ambiente: AmbienteComprobante;
  puntoVenta: number;
  numero: number;
  fecha: Date;
  importeTotal: Dinero;
  observaciones: string | null;
  comprobanteAsociadoId: string | null;
  creadoEn: Date;
};

export type SituacionFacturacion =
  /** Se puede facturar. */
  | "SIN_FACTURA"
  /** Factura EMITIDA vigente (la NC, si hay, todavia no se emitio). */
  | "EMITIDA"
  /** Factura EMITIDA con una nota de credito EMITIDA. */
  | "CON_NOTA_CREDITO"
  /** Factura PENDIENTE (el emisor no respondio): hay que resolverla. */
  | "PENDIENTE"
  /** Ultimo intento RECHAZADO: se puede reintentar. */
  | "RECHAZADA"
  /** Venta anulada sin factura vigente: no se factura. */
  | "VENTA_ANULADA";

export type ResumenFacturacion = {
  situacion: SituacionFacturacion;
  /** La factura vigente o, en RECHAZADA, la ultima rechazada. */
  factura: ComprobanteDeVenta | null;
  /** Nota de credito de la factura vigente (la EMITIDA, o si no hay la PENDIENTE). */
  notaCredito: ComprobanteDeVenta | null;
  /** La venta admite pedir una factura nueva (sin contar avisos de datos). */
  puedeEmitir: boolean;
  /** Cuantos intentos RECHAZADOS tiene la venta (para mostrar "es un reintento"). */
  rechazos: number;
};

const masNuevoPrimero = (a: ComprobanteDeVenta, b: ComprobanteDeVenta) => b.creadoEn.getTime() - a.creadoEn.getTime();

/** Deriva el estado de facturacion de la venta a partir de TODOS sus comprobantes. Nada se persiste. */
export function derivarFacturacion(comprobantes: readonly ComprobanteDeVenta[], ventaAnulada: boolean): ResumenFacturacion {
  const facturas = comprobantes.filter((c) => esFactura(c.tipo)).sort(masNuevoPrimero);
  const notas = comprobantes.filter((c) => esNotaCredito(c.tipo)).sort(masNuevoPrimero);
  const rechazos = facturas.filter((f) => f.estado === "RECHAZADO").length;
  const vigente = facturas.find((f) => f.estado === "PENDIENTE" || f.estado === "EMITIDO") ?? null;

  if (vigente?.estado === "PENDIENTE") {
    return { situacion: "PENDIENTE", factura: vigente, notaCredito: null, puedeEmitir: false, rechazos };
  }
  if (vigente) {
    const deLaFactura = notas.filter((n) => n.comprobanteAsociadoId === vigente.id);
    const emitida = deLaFactura.find((n) => n.estado === "EMITIDO") ?? null;
    const pendiente = deLaFactura.find((n) => n.estado === "PENDIENTE") ?? null;
    return {
      situacion: emitida ? "CON_NOTA_CREDITO" : "EMITIDA",
      factura: vigente,
      notaCredito: emitida ?? pendiente,
      // Con una factura vigente (aunque tenga NC) no se vuelve a facturar la misma venta.
      puedeEmitir: false,
      rechazos,
    };
  }
  if (ventaAnulada) return { situacion: "VENTA_ANULADA", factura: null, notaCredito: null, puedeEmitir: false, rechazos };
  const rechazada = facturas.find((f) => f.estado === "RECHAZADO") ?? null;
  if (rechazada) return { situacion: "RECHAZADA", factura: rechazada, notaCredito: null, puedeEmitir: true, rechazos };
  return { situacion: "SIN_FACTURA", factura: null, notaCredito: null, puedeEmitir: true, rechazos };
}

/**
 * Un PENDIENTE se puede resolver (consultar al emisor) cuando tiene al menos
 * `antiguedadMinimaMs`: uno mas nuevo puede estar esperando la respuesta en otro
 * pedido. Misma regla que `resolverPendiente` del dominio.
 */
export function pendienteResoluble(creadoEn: Date, ahora: Date, antiguedadMinimaMs: number): boolean {
  return ahora.getTime() - creadoEn.getTime() >= antiguedadMinimaMs;
}

// ─── 3. Avisos antes de emitir ────────────────────────────────────────────────

export type AvisoBloqueante = {
  codigo: "EMISOR_DESHABILITADO" | "DATOS_FISCALES" | "RECEPTOR";
  mensaje: string;
};

export type EntradaAvisos = {
  /** `seleccionarEmisor(entornoDelProceso())`: si se puede emitir con algun emisor. */
  emisor: { ok: true } | { ok: false; error: string };
  /** `Configuracion` completa (clave → valor). */
  config: Readonly<Record<string, string | undefined>>;
  /** Hoy en Argentina (valida la fecha de inicio de actividades). */
  hoy: Date;
  cliente: ClienteReceptor;
  ventaTotal: Dinero;
  ventaIva: Dinero;
};

export type AvisosFacturacion = {
  /** Impiden emitir; el boton queda deshabilitado y se muestra el motivo. */
  bloqueantes: AvisoBloqueante[];
  /** No impiden emitir pero hay que verlos. */
  advertencias: string[];
  /** La factura que saldria (null si no se pudo determinar: faltan datos fiscales). */
  tipoPrevisto: TipoFactura | null;
};

/**
 * Todo lo que conviene saber ANTES de apretar "Facturar", con la misma logica
 * que usa la emision (`datosFiscalesDesdeConfiguracion`, `tipoDeComprobante`,
 * `validarReceptor`), asi lo que se avisa es lo que despues se rechazaria.
 * La emision lo vuelve a verificar todo: esto es solo para no dejar al usuario
 * tocar un boton que va a fallar.
 */
export function avisosParaEmitir(e: EntradaAvisos): AvisosFacturacion {
  const bloqueantes: AvisoBloqueante[] = [];
  const advertencias: string[] = [];
  let tipoPrevisto: TipoFactura | null = null;

  if (!e.emisor.ok) bloqueantes.push({ codigo: "EMISOR_DESHABILITADO", mensaje: e.emisor.error });

  const fiscales = datosFiscalesDesdeConfiguracion(e.config, e.hoy);
  if (!fiscales.ok) {
    bloqueantes.push({ codigo: "DATOS_FISCALES", mensaje: mensajeFaltantes(faltantesParaEmitir(e.config, e.hoy)) });
  } else {
    const datos = fiscales.datos;
    tipoPrevisto = tipoDeComprobante(datos, e.cliente);
    const receptor = validarReceptor(e.cliente, { tipo: tipoPrevisto, total: e.ventaTotal, umbral: datos.umbralIdentificacion });
    if (!receptor.ok) bloqueantes.push({ codigo: "RECEPTOR", mensaje: receptor.error });
    if (datos.condicionIva === "MONOTRIBUTO" && e.ventaIva.gt(0)) {
      advertencias.push(
        `La venta tiene ${fmtMoneda(e.ventaIva)} de IVA, pero la factura C no discrimina IVA: sale por el total (${fmtMoneda(e.ventaTotal)}). ` +
          "Como monotributista, cargá tus artículos con IVA 0.",
      );
    }
  }
  return { bloqueantes, advertencias, tipoPrevisto };
}
