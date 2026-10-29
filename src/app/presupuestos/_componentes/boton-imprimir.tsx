"use client";

export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-12 items-center justify-center rounded-lg bg-tinta px-4 text-sm font-semibold text-white"
    >
      Imprimir / guardar PDF
    </button>
  );
}
