"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ajustarStockDeTrabajo } from "@/app/produccion/actions";
import { BloqueError, BloqueExito, BotonEnviar, CampoCheckbox, useAccion } from "@/components/form";

/**
 * Ajuste de stock por la diferencia contra la receta, DESPUES de cargar el trabajo.
 * Solo se monta para quien puede `ajustarStock` (el dueño). Pide marcar la casilla y
 * confirmar: nada se ajusta por defecto.
 */
export function AjustarStockForm({ trabajoId }: { trabajoId: string }) {
  const router = useRouter();
  const [confirmar, setConfirmar] = useState(false);
  const [listo, setListo] = useState(false);
  const { pendiente, error, enviar } = useAccion(ajustarStockDeTrabajo);

  return (
    <form
      aria-label="Ajustar stock"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm("¿Ajustar el stock por la diferencia contra la receta? Queda registrado en el libro de movimientos.")) return;
        setListo(false);
        enviar({ trabajoId, confirmar: confirmar as true }, () => {
          setListo(true);
          setConfirmar(false);
          router.refresh();
        });
      }}
      className="space-y-3"
    >
      <CampoCheckbox
        marcado={confirmar}
        alCambiar={setConfirmar}
        etiqueta="Confirmo que quiero ajustar el stock por la diferencia"
        ayuda="Se registra un movimiento de ajuste por cada material con diferencia. No se descuenta dos veces."
      />
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={listo && !error ? "Stock ajustado." : null} />
      <BotonEnviar pendiente={pendiente} disabled={!confirmar} texto="Ajustar stock" textoPendiente="Ajustando…" />
    </form>
  );
}
