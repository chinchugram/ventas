import QRCode from "qrcode";
import { aMoneda, d, type Dinero } from "@/lib/money";

/**
 * Codigo QR fiscal de un comprobante electronico (RG 4892/2020 de AFIP, hoy ARCA).
 *
 * FUENTE: "Especificaciones del codigo QR" de AFIP/ARCA,
 *   https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
 * (pagina: https://www.afip.gob.ar/fe/qr/). Texto del QR: `{URL}?p={DATOS_CMP_BASE_64}`
 * con URL = `https://www.afip.gob.ar/fe/qr/` y DATOS_CMP_BASE_64 = el JSON de abajo
 * codificado en base64. Version 1 del documento.
 *
 * ATENCION: al escribir esto el host afip.gob.ar NO era accesible desde el entorno
 * de desarrollo (red restringida), asi que el PDF no se pudo leer. Lo que sigue
 * sale de lo que se sabe de la especificacion y de fuentes secundarias (resultados
 * de busqueda que citan el PDF y la documentacion de afipsdk). Hay que VERIFICAR
 * contra el PDF oficial, sobre todo:
 *  - nombres y orden de los campos (aqui: ver, fecha, cuit, ptoVta, tipoCmp,
 *    nroCmp, importe, moneda, ctz, tipoDocRec, nroDocRec, tipoCodAut, codAut);
 *  - que `importe` admite hasta 13 enteros y 2 decimales (se emite siempre con dos);
 *  - que `ctz` es decimal (hasta 6 decimales) y `moneda` un codigo de 3 letras
 *    de la tabla de monedas de ARCA ("PES" = pesos);
 *  - que `fecha` es RFC 3339 "full-date" (YYYY-MM-DD);
 *  - que `cuit`, `nroDocRec` y `codAut` van como NUMEROS (no texto) y `tipoCodAut`
 *    como texto "E" (CAE; "A" seria CAEA);
 *  - el ejemplo oficial (factura en dolares: moneda "DOL", ctz 65, importe 12100,
 *    tipoCmp 1, ptoVta 10, nroCmp 94): si se consigue el PDF, agregarlo como caso
 *    de `scripts/verificar-qr.ts`.
 * Tambien conviene escanear el QR de un comprobante real contra la pagina de
 * validacion de ARCA antes de pasar a produccion.
 *
 * Solo comprobantes EMITIDOS (con CAE) llevan QR. Mientras `ambiente` no sea
 * PRODUCCION el comprobante sale con la marca "SIN VALIDEZ FISCAL" y su QR no
 * valida en ARCA: el QR se dibuja igual para probar el diseno.
 *
 * El JSON se arma a mano (texto) y no con JSON.stringify porque `importe` tiene
 * que conservar dos decimales ("1210.50", "100.00") y un `number` los pierde;
 * ademas el importe sale del Decimal sin pasar por `number`.
 */

export const URL_QR_FISCAL = "https://www.afip.gob.ar/fe/qr/?p=";

export type DatosQr = {
  /** Fecha del comprobante (columna DATE: medianoche UTC). */
  fecha: Date;
  /** CUIT del emisor, con o sin guiones. */
  cuitEmisor: string;
  puntoVenta: number;
  /** Codigo ARCA del tipo (1, 3, 6, 8, 11, 13). */
  codigoTipo: number;
  numero: number;
  importeTotal: Dinero | string | number;
  /** Tipo de documento ARCA del receptor: 80 CUIT, 96 DNI, 99 sin identificar. */
  docTipoReceptor: number;
  /** Numero de documento del receptor ("0" si no esta identificado). */
  docNroReceptor: string;
  /** CAE de 14 digitos. */
  cae: string;
};

const entero = (nombre: string, valor: number, min = 1): string => {
  if (!Number.isSafeInteger(valor) || valor < min) throw new Error(`QR fiscal: ${nombre} inválido (${valor}).`);
  return String(valor);
};

const soloDigitos = (nombre: string, texto: string, largo?: number): string => {
  const limpio = texto.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(limpio) || (largo !== undefined && limpio.length !== largo)) {
    throw new Error(`QR fiscal: ${nombre} inválido ("${texto}").`);
  }
  // JSON no admite ceros a la izquierda en un numero.
  return limpio.replace(/^0+(?=\d)/, "");
};

/** Fecha (DATE de la base, medianoche UTC) → "YYYY-MM-DD". */
export function fechaQr(fecha: Date): string {
  if (Number.isNaN(fecha.getTime())) throw new Error("QR fiscal: fecha inválida.");
  return fecha.toISOString().slice(0, 10);
}

/** Importe con exactamente dos decimales, desde el Decimal (nunca via number). */
export function importeQr(importe: Dinero | string | number): string {
  const v = aMoneda(d(importe));
  if (v.isNegative() || v.isNaN() || !v.isFinite()) throw new Error("QR fiscal: importe inválido.");
  const txt = v.toFixed(2);
  if (txt.split(".")[0]!.length > 13) throw new Error("QR fiscal: importe excede 13 enteros.");
  return txt;
}

/** El JSON del QR (version 1), como texto, con los campos en el orden de la especificacion. */
export function jsonQr(datos: DatosQr): string {
  const campos: [string, string][] = [
    ["ver", "1"],
    ["fecha", `"${fechaQr(datos.fecha)}"`],
    ["cuit", soloDigitos("CUIT del emisor", datos.cuitEmisor, 11)],
    ["ptoVta", entero("punto de venta", datos.puntoVenta)],
    ["tipoCmp", entero("tipo de comprobante", datos.codigoTipo)],
    ["nroCmp", entero("número", datos.numero)],
    ["importe", importeQr(datos.importeTotal)],
    ["moneda", '"PES"'],
    ["ctz", "1"],
    ["tipoDocRec", entero("tipo de documento", datos.docTipoReceptor)],
    ["nroDocRec", soloDigitos("documento del receptor", datos.docNroReceptor)],
    ["tipoCodAut", '"E"'],
    ["codAut", soloDigitos("CAE", datos.cae, 14)],
  ];
  return `{${campos.map(([k, v]) => `"${k}":${v}`).join(",")}}`;
}

/** La URL completa que va dentro del QR. */
export function urlQr(datos: DatosQr): string {
  return URL_QR_FISCAL + Buffer.from(jsonQr(datos), "utf8").toString("base64");
}

/**
 * El QR como SVG (texto), para incrustarlo en el servidor: sale identico en
 * pantalla, al imprimir y en el PDF. Correccion de errores M, borde de 2
 * modulos (zona de silencio), colores fijos negro sobre blanco. Sin ancho ni
 * alto propios: el contenedor define el tamano.
 */
export async function svgQr(datos: DatosQr): Promise<string> {
  return QRCode.toString(urlQr(datos), { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}
