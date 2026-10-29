"use client";

import { useState, useTransition } from "react";
import type { Resultado } from "@/lib/acciones";

/** Error general del formulario (el que devuelve la server action). */
export function BloqueError({ mensaje }: { mensaje: string | null | undefined }) {
  if (!mensaje) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
      {mensaje}
    </p>
  );
}

/** Confirmacion breve despues de guardar. */
export function BloqueExito({ mensaje }: { mensaje: string | null | undefined }) {
  if (!mensaje) return null;
  return (
    <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
      {mensaje}
    </p>
  );
}

/** Aviso de modo demostracion: sin base, el formulario no guarda. */
export function AvisoDemo({ visible, que = "los cambios" }: { visible: boolean; que?: string }) {
  if (!visible) return null;
  return (
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
      Modo demostración: sin base de datos conectada, {que} no se guardan.
    </p>
  );
}

/** Boton de envio que se deshabilita y cambia el texto mientras guarda. */
export function BotonEnviar({
  pendiente,
  texto,
  textoPendiente = "Guardando…",
  variante = "principal",
  disabled,
  className,
}: {
  pendiente: boolean;
  texto: string;
  textoPendiente?: string;
  variante?: "principal" | "marca" | "peligro";
  disabled?: boolean;
  className?: string;
}) {
  const colores = {
    principal: "bg-tinta text-white",
    marca: "bg-marca text-tinta",
    peligro: "bg-red-600 text-white",
  }[variante];
  return (
    <button
      type="submit"
      disabled={pendiente || disabled}
      aria-busy={pendiente || undefined}
      className={`w-full rounded-lg py-3 font-semibold transition-transform active:scale-[0.98] disabled:opacity-60 ${colores} ${className ?? ""}`}
    >
      {pendiente ? textoPendiente : texto}
    </button>
  );
}

/**
 * Corre una server action que devuelve `{ ok, error }` dentro de una
 * transicion, y guarda el error para mostrarlo con `BloqueError`.
 *
 *   const { pendiente, error, enviar } = useAccion(guardarCliente);
 *   <form onSubmit={(e) => { e.preventDefault(); enviar(datos, () => router.push("/clientes")); }}>
 */
export function useAccion<D, R extends Resultado | { ok: true } | { ok: false; error: string }>(
  accion: (datos: D) => Promise<R>,
) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const enviar = (datos: D, alTerminarBien?: (r: Extract<R, { ok: true }>) => void) => {
    setError(null);
    iniciar(async () => {
      try {
        const r = await accion(datos);
        if (r.ok) alTerminarBien?.(r as Extract<R, { ok: true }>);
        else setError((r as { ok: false; error: string }).error);
      } catch {
        setError("No se pudo conectar con el servidor. Probá de nuevo.");
      }
    });
  };

  return { pendiente, error, setError, enviar };
}
