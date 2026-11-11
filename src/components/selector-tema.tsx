"use client";

import { useState } from "react";
import { COOKIE_TEMA, type Tema } from "@/lib/tema";

const OPCIONES: { valor: Tema; etiqueta: string }[] = [
  { valor: "sistema", etiqueta: "Igual que el sistema" },
  { valor: "claro", etiqueta: "Claro" },
  { valor: "oscuro", etiqueta: "Oscuro" },
];

/** Tema de colores de este navegador. Se aplica al instante y queda guardado en una cookie (un año). */
export function SelectorTema({ inicial }: { inicial: Tema }) {
  const [tema, setTema] = useState<Tema>(inicial);

  function elegir(valor: Tema) {
    setTema(valor);
    document.cookie = `${COOKIE_TEMA}=${valor}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    if (valor === "sistema") delete document.documentElement.dataset.tema;
    else document.documentElement.dataset.tema = valor;
  }

  return (
    <div role="radiogroup" aria-labelledby="titulo-tema" className="flex flex-wrap gap-2">
      {OPCIONES.map((o) => {
        const activo = o.valor === tema;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => elegir(o.valor)}
            className={`borde inline-flex min-h-11 items-center rounded-full px-4 text-label font-bold transition-colors ${
              activo ? "border-brand bg-brand text-on-color" : "border-line-strong text-ink-muted hover:text-ink"
            }`}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
