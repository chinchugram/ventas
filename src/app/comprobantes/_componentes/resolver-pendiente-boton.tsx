"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolverComprobantePendiente } from "@/app/comprobantes/actions";
import { BloqueError, useAccion } from "@/components/form";
import { Aviso, Boton } from "@/components/ui";

/**
 * Un comprobante PENDIENTE (el emisor no respondio) se resuelve consultando al
 * emisor: queda EMITIDO si lo autorizo o RECHAZADO si no. Mismo permiso que emitir.
 */
export function ResolverPendienteBoton({ comprobanteId }: { comprobanteId: string }) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(resolverComprobantePendiente);
  const [mensaje, setMensaje] = useState<string | null>(null);

  return (
    <div>
      <Boton
        variante="secundario"
        className="w-full sm:w-auto"
        disabled={pendiente}
        aria-busy={pendiente || undefined}
        onClick={() => {
          setMensaje(null);
          enviar({ comprobanteId }, (r) => {
            setMensaje(r.mensaje);
            router.refresh();
          });
        }}
      >
        {pendiente ? "Consultando…" : "Consultar y resolver"}
      </Boton>
      <div className="mt-2 space-y-2">
        <BloqueError mensaje={error} />
        {mensaje ? (
          <Aviso tono="info" role="status">
            {mensaje}
          </Aviso>
        ) : null}
      </div>
    </div>
  );
}
