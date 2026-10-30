"use client";

/** Abre el diálogo de impresión del navegador ("Guardar como PDF" genera el PDF). */
export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-marca px-4 text-sm font-semibold text-tinta active:opacity-80"
    >
      Imprimir / Guardar como PDF
    </button>
  );
}
