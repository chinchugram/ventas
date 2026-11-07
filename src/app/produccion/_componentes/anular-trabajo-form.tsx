"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { anularTrabajo } from "@/app/produccion/actions";
import { BloqueError, BotonEnviar, CampoTexto, useAccion } from "@/components/form";
import { Boton, Panel, TituloBloque } from "@/components/ui";

/**
 * Anular un trabajo cargado por error o mal medido: queda de historial con el motivo y
 * la linea vuelve a quedar sin cargar, lista para cargarla de nuevo. No toca el stock.
 * El formulario abierto ya es la confirmación (hay que escribir el motivo y apretar "Anular").
 */
export function AnularTrabajoForm({ trabajoId }: { trabajoId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { pendiente, error, enviar } = useAccion(anularTrabajo);

  if (!abierto) {
    return (
      <Boton variante="peligro" ancho onClick={() => setAbierto(true)}>
        Anular para corregir
      </Boton>
    );
  }

  return (
    <form
      aria-label="Anular trabajo"
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ trabajoId, motivo }, () => router.refresh());
      }}
    >
      <Panel className="space-y-3 border-critico-line bg-critico-soft">
        <TituloBloque className="mb-0 text-critico-text">Anular el trabajo</TituloBloque>
        <p className="text-body-sm text-ink">Queda de historial con el motivo y la línea se puede cargar de nuevo. No toca el stock.</p>
        <CampoTexto etiqueta="Motivo" valor={motivo} alCambiar={setMotivo} maxLength={200} placeholder="Medí mal, se cargó en otra línea…" required />
        <BloqueError mensaje={error} />
        <div className="grid grid-cols-2 gap-3">
          <Boton variante="secundario" onClick={() => setAbierto(false)} disabled={pendiente}>
            Cancelar
          </Boton>
          <BotonEnviar pendiente={pendiente} texto="Anular" textoPendiente="Anulando…" variante="peligro" />
        </div>
      </Panel>
    </form>
  );
}
