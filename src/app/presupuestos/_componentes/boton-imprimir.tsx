"use client";

import { Boton } from "@/components/ui";

export function BotonImprimir() {
  return (
    <Boton variante="secundario" onClick={() => window.print()}>
      Imprimir / guardar PDF
    </Boton>
  );
}
