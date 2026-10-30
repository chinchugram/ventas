"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { emitirFactura, type ResultadoEmision } from "@/app/comprobantes/actions";
import { BloqueError, useAccion } from "@/components/form";

type Emitida = Extract<ResultadoEmision, { ok: true }>;

/**
 * Boton "Facturar" de la venta. Se queda montado aunque la factura ya haya
 * salido (`visible` pasa a false cuando la pantalla se refresca) para no perder
 * lo que dijo el emisor: el mensaje y las advertencias de la conciliacion.
 */
export function FacturarBoton({
  ventaId,
  visible,
  reintento,
  tipoPrevisto,
}: {
  ventaId: string;
  /** La venta admite pedir una factura y no hay nada que lo impida. */
  visible: boolean;
  /** Ya hubo una factura rechazada: el texto del boton cambia. */
  reintento: boolean;
  /** "Factura B", para el texto de confirmacion. */
  tipoPrevisto: string | null;
}) {
  const router = useRouter();
  const { pendiente, error, enviar } = useAccion(emitirFactura);
  const [resultado, setResultado] = useState<Emitida | null>(null);

  const texto = reintento ? "Reintentar la facturación" : "Facturar";
  const exito = resultado?.estado === "EMITIDO";

  return (
    <div>
      {visible ? (
        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            const que = tipoPrevisto ? `una ${tipoPrevisto}` : "la factura";
            if (!window.confirm(`¿Emitir ${que} de esta venta? Una vez emitida no se puede borrar: solo se anula con una nota de crédito.`)) return;
            setResultado(null);
            enviar({ ventaId }, (r) => {
              setResultado(r);
              router.refresh();
            });
          }}
          className="w-full rounded-lg bg-tinta py-3 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {pendiente ? "Emitiendo…" : texto}
        </button>
      ) : null}

      <div className="mt-2 space-y-2">
        <BloqueError mensaje={error} />
        {resultado ? (
          <p
            role="status"
            className={`rounded-lg p-3 text-sm ${exito ? "bg-emerald-50 text-emerald-800" : resultado.estado === "RECHAZADO" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}
          >
            {resultado.mensaje}
          </p>
        ) : null}
        {resultado && resultado.advertencias.length > 0 ? (
          <ul role="status" className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {resultado.advertencias.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
