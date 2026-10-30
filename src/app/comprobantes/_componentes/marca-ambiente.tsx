import { ETIQUETA_AMBIENTE, MARCA_SIN_VALIDEZ_FISCAL, sinValidezFiscal, type AmbienteComprobante } from "@/lib/facturacion";

/**
 * Ambiente del comprobante. Todo lo que no es de PRODUCCION lleva la marca
 * "SIN VALIDEZ FISCAL" bien visible (contrato de la ola 5): el simulador no
 * autoriza nada de verdad.
 */
export function MarcaAmbiente({ ambiente }: { ambiente: AmbienteComprobante }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{ETIQUETA_AMBIENTE[ambiente]}</span>
      {sinValidezFiscal(ambiente) ? (
        <span className="rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-bold tracking-wide text-red-700">
          {MARCA_SIN_VALIDEZ_FISCAL}
        </span>
      ) : null}
    </span>
  );
}
