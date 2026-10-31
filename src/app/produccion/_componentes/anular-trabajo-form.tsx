"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { anularTrabajo } from "@/app/produccion/actions";
import { BloqueError, BotonEnviar, CampoTexto, useAccion } from "@/components/form";

/**
 * Anular un trabajo cargado por error o mal medido: queda de historial con el motivo y
 * la linea vuelve a quedar sin cargar, lista para cargarla de nuevo. No toca el stock.
 */
export function AnularTrabajoForm({ trabajoId }: { trabajoId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { pendiente, error, enviar } = useAccion(anularTrabajo);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="min-h-11 w-full rounded-lg border border-red-300 bg-white px-3 py-3 text-sm font-semibold text-red-700"
      >
        Anular para corregir
      </button>
    );
  }

  return (
    <form
      aria-label="Anular trabajo"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm("¿Anular este trabajo? Queda de historial y la línea se puede cargar de nuevo.")) return;
        enviar({ trabajoId, motivo }, () => router.refresh());
      }}
      className="space-y-3 rounded-xl border border-red-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">Anular el trabajo</h2>
      <CampoTexto etiqueta="Motivo" valor={motivo} alCambiar={setMotivo} maxLength={200} placeholder="Medí mal, se cargó en otra línea…" required />
      <BloqueError mensaje={error} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setAbierto(false)} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700">
          Cancelar
        </button>
        <BotonEnviar pendiente={pendiente} texto="Anular" textoPendiente="Anulando…" variante="peligro" />
      </div>
    </form>
  );
}
