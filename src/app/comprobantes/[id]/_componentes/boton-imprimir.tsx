"use client";

import { Boton } from "@/components/ui";

/** Abre el diálogo de impresión del navegador ("Guardar como PDF" genera el PDF). */
export function BotonImprimir() {
  return <Boton onClick={() => window.print()}>Imprimir / Guardar como PDF</Boton>;
}
