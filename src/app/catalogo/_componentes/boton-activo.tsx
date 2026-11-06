"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarActivoArticulo } from "@/app/catalogo/actions";
import { BloqueError, useAccion } from "@/components/form";

/**
 * Baja logica o reactivacion. La baja pide confirmacion en el lugar (sin
 * `confirm()` del navegador, que en el celular es feo y se descarta solo).
 */
export function BotonActivoArticulo({ id, activo }: { id: string; activo: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoArticulo);
  const [confirmando, setConfirmando] = useState(false);

  const cambiar = (nuevo: boolean) =>
    enviar({ id, activo: nuevo }, () => {
      setConfirmando(false);
      router.refresh();
    });

  if (!activo) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => cambiar(true)}
          disabled={pendiente}
          className="w-full rounded-lg bg-tinta py-3 font-semibold text-white disabled:opacity-60"
        >
          {pendiente ? "Reactivando…" : "Reactivar artículo"}
        </button>
        <BloqueError mensaje={error} />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Dar de baja</h2>
        <p className="text-sm text-slate-500">
          Deja de aparecer en el catálogo y en las ventas nuevas. Las ventas ya hechas no cambian y se puede
          reactivar cuando quieras.
        </p>
      </div>
      {confirmando ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setConfirmando(false)}
            disabled={pendiente}
            className="rounded-lg border border-slate-300 bg-white py-3 text-sm font-medium text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => cambiar(false)}
            disabled={pendiente}
            className="rounded-lg bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pendiente ? "Dando de baja…" : "Sí, dar de baja"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="w-full rounded-lg border border-red-300 bg-white py-3 text-sm font-semibold text-red-700"
        >
          Dar de baja
        </button>
      )}
      <BloqueError mensaje={error} />
    </div>
  );
}
