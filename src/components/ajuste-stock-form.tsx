"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ajustarStock } from "@/app/materiales/[id]/actions";
import { BloqueError, BotonEnviar, CampoDecimal, CampoTexto, useAccion } from "@/components/form";

export function AjusteStockForm({ materialId, unidad }: { materialId: string; unidad: string }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(ajustarStock);
  const [stockContado, setStockContado] = useState("");
  const [motivo, setMotivo] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ materialId, stockContado, motivo }, () => {
          setStockContado("");
          setMotivo("");
          router.refresh();
        });
      }}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-slate-900">Ajustar por conteo</h2>
      <CampoDecimal etiqueta="Stock contado" sufijo={unidad} valor={stockContado} alCambiar={setStockContado} required />
      <CampoTexto
        etiqueta="Motivo"
        valor={motivo}
        alCambiar={setMotivo}
        placeholder="Conteo mensual, rotura, merma…"
        required
      />
      <BloqueError mensaje={error} />
      <BotonEnviar pendiente={pendiente} texto="Registrar ajuste" />
    </form>
  );
}
