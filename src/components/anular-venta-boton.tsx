"use client";

import { useRouter } from "next/navigation";
import { anularVenta } from "@/app/ventas/[id]/actions";
import { useAccion } from "@/components/form";
import { ConfirmarAccion } from "@/components/confirmar-accion";

/** Anular una venta: pide confirmación en el lugar (no `window.confirm`) y, si sale bien, refresca el detalle. */
export function AnularVentaBoton({ ventaId }: { ventaId: string }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(anularVenta, { gravedad: "dinero" });

  return (
    <ConfirmarAccion
      texto="Anular venta"
      pregunta="¿Anular esta venta?"
      textoConfirmar="Sí, anular"
      textoPendiente="Anulando…"
      pendiente={pendiente}
      error={error}
      onConfirmar={() => enviar({ ventaId }, () => router.refresh())}
    >
      El stock descontado vuelve a los materiales. La venta queda en el historial como anulada.
    </ConfirmarAccion>
  );
}
