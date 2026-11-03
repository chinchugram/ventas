import { CODIGO_ARCA, type TipoComprobante } from "@/lib/comprobantes";
import type { AmbienteFiscal, ComprobanteConsultado, EmisorFiscal, ResultadoCae, SolicitudCae } from "./emisor";
import { URLS_ARCA, type AmbienteArca } from "./arca/config";
import { ErrorArcaConfiguracion, ErrorArcaIncierto } from "./arca/errores";
import type { EnviarSoap } from "./arca/transporte";
import type { GestorTicket } from "./arca/wsaa";
import {
  accionWsfe,
  leerConsulta,
  leerResultadoCae,
  leerUltimoAutorizado,
  xmlConsultar,
  xmlSolicitarCae,
  xmlUltimoAutorizado,
} from "./arca/wsfe";

// Emisor de ARCA (WSFEv1). Implementa el contrato de `EmisorFiscal` (docs/06-facturacion-arca.md, 2.3):
//  - `ultimoAutorizado` y `consultar` son lecturas: se reintentan solo ante errores "inciertos" y SIEMPRE lanzan ante la duda.
//  - `solicitarCae` hace UN intento: nunca se reenvia sola. Ante cualquier duda lanza y el comprobante queda PENDIENTE.
//  - El ambiente sale de la construccion y las URLs van atadas a el: no hay forma de mezclarlos.
//  - No toca la base, no lee `process.env`, no loguea credenciales.

export type OpcionesEmisorArca = {
  ambiente: AmbienteArca;
  /** CUIT del emisor (el del negocio): 11 digitos. */
  cuit: string;
  tickets: GestorTicket;
  enviar: EnviarSoap;
  /** Solo para pruebas: otras URLs. En PRODUCCION no se admiten distintas de las oficiales. */
  urls?: { wsfe: string };
  /** Pausa entre reintentos de lectura (inyectable para probar sin esperar). */
  dormir?: (ms: number) => Promise<void>;
  intentosLectura?: number;
};

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function crearEmisorArca(op: OpcionesEmisorArca): EmisorFiscal {
  if (!/^\d{11}$/.test(op.cuit)) throw new ErrorArcaConfiguracion("El CUIT del emisor tiene que tener 11 digitos.");
  const oficial = URLS_ARCA[op.ambiente];
  const urlWsfe = op.urls?.wsfe ?? oficial.wsfe;
  if (op.ambiente === "PRODUCCION" && urlWsfe !== oficial.wsfe) {
    throw new ErrorArcaConfiguracion("En produccion el emisor solo puede usar las URLs oficiales de produccion.");
  }
  const ambiente: AmbienteFiscal = op.ambiente;
  const dormir = op.dormir ?? dormirReal;
  const intentos = Math.max(1, op.intentosLectura ?? 3);

  async function llamar(operacion: string, armar: (a: { token: string; sign: string; cuit: string }) => string): Promise<string> {
    const ta = await op.tickets.obtener();
    const r = await op.enviar(urlWsfe, accionWsfe(operacion), armar({ token: ta.token, sign: ta.sign, cuit: op.cuit }));
    return r.cuerpo;
  }

  /** Lectura con reintentos (espera creciente) SOLO ante `ErrorArcaIncierto`. La configuracion no se reintenta. */
  async function leer<T>(operacion: string, armar: Parameters<typeof llamar>[1], interpretar: (xml: string) => T): Promise<T> {
    let ultimo: unknown;
    for (let i = 0; i < intentos; i++) {
      try {
        return interpretar(await llamar(operacion, armar));
      } catch (e) {
        if (e instanceof ErrorArcaConfiguracion) {
          op.tickets.invalidar(); // por si el TA era el problema; la proxima llamada pide uno nuevo
          throw e;
        }
        if (!(e instanceof ErrorArcaIncierto)) throw e;
        ultimo = e;
        if (i < intentos - 1) await dormir(500 * 2 ** i);
      }
    }
    throw ultimo;
  }

  return {
    ambiente,

    ultimoAutorizado(puntoVenta: number, tipo: TipoComprobante): Promise<number> {
      return leer("FECompUltimoAutorizado", (a) => xmlUltimoAutorizado(a, puntoVenta, CODIGO_ARCA[tipo]), leerUltimoAutorizado);
    },

    consultar(puntoVenta: number, tipo: TipoComprobante, numero: number): Promise<ComprobanteConsultado> {
      return leer("FECompConsultar", (a) => xmlConsultar(a, puntoVenta, CODIGO_ARCA[tipo], numero), leerConsulta);
    },

    async solicitarCae(solicitud: SolicitudCae): Promise<ResultadoCae> {
      if (solicitud.cuitEmisor !== op.cuit) {
        throw new ErrorArcaConfiguracion("El CUIT de la solicitud no coincide con el del emisor configurado.");
      }
      try {
        return leerResultadoCae(await llamar("FECAESolicitar", (a) => xmlSolicitarCae(a, solicitud)));
      } catch (e) {
        if (e instanceof ErrorArcaConfiguracion) op.tickets.invalidar();
        throw e; // un solo intento: cualquier duda deja el comprobante PENDIENTE
      }
    },
  };
}
