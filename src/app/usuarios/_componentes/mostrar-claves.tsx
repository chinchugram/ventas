"use client";

import { useId } from "react";

/**
 * Casilla "Mostrar lo que escribo": en el celular tipear una clave de 10
 * caracteres a ciegas es la forma mas facil de equivocarse. Area tactil de 44 px.
 */
export function MostrarClaves({ marcado, alCambiar }: { marcado: boolean; alCambiar: (marcado: boolean) => void }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="mb-0 flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-normal text-slate-700"
    >
      <input
        id={id}
        type="checkbox"
        checked={marcado}
        onChange={(e) => alCambiar(e.target.checked)}
        className="h-5 w-5 shrink-0"
      />
      Mostrar lo que escribo
    </label>
  );
}
