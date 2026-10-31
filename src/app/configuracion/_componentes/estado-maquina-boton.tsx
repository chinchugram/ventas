"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarActivoMaquina } from "@/app/configuracion/actions";
import { BloqueError, useAccion } from "@/components/form";

/**
 * Dar de baja o reactivar una maquina. La baja no se impide aunque la maquina
 * este en recetas: se avisa antes, porque esas recetas la siguen costeando.
 * La confirmacion es en el lugar (mismo patron que `BotonActivoArticulo`), sin
 * `confirm()` del navegador; el foco pasa a "Cancelar" y vuelve al boton al cancelar.
 */
export function EstadoMaquinaBoton({ id, activo, recetas }: { id: string; activo: boolean; recetas: number }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoMaquina);
  const [confirmando, setConfirmando] = useState(false);
  const idAviso = useId();
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const bajaRef = useRef<HTMLButtonElement>(null);
  // Solo se devuelve el foco al boton si el usuario canceló (no cuando la baja se concreta y el boton cambia).
  const volverAlBoton = useRef(false);

  useEffect(() => {
    if (confirmando) cancelarRef.current?.focus();
    else if (volverAlBoton.current) {
      volverAlBoton.current = false;
      bajaRef.current?.focus();
    }
  }, [confirmando]);

  const confirmacion =
    recetas > 0
      ? `Esta máquina está en ${recetas} ${recetas === 1 ? "receta" : "recetas"}: van a seguir costeándola con su costo/hora. ¿Darla de baja igual?`
      : "¿Dar de baja esta máquina? No va a aparecer para recetas nuevas; podés reactivarla cuando quieras.";

  const cambiar = (nuevo: boolean) =>
    enviar({ id, activo: nuevo }, () => {
      setConfirmando(false);
      router.refresh();
    });

  const cancelar = () => {
    volverAlBoton.current = true;
    setConfirmando(false);
  };

  if (!activo) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled={pendiente}
          onClick={() => cambiar(true)}
          className="w-full rounded-lg border border-emerald-300 bg-white py-3 text-sm font-semibold text-emerald-700 disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : "Reactivar"}
        </button>
        <BloqueError mensaje={error} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {confirmando ? (
        <div
          role="group"
          aria-label="Confirmar la baja de la máquina"
          className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pendiente) cancelar();
          }}
        >
          <p id={idAviso} className="text-sm text-slate-800">
            {confirmacion}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              ref={cancelarRef}
              type="button"
              onClick={cancelar}
              disabled={pendiente}
              aria-describedby={idAviso}
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
        </div>
      ) : (
        <button
          ref={bajaRef}
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
