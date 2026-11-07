"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { anularPago } from "@/app/ventas/[id]/actions";
import { BloqueError, BotonEnviar, CampoTexto, NotaObligatorio, useAccion } from "@/components/form";
import { Boton } from "@/components/ui";

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
      <Boton variante="fantasma-peligro" onClick={() => setAbierto(true)}>
        Anular pago
      </Boton>
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
      className="borde mt-2 w-full space-y-3 rounded-md border-critico-line bg-critico-soft p-3"
    >
      <NotaObligatorio />
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
      <div className="grid grid-cols-2 gap-3">
        <Boton
          variante="secundario"
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
        >
          Cancelar
        </Boton>
        <BotonEnviar pendiente={pendiente} texto="Anular pago" textoPendiente="Anulando…" variante="peligro" />
      </div>
    </form>
  );
}
