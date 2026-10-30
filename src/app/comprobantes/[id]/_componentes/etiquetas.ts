import { formatearCuit } from "@/lib/cuit";
import { fmtMoneda, type Dinero } from "@/lib/money";
import { DOC_TIPO, type CondicionIva, type TipoComprobante } from "@/lib/comprobantes";

/** Textos fijos de las pantallas de comprobante (detalle e imprimible). */

export const ETIQUETA_CONDICION_IVA: Record<CondicionIva, string> = {
  RESPONSABLE_INSCRIPTO: "IVA Responsable Inscripto",
  MONOTRIBUTO: "Responsable Monotributo",
  EXENTO: "IVA Sujeto Exento",
  CONSUMIDOR_FINAL: "Consumidor Final",
};

export const ETIQUETA_AMBIENTE = {
  SIMULADO: "Simulado",
  HOMOLOGACION: "Homologación (pruebas de ARCA)",
  PRODUCCION: "Producción",
} as const;

export const ETIQUETA_ESTADO = {
  PENDIENTE: "Pendiente de autorización",
  EMITIDO: "Emitido",
  RECHAZADO: "Rechazado",
} as const;

export const ESTILO_ESTADO = {
  PENDIENTE: "bg-amber-50 text-amber-800",
  EMITIDO: "bg-emerald-50 text-emerald-700",
  RECHAZADO: "bg-red-50 text-red-700",
} as const;

/** "Factura" / "Nota de crédito" (la letra va aparte, en el recuadro). */
export function tituloDeTipo(tipo: TipoComprobante): string {
  return tipo.startsWith("NOTA_CREDITO") ? "Nota de crédito" : "Factura";
}

/** "006" (codigo ARCA a tres digitos, como en los comprobantes). */
export function codigoDe(codigoArca: number): string {
  return String(codigoArca).padStart(3, "0");
}

/** Documento del receptor para mostrar: "CUIT 30-71234567-1", "DNI 12.345.678" o "Sin identificar". */
export function textoDocumento(docTipo: number, docNro: string): string {
  if (docTipo === DOC_TIPO.CUIT) return `CUIT ${formatearCuit(docNro)}`;
  if (docTipo === DOC_TIPO.DNI) return `DNI ${docNro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
  return "Sin identificar";
}

/**
 * Leyenda del régimen de transparencia fiscal (factura B). VERIFICAR CON EL
 * CONTADOR: el texto exacto y la norma que lo respalda (Ley 27.743 / RG de ARCA
 * sobre "IVA contenido" y "otros impuestos nacionales indirectos") cambian con
 * la normativa; el sistema no calcula otros impuestos nacionales indirectos
 * (se informan en 0,00).
 */
export const LEYENDA_TRANSPARENCIA = "Régimen de Transparencia Fiscal al Consumidor";

const formatoUnitario = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Precio unitario: 2 decimales, hasta 4 si los tiene. */
export function fmtUnitario(valor: Dinero): string {
  return formatoUnitario.format(valor.toNumber());
}

export { fmtMoneda };
