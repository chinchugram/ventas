"use client";

import { useRouter } from "next/navigation";
import { cambiarActivoMaquina } from "@/app/configuracion/actions";
import { BloqueError, useAccion } from "@/components/form";

/**
 * Dar de baja o reactivar una maquina. La baja no se impide aunque la maquina
 * este en recetas: se avisa antes, porque esas recetas la siguen costeando.
 */
export function EstadoMaquinaBoton({ id, activo, recetas }: { id: string; activo: boolean; recetas: number }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoMaquina);

  const confirmacion =
    recetas > 0
      ? `Esta máquina está en ${recetas} ${recetas === 1 ? "receta" : "recetas"}: van a seguir costeándola con su costo/hora. ¿Darla de baja igual?`
      : "¿Dar de baja esta máquina? No va a aparecer para recetas nuevas; podés reactivarla cuando quieras.";

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          if (activo && !window.confirm(confirmacion)) return;
          enviar({ id, activo: !activo }, () => router.refresh());
        }}
        className={`w-full rounded-lg border bg-white py-3 text-sm font-semibold disabled:opacity-60 ${
          activo ? "border-red-300 text-red-700" : "border-emerald-300 text-emerald-700"
        }`}
      >
        {pendiente ? "Guardando…" : activo ? "Dar de baja" : "Reactivar"}
      </button>
      <BloqueError mensaje={error} />
    </div>
  );
}
