"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { COOKIE_MODO, type Modo } from "@/lib/modo";

const OPCIONES: { valor: Modo; etiqueta: string }[] = [
  { valor: "simple", etiqueta: "Simple" },
  { valor: "avanzado", etiqueta: "Avanzado" },
];

/**
 * Selector Simple / Avanzado del encabezado. Guarda la elección en una cookie de este navegador
 * (un año) y vuelve a pintar la pantalla con el menú del modo elegido.
 */
export function InterruptorModo({ modo }: { modo: Modo }) {
  const router = useRouter();
  const [cambiando, startTransition] = useTransition();

  function elegir(valor: Modo) {
    if (valor === modo) return;
    document.cookie = `${COOKIE_MODO}=${valor}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="radiogroup"
      aria-label="Modo de la app"
      className={`borde inline-flex min-h-11 items-center rounded-full border-line-strong bg-surface p-1 ${cambiando ? "opacity-70" : ""}`}
    >
      {OPCIONES.map((o) => {
        const activo = o.valor === modo;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => elegir(o.valor)}
            className={`min-h-9 rounded-full px-2.5 text-label font-bold transition-colors ${
              activo ? "bg-brand text-on-color" : "text-ink-muted hover:text-ink"
            }`}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
