import type { Dinero } from "@/lib/money";
import type { DocTipo, TipoComprobante } from "@/lib/comprobantes";

// Interfaz del emisor fiscal: quien autoriza un comprobante y le da el CAE. Hoy
// la implementa el simulador (`emisor-simulado.ts`); manana la implementara ARCA
// (WSFE) sin cambiar nada mas. Sin dependencias de Prisma ni Next.

export type AmbienteFiscal = "SIMULADO" | "HOMOLOGACION" | "PRODUCCION";

/** Concepto ARCA: 1 productos, 2 servicios, 3 productos y servicios. Ver docs/fiscal-5.1-decisiones.md. */
export type ConceptoArca = 1 | 2 | 3;

/** Lo que se le pide autorizar al emisor (lo que ARCA recibe en FECAESolicitar). */
export type SolicitudCae = {
  cuitEmisor: string;
  puntoVenta: number;
  tipo: TipoComprobante;
  codigoArca: number;
  numero: number;
  fecha: Date;
  concepto: ConceptoArca;
  receptor: {
    docTipo: DocTipo;
    docNro: string;
    /** `CondicionIVAReceptorId` de ARCA (ver CODIGO_CONDICION_IVA_RECEPTOR). */
    condicionIvaCodigo: number;
  };
  /** Pesos: hoy no se factura en otra moneda (MonId "PES", cotizacion 1). */
  importes: {
    total: Dinero;
    neto: Dinero;
    iva: Dinero;
    /** Vacio en la C. */
    alicuotas: { codigo: number; base: Dinero; importe: Dinero }[];
  };
  /** Solo en notas de credito: la factura que anulan. */
  comprobanteAsociado?: { tipo: TipoComprobante; codigoArca: number; puntoVenta: number; numero: number };
};

export type ResultadoCae =
  | { aprobado: true; cae: string; vencimiento: Date; observaciones: string[] }
  | { aprobado: false; observaciones: string[] };

export type ComprobanteConsultado =
  | { encontrado: false }
  | { encontrado: true; cae: string; vencimiento: Date; fecha: Date; total: Dinero };

export interface EmisorFiscal {
  /** Todo lo que autoriza este emisor lleva este ambiente. */
  readonly ambiente: AmbienteFiscal;
  /** Ultimo numero autorizado para (punto de venta, tipo); 0 si no hay ninguno. */
  ultimoAutorizado(puntoVenta: number, tipo: TipoComprobante): Promise<number>;
  /**
   * Pide el CAE. Un rechazo es un resultado (`aprobado: false`), no una
   * excepcion. Una excepcion significa "no se sabe": corte, timeout. En ese caso
   * el comprobante queda PENDIENTE y hay que consultar antes de reintentar.
   */
  solicitarCae(solicitud: SolicitudCae): Promise<ResultadoCae>;
  /** Lo que el emisor tiene autorizado con ese numero (para resolver un PENDIENTE). */
  consultar(puntoVenta: number, tipo: TipoComprobante, numero: number): Promise<ComprobanteConsultado>;
}
