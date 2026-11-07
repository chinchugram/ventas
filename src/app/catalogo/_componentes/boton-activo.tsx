"use client";

import { useRouter } from "next/navigation";
import { cambiarActivoArticulo } from "@/app/catalogo/actions";
import { useAccion } from "@/components/form";
import { BajaReactivar } from "@/components/baja-reactivar";
import { Panel, TituloBloque } from "@/components/ui";

/**
 * Baja logica o reactivacion de un articulo. La baja pide confirmacion en el lugar.
 */
export function BotonActivoArticulo({ id, activo }: { id: string; activo: boolean }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoArticulo);

  const cambiar = (nuevo: boolean) => enviar({ id, activo: nuevo }, () => router.refresh());

  const boton = (
    <BajaReactivar
      activo={activo}
      pendiente={pendiente}
      error={error}
      textoReactivar="Reactivar artículo"
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
          Deja de aparecer en el catálogo y en las ventas nuevas. Las ventas ya hechas no cambian y se puede
          reactivar cuando quieras.
        </p>
      </div>
      {boton}
    </Panel>
  );
}
