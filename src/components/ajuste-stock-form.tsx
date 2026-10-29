"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ajustarStock } from "@/app/materiales/[id]/actions";

export function AjusteStockForm({ materialId, unidad }: { materialId: string; unidad: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stockContado, setStockContado] = useState("");
  const [motivo, setMotivo] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        iniciar(async () => {
          const r = await ajustarStock({ materialId, stockContado, motivo });
          if (r.ok) {
            setStockContado("");
            setMotivo("");
            router.refresh();
          } else setError(r.error);
        });
      }}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">Ajustar por conteo</h2>
      <div>
        <label htmlFor="contado">Stock contado ({unidad})</label>
        <input id="contado" inputMode="decimal" value={stockContado} onChange={(e) => setStockContado(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="motivo">Motivo</label>
        <input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Conteo mensual, rotura, merma…" required />
      </div>
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pendiente}
        className="w-full rounded-lg bg-tinta py-3 font-semibold text-white disabled:opacity-60"
      >
        {pendiente ? "Guardando…" : "Registrar ajuste"}
      </button>
    </form>
  );
}
