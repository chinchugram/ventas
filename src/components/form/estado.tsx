"use client";

import { useState, useTransition } from "react";
import type { Resultado } from "@/lib/acciones";
import { claseBoton } from "@/components/ui";

/** Error general del formulario (el que devuelve la server action). */
export function BloqueError({ mensaje }: { mensaje: string | null | undefined }) {
  if (!mensaje) return null;
  return (
    <p role="alert" className="borde animate-sacudir rounded-md border-critico-line bg-critico-soft p-3 text-body-sm font-semibold text-critico-text">
      {mensaje}
    </p>
  );
}

/** Confirmacion breve despues de guardar. */
export function BloqueExito({ mensaje }: { mensaje: string | null | undefined }) {
  if (!mensaje) return null;
  return (
    <p role="status" className="borde animate-entrada rounded-md border-ok-line bg-ok-soft p-3 text-body-sm font-semibold text-ok-text">
      {mensaje}
    </p>
  );
}

/** Aviso de modo demostracion: sin base, el formulario no guarda. */
export function AvisoDemo({ visible, que = "los cambios" }: { visible: boolean; que?: string }) {
  if (!visible) return null;
  return (
    <p className="borde rounded-md border-aviso-line bg-aviso-soft p-3 text-body-sm text-ink">
      <span className="font-bold text-aviso-text">Modo demostración.</span> Sin base de datos conectada, {que} no se guardan.
    </p>
  );
}

/**
 * Botón de envío (botón sticker, ancho completo): se deshabilita, queda apretado y cambia el texto
 * mientras guarda. Variantes: `principal` y `marca` son el primario de la marca (mandarina; el
 * primario es uno solo en todos los productos), `peligro` es el de anular o borrar.
 */
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
  return (
    <button
      type="submit"
      disabled={pendiente || disabled}
      aria-busy={pendiente || undefined}
      className={claseBoton({ variante: variante === "peligro" ? "peligro" : "primario", ancho: true }) + ` ${className ?? ""}`}
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
