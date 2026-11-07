"use client";

import { useRouter } from "next/navigation";
import { cambiarActivoCliente } from "@/app/clientes/actions";
import { useAccion } from "@/components/form";
import { BajaReactivar } from "@/components/baja-reactivar";
import { Aviso } from "@/components/ui";

/**
 * Dar de baja o reactivar un cliente. La baja es logica: sus ventas y pagos
 * quedan, y deja de ofrecerse al cargar una venta nueva.
 */
export function BotonActivoCliente({
  id,
  activo,
  tieneSaldo,
}: {
  id: string;
  activo: boolean;
  tieneSaldo: boolean;
}) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(cambiarActivoCliente);

  const cambiar = (nuevo: boolean) => enviar({ id, activo: nuevo }, () => router.refresh());

  return (
    <div className="space-y-3">
      {activo ? (
        <>
          <p className="text-body-sm text-ink-muted">
            No se borra nada: sus ventas y pagos quedan, pero no se va a poder elegir en ventas nuevas.
          </p>
          {tieneSaldo ? <Aviso tono="aviso">Ojo: todavía tiene saldo pendiente.</Aviso> : null}
        </>
      ) : null}
      <BajaReactivar
        activo={activo}
        pendiente={pendiente}
        error={error}
        textoReactivar="Reactivar cliente"
        onBaja={() => cambiar(false)}
        onReactivar={() => cambiar(true)}
      />
    </div>
  );
}
