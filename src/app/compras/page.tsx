import Link from "next/link";
import { fmtFecha, fmtMonedaCorta, fmtNumero } from "@/lib/money";
import { getCompras } from "@/lib/queries/compras";
import { Seccion, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ComprasPage() {
  const compras = await getCompras();

  return (
    <>
      <Seccion
        titulo="Compras"
        descripcion="Lo que entra al taller, a quién y a qué costo"
        accion={
          <Link href="/compras/nueva" className="inline-flex min-h-11 items-center rounded-lg bg-marca px-3 text-sm font-semibold text-tinta">
            Nueva compra
          </Link>
        }
      />

      {compras.length === 0 ? (
        <Vacio
          mensaje="Todavía no hay compras registradas"
          hint="Cada compra suma stock y deja el precio pagado, para que el costo no dependa de la memoria."
        />
      ) : (
        <ul className="space-y-2">
          {compras.map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{c.proveedor}</p>
                  <p className="text-sm text-slate-500">
                    {fmtFecha(c.fecha)}
                    {c.comprobante ? ` · ${c.comprobante}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums text-slate-900">{fmtMonedaCorta(c.total)}</p>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {c.items.map((i, idx) => (
                  <li key={idx} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{i.material}</span>
                    <span className="shrink-0 tabular-nums">
                      {fmtNumero(i.cantidad)} {i.unidad}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
