"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolverComprobantePendiente } from "@/app/comprobantes/actions";
import { BloqueError, useAccion } from "@/components/form";

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
      <button
        type="button"
        disabled={pendiente}
        onClick={() => {
          setMensaje(null);
          enviar({ comprobanteId }, (r) => {
            setMensaje(r.mensaje);
            router.refresh();
          });
        }}
        className="min-h-11 w-full rounded-lg border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-900 transition-transform active:scale-[0.98] disabled:opacity-60 sm:w-auto"
      >
        {pendiente ? "Consultando…" : "Consultar y resolver"}
      </button>
      <div className="mt-2 space-y-2">
        <BloqueError mensaje={error} />
        {mensaje ? (
          <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-800">
            {mensaje}
          </p>
        ) : null}
      </div>
    </div>
  );
}
