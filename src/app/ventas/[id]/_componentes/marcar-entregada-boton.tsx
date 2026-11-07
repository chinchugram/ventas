"use client";

import { useRouter } from "next/navigation";
import { marcarEntregada } from "@/app/ventas/[id]/actions";
import { BloqueError, useAccion } from "@/components/form";
import { Boton } from "@/components/ui";

/** PENDIENTE → ENTREGADA. No depende del cobro: puede entregarse y seguir debiendo. */
export function MarcarEntregadaBoton({ ventaId, debe }: { ventaId: string; debe: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(marcarEntregada);

  return (
    <div>
      <Boton
        variante="secundario"
        ancho
        disabled={pendiente}
        aria-busy={pendiente || undefined}
        onClick={() => {
          const texto = debe
            ? "¿Marcar la venta como entregada? Todavía tiene saldo: se va a seguir viendo en Cobranzas."
            : "¿Marcar la venta como entregada?";
          if (!window.confirm(texto)) return;
          enviar({ ventaId }, () => router.refresh());
        }}
      >
        {pendiente ? "Guardando…" : "Marcar como entregada"}
      </Boton>
      <div className="mt-2">
        <BloqueError mensaje={error} />
      </div>
    </div>
  );
}
