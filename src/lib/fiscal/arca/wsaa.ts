// WSAA: ticket de acceso (TA) para usar `wsfe`. TRA -> firma CMS con el certificado del dueno -> loginCms -> {token, sign}.
// El TA vive SOLO en memoria (docs/06, 4.2 y 4.7). La clave privada nunca se lee en este proceso: la firma la hace `openssl`.
//
// ⚠ Namespace y forma de la respuesta de loginCms de memoria: contrastar con el WSDL de homologacion.
import { spawn } from "node:child_process";
import { ErrorArcaConfiguracion, ErrorArcaIncierto } from "./errores";
import { desescaparXml, escaparXml, primero, tiene } from "./xml";

export type TicketAcceso = { token: string; sign: string; vence: Date };

const NS_WSAA = "http://wsaa.view.sua.dvadac.desein.afip.gov";
const MARGEN_FECHAS_MS = 10 * 60_000;

/** ISO 8601 con la hora de Argentina (UTC-3, sin horario de verano): `2026-11-03T10:00:00-03:00`. */
function isoArgentina(f: Date): string {
  return new Date(f.getTime() - 3 * 3_600_000).toISOString().slice(0, 19) + "-03:00";
}

/** TRA: generado unos minutos atras y vencido unos minutos adelante, para tolerar diferencias de reloj (⚠ verificar margenes). */
export function armarTra(ahora: Date, uniqueId: number, servicio = "wsfe"): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${uniqueId}</uniqueId><generationTime>${isoArgentina(new Date(ahora.getTime() - MARGEN_FECHAS_MS))}</generationTime>` +
    `<expirationTime>${isoArgentina(new Date(ahora.getTime() + MARGEN_FECHAS_MS))}</expirationTime></header>` +
    `<service>${escaparXml(servicio)}</service></loginTicketRequest>`
  );
}

export type ArchivosFirma = { certPath: string; keyPath: string; keyPassphrase?: string };

/** Firma el TRA en CMS (PKCS#7, DER) con `openssl cms -sign` y lo devuelve en base64. La contrasena va por entorno, no por argv. */
export function firmarTra(tra: string, a: ArchivosFirma, openssl = "openssl"): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["cms", "-sign", "-nodetach", "-outform", "DER", "-signer", a.certPath, "-inkey", a.keyPath];
    const env = { ...process.env };
    if (a.keyPassphrase) {
      env.ARCA_KEY_PASSPHRASE = a.keyPassphrase;
      args.push("-passin", "env:ARCA_KEY_PASSPHRASE");
    }
    const hijo = spawn(openssl, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const salida: Buffer[] = [];
    const err: Buffer[] = [];
    hijo.stdout.on("data", (b: Buffer) => salida.push(b));
    hijo.stderr.on("data", (b: Buffer) => err.push(b));
    hijo.on("error", () => reject(new ErrorArcaConfiguracion("No se pudo ejecutar openssl para firmar el pedido de acceso a ARCA.")));
    hijo.on("close", (codigo) => {
      if (codigo !== 0) {
        // El mensaje de openssl no se propaga tal cual: puede nombrar rutas de la clave.
        reject(new ErrorArcaConfiguracion("openssl no pudo firmar con el certificado y la clave configurados (revisar ARCA_CERT_PATH, ARCA_KEY_PATH y la contrasena)."));
        return;
      }
      resolve(Buffer.concat(salida).toString("base64"));
    });
    hijo.stdin.end(tra);
  });
}

export function xmlLoginCms(cmsBase64: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<loginCms xmlns="${NS_WSAA}"><in0>${cmsBase64}</in0></loginCms></soap:Body></soap:Envelope>`
  );
}

export const ACCION_LOGIN_CMS = "";

/** Lee la respuesta de loginCms. Un Fault de "ya tiene un TA valido" no es un TA: se informa claro, sin reintentar en bucle. */
export function leerLoginCms(xml: string): TicketAcceso {
  if (tiene(xml, "Fault")) {
    const msg = primero(xml, "faultstring") ?? "";
    if (/alreadyAuthenticated|ya posee un TA|ya tiene un TA/i.test(msg)) {
      throw new ErrorArcaIncierto("ARCA indica que ya hay un ticket de acceso vigente para este certificado; reintentar cuando venza el anterior.");
    }
    throw new ErrorArcaConfiguracion("ARCA rechazo la autenticacion (certificado vencido, no asociado al servicio wsfe, o CUIT que no coincide).");
  }
  const retorno = primero(xml, "loginCmsReturn");
  if (!retorno) throw new ErrorArcaIncierto("Respuesta ilegible de ARCA en loginCms.");
  const ta = desescaparXml(retorno);
  const token = primero(ta, "token");
  const sign = primero(ta, "sign");
  const vence = new Date(primero(ta, "expirationTime") ?? "");
  if (!token || !sign || Number.isNaN(vence.getTime())) throw new ErrorArcaIncierto("El ticket de acceso de ARCA vino incompleto.");
  return { token, sign, vence };
}

/**
 * Cache del TA en memoria con renovacion anticipada y un solo pedido a la vez (si dos facturas llegan juntas con el TA
 * vencido, la segunda espera la promesa de la primera). `invalidar()` fuerza uno nuevo.
 */
export class GestorTicket {
  private actual: TicketAcceso | null = null;
  private pendiente: Promise<TicketAcceso> | null = null;

  constructor(
    private readonly pedir: () => Promise<TicketAcceso>,
    private readonly ahora: () => Date = () => new Date(),
    private readonly margenMs = 10 * 60_000,
  ) {}

  async obtener(): Promise<TicketAcceso> {
    if (this.actual && this.actual.vence.getTime() - this.ahora().getTime() > this.margenMs) return this.actual;
    this.pendiente ??= this.pedir()
      .then((t) => {
        this.actual = t;
        return t;
      })
      .finally(() => {
        this.pendiente = null;
      });
    return this.pendiente;
  }

  invalidar(): void {
    this.actual = null;
  }
}
