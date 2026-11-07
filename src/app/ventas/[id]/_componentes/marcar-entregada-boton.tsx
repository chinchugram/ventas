"use client";

import { useRouter } from "next/navigation";
import { marcarEntregada } from "@/app/ventas/[id]/actions";
import { ConfirmarAccion } from "@/components/confirmar-accion";
import { useAccion } from "@/components/form";

/** PENDIENTE → ENTREGADA. No depende del cobro: puede entregarse y seguir debiendo. */
export function MarcarEntregadaBoton({ ventaId, debe }: { ventaId: string; debe: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(marcarEntregada);

  return (
    <ConfirmarAccion
      texto="Marcar como entregada"
      pregunta="¿Marcar la venta como entregada?"
      textoConfirmar="Sí, entregada"
      textoPendiente="Guardando…"
      variante="primario"
      varianteBoton="secundario"
      pendiente={pendiente}
      error={error}
      onConfirmar={() => enviar({ ventaId }, () => router.refresh())}
    >
      {debe ? "Todavía tiene saldo: se va a seguir viendo en Cobranzas." : null}
    </ConfirmarAccion>
  );
}
