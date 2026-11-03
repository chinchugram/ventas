// Errores del emisor de ARCA. Dos clases, para que el dominio y la pantalla sepan que hacer:
//
//   ErrorArcaConfiguracion  certificado vencido o no asociado a `wsfe`, CUIT que no coincide, punto de venta no habilitado.
//                           NO se reintenta: hay que arreglar la configuracion.
//   ErrorArcaIncierto       corte, timeout, 5xx, SOAP Fault, respuesta ilegible. "No se sabe": en `solicitarCae` deja el
//                           comprobante PENDIENTE (se consulta antes de reintentar); las lecturas si se reintentan.
//
// Ningun mensaje lleva token, sign, claves ni rutas de certificados (docs/06-facturacion-arca.md, 4.7).

export class ErrorArcaConfiguracion extends Error {
  override readonly name = "ErrorArcaConfiguracion";
}

export class ErrorArcaIncierto extends Error {
  override readonly name = "ErrorArcaIncierto";
}

/** Codigos de WSFE que significan "no te pude autenticar / autorizar": son de configuracion (⚠ verificar contra la fuente). */
export const CODIGOS_ARCA_CONFIGURACION: ReadonlySet<number> = new Set([600, 601, 603, 604, 605]);

/** `FECompConsultar`: "no hay datos en los registros". Unico caso que significa "no existe" (⚠ verificar contra la fuente). */
export const CODIGO_ARCA_NO_EXISTE = 602;
