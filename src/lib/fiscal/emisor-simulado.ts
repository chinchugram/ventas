import { createHash } from "node:crypto";
import { DOC_TIPO, esNotaCredito, letraDe, type TipoComprobante } from "@/lib/comprobantes";
import { sumar, type Dinero } from "@/lib/money";
import type { ComprobanteConsultado, EmisorFiscal, ResultadoCae, SolicitudCae } from "./emisor";

// Emisor SIMULADO: autoriza como lo haria ARCA, pero sin ARCA. Todo lo que
// emite lleva `ambiente = SIMULADO` y se muestra "SIN VALIDEZ FISCAL".
//
// No guarda nada propio: lo "autorizado" es lo que la base tiene EMITIDO en el
// ambiente SIMULADO. Asi la numeracion es por (ambiente, punto de venta, tipo) y
// es siempre consistente con la base. El acceso a datos se inyecta (lo arma
// src/lib/dominio/comprobantes.ts con Prisma): este modulo no conoce la base.

/** Lo que el simulador necesita leer de la base (solo comprobantes SIMULADO y EMITIDO). */
export type AccesoComprobantesSimulados = {
  /** Mayor numero EMITIDO en SIMULADO para (punto de venta, tipo); 0 si no hay. */
  ultimoNumeroEmitido(puntoVenta: number, tipo: TipoComprobante): Promise<number>;
  buscarEmitido(
    puntoVenta: number,
    tipo: TipoComprobante,
    numero: number,
  ): Promise<{ cae: string; caeVencimiento: Date; fecha: Date; importeTotal: Dinero } | null>;
};

export type OpcionesSimulador = {
  /**
   * Para pruebas: devuelve observaciones para rechazar la solicitud (como haria
   * ARCA), o null para seguir con las validaciones normales.
   */
  rechazar?: (solicitud: SolicitudCae) => string[] | null;
  /** Para pruebas: simula un corte (la solicitud lanza en vez de responder). */
  cortar?: (solicitud: SolicitudCae) => boolean;
};

/** Dias de validez del CAE (ARCA suele dar 10 dias corridos desde la fecha del comprobante). */
export const DIAS_VENCIMIENTO_CAE = 10;

/**
 * CAE de 14 digitos con apariencia plausible, determinista: el mismo
 * comprobante (CUIT, punto, tipo, numero, fecha) da siempre el mismo CAE. Empieza
 * con 7 (como los CAE reales de estos anios) para que no tenga ceros a la izquierda.
 */
export function generarCae(semilla: string): string {
  const hash = createHash("sha256").update(semilla).digest();
  let digitos = "";
  for (const byte of hash) {
    digitos += String(byte % 10);
    if (digitos.length === 13) break;
  }
  return `7${digitos}`;
}

const sumarDias = (fecha: Date, dias: number) => new Date(fecha.getTime() + dias * 86_400_000);

export function crearEmisorSimulado(acceso: AccesoComprobantesSimulados, opciones: OpcionesSimulador = {}): EmisorFiscal {
  return {
    ambiente: "SIMULADO",

    ultimoAutorizado: (puntoVenta, tipo) => acceso.ultimoNumeroEmitido(puntoVenta, tipo),

    async solicitarCae(s): Promise<ResultadoCae> {
      if (opciones.cortar?.(s)) throw new Error("Simulador: sin respuesta (corte simulado)");
      const forzado = opciones.rechazar?.(s);
      if (forzado) return { aprobado: false, observaciones: forzado };

      // Las mismas validaciones basicas que hace ARCA (codigos de WSFE entre corchetes).
      const observaciones: string[] = [];
      const ultimo = await acceso.ultimoNumeroEmitido(s.puntoVenta, s.tipo);
      if (s.numero !== ultimo + 1) {
        observaciones.push(`[10016] El número ${s.numero} no es el próximo a autorizar (${ultimo + 1}).`);
      }
      if (letraDe(s.tipo) === "A" && s.receptor.docTipo !== DOC_TIPO.CUIT) {
        observaciones.push("[10013] La factura A exige un receptor identificado con CUIT.");
      }
      const { total, neto, iva, alicuotas } = s.importes;
      if (!total.eq(neto.plus(iva))) observaciones.push("[10048] El total no es neto + IVA.");
      if (letraDe(s.tipo) === "C") {
        if (alicuotas.length > 0 || !iva.isZero()) observaciones.push("[10071] La C no discrimina IVA.");
      } else if (
        alicuotas.length === 0 ||
        !sumar(...alicuotas.map((a) => a.base)).eq(neto) ||
        !sumar(...alicuotas.map((a) => a.importe)).eq(iva)
      ) {
        observaciones.push("[10018] Las alícuotas no suman el neto y el IVA.");
      }
      if (esNotaCredito(s.tipo) !== (s.comprobanteAsociado !== undefined)) {
        observaciones.push("[10197] La nota de crédito exige comprobante asociado (y la factura no lo admite).");
      }
      if (observaciones.length > 0) return { aprobado: false, observaciones };

      const fechaIso = s.fecha.toISOString().slice(0, 10);
      return {
        aprobado: true,
        cae: generarCae(`${s.cuitEmisor}|${s.puntoVenta}|${s.codigoArca}|${s.numero}|${fechaIso}`),
        vencimiento: sumarDias(s.fecha, DIAS_VENCIMIENTO_CAE),
        observaciones: [],
      };
    },

    async consultar(puntoVenta, tipo, numero): Promise<ComprobanteConsultado> {
      const c = await acceso.buscarEmitido(puntoVenta, tipo, numero);
      if (!c) return { encontrado: false };
      return { encontrado: true, cae: c.cae, vencimiento: c.caeVencimiento, fecha: c.fecha, total: c.importeTotal };
    },
  };
}
