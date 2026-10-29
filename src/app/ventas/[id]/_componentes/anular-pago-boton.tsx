"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { anularPago } from "@/app/ventas/[id]/actions";
import { BloqueError, BotonEnviar, CampoTexto, useAccion } from "@/components/form";

/**
 * Anular un pago pide el motivo: el pago no se borra, queda tachado con ese
 * motivo y la venta vuelve a deber el monto.
 */
export function AnularPagoBoton({ pagoId }: { pagoId: string }) {
  const router = useRouter();
  const { pendiente, error, setError, enviar } = useAccion(anularPago);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex min-h-11 items-center rounded-md px-3 text-xs font-semibold text-red-700 underline-offset-2 hover:underline"
      >
        Anular
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ pagoId, motivo }, () => {
          setAbierto(false);
          setMotivo("");
          router.refresh();
        });
      }}
      className="mt-2 w-full space-y-2 rounded-lg bg-red-50 p-3"
    >
      <CampoTexto
        etiqueta="Motivo de la anulación"
        valor={motivo}
        alCambiar={setMotivo}
        placeholder="Transferencia rechazada, cargado dos veces…"
        maxLength={200}
        autoFocus
        required
      />
      <BloqueError mensaje={error} />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
          className="rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700"
        >
          Cancelar
        </button>
        <BotonEnviar pendiente={pendiente} texto="Anular pago" textoPendiente="Anulando…" variante="peligro" />
      </div>
    </form>
  );
}
