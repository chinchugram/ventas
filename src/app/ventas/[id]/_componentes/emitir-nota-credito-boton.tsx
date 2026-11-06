"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { emitirNotaCredito } from "@/app/ventas/[id]/actions";
import { BloqueError, BloqueExito, BotonEnviar, useAccion } from "@/components/form";

/**
 * Emite la nota de crédito TOTAL de la factura de la venta. Deshace una factura
 * fiscal, así que pide una confirmación explícita (no un `window.confirm`): hay
 * que abrir el panel y apretar el botón rojo. Después de emitirla, la venta se
 * puede anular.
 */
export function EmitirNotaCreditoBoton({
  ventaId,
  comprobanteId,
  etiquetaFactura,
}: {
  ventaId: string;
  comprobanteId: string;
  /** Por ejemplo "Factura B 0001-00000007". */
  etiquetaFactura: string;
}) {
  const router = useRouter();
  const { pendiente, error, setError, enviar } = useAccion(emitirNotaCredito);
  const [abierto, setAbierto] = useState(false);
  const [resultado, setResultado] = useState<{ emitida: boolean; mensaje: string } | null>(null);

  if (resultado) {
    // La nota quedó emitida, rechazada o pendiente: se muestra qué pasó. La página se refresca por detrás.
    return resultado.emitida ? (
      <BloqueExito mensaje={resultado.mensaje} />
    ) : (
      <div className="space-y-2">
        <BloqueError mensaje={resultado.mensaje} />
        <button
          type="button"
          onClick={() => setResultado(null)}
          className="w-full rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700"
        >
          Entendido
        </button>
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-full rounded-lg border border-red-300 bg-white py-3 text-sm font-semibold text-red-700"
      >
        Emitir nota de crédito
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar({ ventaId, comprobanteId }, (r) => {
          setAbierto(false);
          setResultado({ emitida: r.estado === "EMITIDO", mensaje: r.mensaje });
          router.refresh();
        });
      }}
      className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3"
    >
      <p className="text-sm font-semibold text-red-800">¿Anular la {etiquetaFactura} con una nota de crédito?</p>
      <p className="text-sm text-red-800">
        Se emite una nota de crédito por el <strong>total</strong> de la factura. Una vez emitida no se puede deshacer; recién
        después podés anular la venta.
      </p>
      <BloqueError mensaje={error} />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            setAbierto(false);
            setError(null);
          }}
          className="rounded-lg border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
        >
          Cancelar
        </button>
        <BotonEnviar pendiente={pendiente} texto="Emitir nota" textoPendiente="Emitiendo…" variante="peligro" />
      </div>
    </form>
  );
}
