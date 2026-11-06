// Marca "SIN VALIDEZ FISCAL" (contrato de la ola 5): todo comprobante con
// `ambiente` distinto de PRODUCCION la lleva, en pantalla, en la vista
// imprimible y en el PDF. Va como franja con texto (se lee aunque se pierda el
// color) y, en la vista imprimible, como sello diagonal repetido en cada hoja.

import type { ComprobanteCompleto } from "@/lib/queries/comprobante";

export function sinValidezFiscal(ambiente: ComprobanteCompleto["ambiente"]): boolean {
  return ambiente !== "PRODUCCION";
}

const MOTIVO = {
  SIMULADO: "Comprobante simulado: no fue autorizado por ARCA",
  HOMOLOGACION: "Comprobante de homologación (pruebas): no tiene validez fiscal",
  PRODUCCION: "",
} as const;

const EXACTO = "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]";

/** Franja grande y legible. `className` para márgenes. */
export function FranjaSinValidez({ ambiente, className = "" }: { ambiente: ComprobanteCompleto["ambiente"]; className?: string }) {
  if (!sinValidezFiscal(ambiente)) return null;
  return (
    <div
      role="note"
      data-sin-validez="franja"
      className={`${EXACTO} border-4 border-red-600 bg-red-600 px-3 py-2 text-center text-white ${className}`}
    >
      <p className="text-xl font-black tracking-widest uppercase sm:text-2xl">Sin validez fiscal</p>
      <p className="text-xs font-semibold sm:text-sm">{MOTIVO[ambiente]}</p>
    </div>
  );
}

/**
 * Sello diagonal repetido sobre el comprobante. Dentro de un contenedor
 * `relative`; al imprimir pasa a `position: fixed` (ver el <style> de la
 * página imprimible) y se repite en cada hoja.
 */
export function SelloSinValidez({ ambiente, textos = ["Sin validez", "fiscal"] }: { ambiente: ComprobanteCompleto["ambiente"]; textos?: string[] }) {
  if (!sinValidezFiscal(ambiente)) return null;
  return (
    <div
      aria-hidden="true"
      data-sin-validez="sello"
      className="sello-sin-validez pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-around overflow-hidden select-none"
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`${EXACTO} -rotate-[28deg] rounded-lg border-4 border-red-600/25 px-4 py-1 text-center text-4xl leading-tight font-black tracking-widest whitespace-nowrap text-red-600/25 uppercase sm:text-6xl`}
        >
          {textos.map((t) => (
            <span key={t} className="block">
              {t}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
