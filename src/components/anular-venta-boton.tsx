"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anularVenta } from "@/app/ventas/[id]/actions";

export function AnularVentaBoton({ ventaId }: { ventaId: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          if (!window.confirm("¿Anular esta venta? El stock descontado vuelve a los materiales.")) return;
          setError(null);
          iniciar(async () => {
            const r = await anularVenta({ ventaId });
            if (r.ok) router.refresh();
            else setError(r.error);
          });
        }}
        className="w-full rounded-lg border border-red-300 bg-white py-3 text-sm font-semibold text-red-700 disabled:opacity-60"
      >
        {pendiente ? "Anulando…" : "Anular venta"}
      </button>
      {error ? <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
