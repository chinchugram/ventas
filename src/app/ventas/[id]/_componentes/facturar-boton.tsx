"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { emitirFactura, type ResultadoEmision } from "@/app/comprobantes/actions";
import { BloqueError, useAccion } from "@/components/form";
import { Aviso, Boton } from "@/components/ui";

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
        <Boton
          ancho
          disabled={pendiente}
          aria-busy={pendiente || undefined}
          onClick={() => {
            const que = tipoPrevisto ? `una ${tipoPrevisto}` : "la factura";
            if (!window.confirm(`¿Emitir ${que} de esta venta? Una vez emitida no se puede borrar: solo se anula con una nota de crédito.`)) return;
            setResultado(null);
            enviar({ ventaId }, (r) => {
              setResultado(r);
              router.refresh();
            });
          }}
        >
          {pendiente ? "Emitiendo…" : texto}
        </Boton>
      ) : null}

      <div className="mt-2 space-y-2">
        <BloqueError mensaje={error} />
        {resultado ? (
          <Aviso tono={exito ? "ok" : resultado.estado === "RECHAZADO" ? "critico" : "aviso"} role="status">
            {resultado.mensaje}
          </Aviso>
        ) : null}
        {resultado && resultado.advertencias.length > 0 ? (
          <Aviso tono="aviso" role="status">
            <ul className="space-y-1">
              {resultado.advertencias.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Aviso>
        ) : null}
      </div>
    </div>
  );
}
