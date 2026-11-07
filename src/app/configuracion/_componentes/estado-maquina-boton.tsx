"use client";

import { useRouter } from "next/navigation";
import { cambiarActivoMaquina } from "@/app/configuracion/actions";
import { BloqueError, useAccion } from "@/components/form";
import { ConfirmarAccion } from "@/components/confirmar-accion";
import { Boton } from "@/components/ui";

/**
 * Dar de baja o reactivar una maquina. La baja no se impide aunque la maquina
 * este en recetas: se avisa antes, porque esas recetas la siguen costeando.
 * La confirmacion es en el lugar (`ConfirmarAccion`), sin `confirm()` del navegador.
 */
export function EstadoMaquinaBoton({ id, activo, recetas }: { id: string; activo: boolean; recetas: number }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoMaquina);

  const cambiar = (nuevo: boolean, alTerminar?: () => void) =>
    enviar({ id, activo: nuevo }, () => {
      alTerminar?.();
      router.refresh();
    });

  if (!activo) {
    return (
      <div className="space-y-2">
        <Boton ancho disabled={pendiente} aria-busy={pendiente || undefined} onClick={() => cambiar(true)}>
          {pendiente ? "Reactivando…" : "Reactivar máquina"}
        </Boton>
        <BloqueError mensaje={error} />
      </div>
    );
  }

  return (
    <ConfirmarAccion
      texto="Dar de baja"
      pregunta="¿Dar de baja esta máquina?"
      textoConfirmar="Sí, dar de baja"
      textoPendiente="Dando de baja…"
      pendiente={pendiente}
      error={error}
      onConfirmar={(cerrar) => cambiar(false, cerrar)}
    >
      {recetas > 0
        ? `Está en ${recetas} ${recetas === 1 ? "receta" : "recetas"}: van a seguir costeándola con su costo/hora.`
        : "No va a aparecer para recetas nuevas; podés reactivarla cuando quieras."}
    </ConfirmarAccion>
  );
}
