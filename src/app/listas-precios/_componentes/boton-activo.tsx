"use client";

import { useRouter } from "next/navigation";
import { cambiarActivoLista } from "@/app/listas-precios/actions";
import { useAccion } from "@/components/form";
import { BajaReactivar } from "@/components/baja-reactivar";
import { Panel, TituloBloque } from "@/components/ui";

/**
 * Baja logica o reactivacion de una lista. La baja pide confirmacion en el
 * lugar. Una lista de baja no se aplica: sus clientes pagan precio de catalogo.
 */
export function BotonActivoLista({ id, activo, clientes }: { id: string; activo: boolean; clientes: number }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoLista);

  const cambiar = (nuevo: boolean) => enviar({ id, activo: nuevo }, () => router.refresh());

  const boton = (
    <BajaReactivar
      activo={activo}
      pendiente={pendiente}
      error={error}
      textoReactivar="Reactivar lista"
      onBaja={() => cambiar(false)}
      onReactivar={() => cambiar(true)}
    />
  );

  if (!activo) return boton;

  return (
    <Panel className="space-y-3">
      <div>
        <TituloBloque className="mb-1">Dar de baja</TituloBloque>
        <p className="text-body-sm text-ink-muted">
          Mientras esté de baja no se aplica: {clientes > 0 ? `los ${clientes} clientes que la tienen` : "los clientes que la tengan"}{" "}
          pagan el precio de catálogo. No se borra nada y se puede reactivar cuando quieras.
        </p>
      </div>
      {boton}
    </Panel>
  );
}
