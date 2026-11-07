import { ETIQUETA_AMBIENTE, MARCA_SIN_VALIDEZ_FISCAL, sinValidezFiscal, type AmbienteComprobante } from "@/lib/facturacion";
import { Etiqueta } from "@/components/ui";

/**
 * Ambiente del comprobante. Todo lo que no es de PRODUCCION lleva la marca
 * "SIN VALIDEZ FISCAL" bien visible (contrato de la ola 5): el simulador no
 * autoriza nada de verdad.
 */
export function MarcaAmbiente({ ambiente }: { ambiente: AmbienteComprobante }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Etiqueta>{ETIQUETA_AMBIENTE[ambiente]}</Etiqueta>
      {sinValidezFiscal(ambiente) ? <Etiqueta tono="critico">{MARCA_SIN_VALIDEZ_FISCAL}</Etiqueta> : null}
    </span>
  );
}
