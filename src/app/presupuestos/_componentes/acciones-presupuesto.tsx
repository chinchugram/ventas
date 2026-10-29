"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BloqueError, useAccion } from "@/components/form";
import { anularPresupuesto, convertirPresupuesto, duplicarPresupuesto } from "../actions";

type Conversion = { ventaId: string; numero: number; anio: number; advertencias: string[] };

const BOTON_SECUNDARIO =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-60";

/**
 * Acciones del detalle. Se queda montado despues de convertir (la pagina se
 * refresca por arriba) para poder mostrar el link a la venta y las
 * advertencias de stock que devuelve la conversion.
 */
export function AccionesPresupuesto({
  id,
  puedeEditar,
  puedeDuplicar,
  puedeConvertir,
  puedeAnular,
  vencido,
}: {
  id: string;
  puedeEditar: boolean;
  puedeDuplicar: boolean;
  puedeConvertir: boolean;
  puedeAnular: boolean;
  vencido: boolean;
}) {
  const router = useRouter();
  const conversion = useAccion(convertirPresupuesto);
  const duplicado = useAccion(duplicarPresupuesto);
  const anulacion = useAccion(anularPresupuesto);
  const [convertido, setConvertido] = useState<Conversion | null>(null);
  const [confirmandoAnular, setConfirmandoAnular] = useState(false);
  const ocupado = conversion.pendiente || duplicado.pendiente || anulacion.pendiente;

  const error = conversion.error ?? duplicado.error ?? anulacion.error;

  return (
    <div className="space-y-3">
      {convertido ? (
        <div role="status" className="space-y-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">
            Listo: se creó la venta #{convertido.numero}/{convertido.anio} (pendiente de entrega y sin cobrar).
          </p>
          {convertido.advertencias.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-amber-900">
              {convertido.advertencias.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}
          <Link href={`/ventas/${convertido.ventaId}`} className="inline-flex min-h-11 items-center font-semibold underline">
            Ver la venta
          </Link>
        </div>
      ) : null}

      {puedeConvertir ? (
        <button
          type="button"
          disabled={ocupado}
          aria-busy={conversion.pendiente || undefined}
          onClick={() =>
            conversion.enviar({ id }, (r) => {
              setConvertido({ ventaId: r.ventaId, numero: r.numero, anio: r.anio, advertencias: r.advertencias });
              router.refresh();
            })
          }
          className="min-h-12 w-full rounded-lg bg-marca py-3 font-semibold text-tinta transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {conversion.pendiente ? "Convirtiendo…" : "Convertir en venta"}
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {puedeEditar ? (
          <Link href={`/presupuestos/${id}/editar`} className={BOTON_SECUNDARIO}>
            Editar
          </Link>
        ) : null}
        {puedeDuplicar ? (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => duplicado.enviar({ id }, (r) => router.push(`/presupuestos/${r.id}`))}
            className={`${BOTON_SECUNDARIO} ${vencido ? "col-span-2 border-marca bg-marca-claro text-marca-texto" : ""}`}
          >
            {duplicado.pendiente ? "Duplicando…" : "Duplicar con precios de hoy"}
          </button>
        ) : null}
      </div>

      {puedeAnular ? (
        confirmandoAnular ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmandoAnular(false)} disabled={ocupado} className={BOTON_SECUNDARIO}>
              No anular
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => anulacion.enviar({ id }, () => router.refresh())}
              className="min-h-12 rounded-lg bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {anulacion.pendiente ? "Anulando…" : "Sí, anular"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => setConfirmandoAnular(true)}
            className="min-h-12 w-full rounded-lg border border-red-300 bg-white text-sm font-semibold text-red-700 disabled:opacity-60"
          >
            Anular presupuesto
          </button>
        )
      ) : null}

      <BloqueError mensaje={error} />
    </div>
  );
}
