"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ajustarStock } from "@/app/materiales/[id]/actions";
import { BloqueError, BotonEnviar, CampoDecimal, CampoTexto, NotaObligatorio, useAccion } from "@/components/form";
import { TituloBloque } from "@/components/ui";

export function AjusteStockForm({ materialId, unidad }: { materialId: string; unidad: string }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(ajustarStock, { gravedad: "datos" });
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
      className="tarjeta space-y-3 p-4 sm:p-6"
    >
      <TituloBloque className="mb-0">Ajustar por conteo</TituloBloque>
      <NotaObligatorio />
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
