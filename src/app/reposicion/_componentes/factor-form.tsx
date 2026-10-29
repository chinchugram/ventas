"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { guardarFactorReposicion } from "@/app/reposicion/actions";
import { AvisoDemo, BloqueError, BloqueExito, BotonEnviar, CampoDecimal, useAccion } from "@/components/form";
import { validarFactor } from "@/lib/reposicion";

/** Hasta cuantas veces el minimo se sugiere comprar. Al guardar, la lista se recalcula. */
export function FactorForm({ inicial, esModoDemo }: { inicial: string; esModoDemo: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(guardarFactorReposicion);
  const [factor, setFactor] = useState(inicial.replace(".", ","));
  const [exito, setExito] = useState<string | null>(null);

  // Error en vivo: el servidor vuelve a validar al guardar.
  const errorFactor = factor.trim() ? validarFactor(factor) : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setExito(null);
        enviar({ factor }, () => {
          setExito("Factor guardado: la lista ya usa el nuevo valor.");
          router.refresh();
        });
      }}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <AvisoDemo visible={esModoDemo} que="los cambios" />
      <div className="flex items-end gap-3">
        <CampoDecimal
          etiqueta="Reponer hasta"
          sufijo="× mínimo"
          valor={factor}
          alCambiar={(v) => {
            setExito(null);
            setFactor(v);
          }}
          className="min-w-0 flex-1 sm:max-w-xs"
          required
        />
        <BotonEnviar
          pendiente={pendiente}
          texto="Guardar"
          disabled={!!errorFactor}
          className="w-auto! shrink-0 px-5"
        />
      </div>
      {errorFactor ? (
        <p className="text-xs text-red-700">{errorFactor}</p>
      ) : (
        <p className="text-xs text-slate-500">
          Con 2 se sugiere comprar hasta el doble del mínimo; con 1, justo hasta el mínimo. De 1 a 10.
        </p>
      )}
      <BloqueError mensaje={error} />
      <BloqueExito mensaje={exito} />
    </form>
  );
}
