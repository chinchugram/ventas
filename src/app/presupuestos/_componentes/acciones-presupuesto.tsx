"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BloqueError, useAccion } from "@/components/form";
import { Aviso, Boton } from "@/components/ui";
import { anularPresupuesto, convertirPresupuesto, duplicarPresupuesto } from "../actions";

type Conversion = { ventaId: string; numero: number; anio: number; advertencias: string[] };

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
        <Aviso tono="ok" titulo={`Listo, se creó la venta #${convertido.numero}/${convertido.anio}.`} role="status">
          <p>Quedó pendiente de entrega y sin cobrar.</p>
          {convertido.advertencias.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {convertido.advertencias.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}
          <Link href={`/ventas/${convertido.ventaId}`} className="enlace inline-flex min-h-11 items-center">
            Ver la venta
          </Link>
        </Aviso>
      ) : null}

      {puedeConvertir ? (
        <Boton
          ancho
          disabled={ocupado}
          aria-busy={conversion.pendiente || undefined}
          onClick={() =>
            conversion.enviar({ id }, (r) => {
              setConvertido({ ventaId: r.ventaId, numero: r.numero, anio: r.anio, advertencias: r.advertencias });
              router.refresh();
            })
          }
        >
          {conversion.pendiente ? "Convirtiendo…" : "Convertir en venta"}
        </Boton>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        {puedeEditar ? (
          <Boton href={`/presupuestos/${id}/editar`} variante="secundario">
            Editar
          </Boton>
        ) : null}
        {puedeDuplicar ? (
          <Boton
            variante={vencido ? "primario" : "secundario"}
            disabled={ocupado}
            aria-busy={duplicado.pendiente || undefined}
            onClick={() => duplicado.enviar({ id }, (r) => router.push(`/presupuestos/${r.id}`))}
            className={vencido ? "col-span-2" : ""}
          >
            {duplicado.pendiente ? "Duplicando…" : "Duplicar con precios de hoy"}
          </Boton>
        ) : null}
      </div>

      {puedeAnular ? (
        confirmandoAnular ? (
          <div className="grid grid-cols-2 gap-3">
            <Boton variante="secundario" onClick={() => setConfirmandoAnular(false)} disabled={ocupado}>
              No anular
            </Boton>
            <Boton
              variante="peligro"
              disabled={ocupado}
              aria-busy={anulacion.pendiente || undefined}
              onClick={() => anulacion.enviar({ id }, () => router.refresh())}
            >
              {anulacion.pendiente ? "Anulando…" : "Sí, anular"}
            </Boton>
          </div>
        ) : (
          <Boton variante="peligro" ancho disabled={ocupado} onClick={() => setConfirmandoAnular(true)}>
            Anular presupuesto
          </Boton>
        )
      ) : null}

      <BloqueError mensaje={error} />
    </div>
  );
}
