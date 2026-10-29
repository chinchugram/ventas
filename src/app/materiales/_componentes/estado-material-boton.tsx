"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BloqueError, useAccion } from "@/components/form";
import { cambiarEstadoMaterial } from "../actions";

/**
 * Baja logica o reactivacion, con un paso de confirmacion (en el celular un
 * toque de mas es barato; una baja por error, no tanto).
 */
export function EstadoMaterialBoton({ id, activo }: { id: string; activo: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarEstadoMaterial);
  const [confirmando, setConfirmando] = useState(false);

  const ejecutar = () =>
    enviar({ id, activo: !activo }, () => {
      setConfirmando(false);
      router.push(activo ? "/materiales?bajas=1" : `/materiales/${id}/editar`);
      router.refresh();
    });

  if (!activo) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={ejecutar}
          disabled={pendiente}
          className="w-full rounded-lg bg-tinta py-3 font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? "Reactivando…" : "Reactivar material"}
        </button>
        <BloqueError mensaje={error} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {confirmando ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setConfirmando(false)}
            disabled={pendiente}
            className="rounded-lg border border-slate-300 bg-white py-3 font-medium text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={ejecutar}
            disabled={pendiente}
            className="rounded-lg bg-red-600 py-3 font-semibold text-white disabled:opacity-60"
          >
            {pendiente ? "Dando de baja…" : "Sí, dar de baja"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="w-full rounded-lg border border-red-200 bg-white py-3 font-semibold text-red-700"
        >
          Dar de baja
        </button>
      )}
      <BloqueError mensaje={error} />
    </div>
  );
}
