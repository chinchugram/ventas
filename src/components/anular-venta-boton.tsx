"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anularVenta } from "@/app/ventas/[id]/actions";
import { BloqueError } from "@/components/form";
import { Boton } from "@/components/ui";

export function AnularVentaBoton({ ventaId }: { ventaId: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Boton
        variante="peligro"
        ancho
        disabled={pendiente}
        aria-busy={pendiente || undefined}
        onClick={() => {
          if (!window.confirm("¿Anular esta venta? El stock descontado vuelve a los materiales.")) return;
          setError(null);
          iniciar(async () => {
            const r = await anularVenta({ ventaId });
            if (r.ok) router.refresh();
            else setError(r.error);
          });
        }}
      >
        {pendiente ? "Anulando…" : "Anular venta"}
      </Boton>
      <BloqueError mensaje={error} />
    </div>
  );
}
