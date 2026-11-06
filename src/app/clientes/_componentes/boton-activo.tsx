"use client";

import { useRouter } from "next/navigation";
import { cambiarActivoCliente } from "@/app/clientes/actions";
import { BloqueError, useAccion } from "@/components/form";

/**
 * Dar de baja o reactivar un cliente. La baja es logica: sus ventas y pagos
 * quedan, y deja de ofrecerse al cargar una venta nueva.
 */
export function BotonActivoCliente({
  id,
  activo,
  tieneSaldo,
}: {
  id: string;
  activo: boolean;
  tieneSaldo: boolean;
}) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoCliente);

  const confirmar = activo
    ? `¿Dar de baja este cliente? No se borra nada: sus ventas y pagos quedan, pero no se va a poder elegir en ventas nuevas.${
        tieneSaldo ? "\n\nOjo: todavía tiene saldo pendiente." : ""
      }`
    : null;

  return (
    <div>
      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          if (confirmar && !window.confirm(confirmar)) return;
          enviar({ id, activo: !activo }, () => router.refresh());
        }}
        className={`w-full rounded-lg border bg-white py-3 text-sm font-semibold disabled:opacity-60 ${
          activo ? "border-red-300 text-red-700" : "border-emerald-300 text-emerald-700"
        }`}
      >
        {pendiente ? "Guardando…" : activo ? "Dar de baja" : "Reactivar cliente"}
      </button>
      <div className="mt-2">
        <BloqueError mensaje={error} />
      </div>
    </div>
  );
}
