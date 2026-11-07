"use client";

import { useState } from "react";
import { BloqueError } from "@/components/form";
import { Boton } from "@/components/ui";

/**
 * Dar de baja o reactivar algo (artículo, material, lista de precios, cliente). La baja es lógica: no
 * se borra nada. Pide confirmación en el lugar, sin `confirm()` del navegador (en el celular es feo y
 * se descarta solo). Las dos acciones las pone quien lo usa; esta pieza solo arma los botones.
 *
 *   <BajaReactivar activo={activo} pendiente={pendiente} error={error}
 *     textoReactivar="Reactivar artículo" onBaja={() => cambiar(false)} onReactivar={() => cambiar(true)} />
 */
export function BajaReactivar({
  activo,
  pendiente,
  error,
  textoBaja = "Dar de baja",
  textoReactivar,
  onBaja,
  onReactivar,
}: {
  activo: boolean;
  pendiente: boolean;
  error: string | null;
  textoBaja?: string;
  textoReactivar: string;
  onBaja: () => void;
  onReactivar: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);

  if (!activo) {
    return (
      <div className="space-y-2">
        <Boton
          ancho
          onClick={() => {
            // Al reactivar, la próxima baja vuelve a pedir confirmación.
            setConfirmando(false);
            onReactivar();
          }}
          disabled={pendiente}
          aria-busy={pendiente || undefined}
        >
          {pendiente ? "Reactivando…" : textoReactivar}
        </Boton>
        <BloqueError mensaje={error} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {confirmando ? (
        <div className="grid grid-cols-2 gap-3">
          <Boton variante="secundario" onClick={() => setConfirmando(false)} disabled={pendiente}>
            Cancelar
          </Boton>
          <Boton
            variante="peligro"
            onClick={onBaja}
            disabled={pendiente}
            aria-busy={pendiente || undefined}
          >
            {pendiente ? "Dando de baja…" : `Sí, ${textoBaja.toLowerCase()}`}
          </Boton>
        </div>
      ) : (
        <Boton variante="peligro" ancho onClick={() => setConfirmando(true)}>
          {textoBaja}
        </Boton>
      )}
      <BloqueError mensaje={error} />
    </div>
  );
}
