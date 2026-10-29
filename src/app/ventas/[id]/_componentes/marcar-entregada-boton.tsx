"use client";

import { useRouter } from "next/navigation";
import { marcarEntregada } from "@/app/ventas/[id]/actions";
import { BloqueError, useAccion } from "@/components/form";

/** PENDIENTE → ENTREGADA. No depende del cobro: puede entregarse y seguir debiendo. */
export function MarcarEntregadaBoton({ ventaId, debe }: { ventaId: string; debe: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(marcarEntregada);

  return (
    <div>
      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          const texto = debe
            ? "¿Marcar la venta como entregada? Todavía tiene saldo: se va a seguir viendo en Cobranzas."
            : "¿Marcar la venta como entregada?";
          if (!window.confirm(texto)) return;
          enviar({ ventaId }, () => router.refresh());
        }}
        className="w-full rounded-lg bg-tinta py-3 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {pendiente ? "Guardando…" : "Marcar como entregada"}
      </button>
      <div className="mt-2">
        <BloqueError mensaje={error} />
      </div>
    </div>
  );
}
