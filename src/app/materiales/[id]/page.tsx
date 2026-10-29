import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { getMateriales } from "@/lib/queries/materiales";
import { getMovimientos } from "@/lib/queries/compras";
import { AjusteStockForm } from "@/components/ajuste-stock-form";
import { Seccion, Tarjeta, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

const TEXTO_TIPO = { COMPRA: "Compra", VENTA: "Venta", AJUSTE: "Ajuste" } as const;

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = (await getMateriales()).find((m) => m.id === id);
  if (!material) notFound();

  const movimientos = await getMovimientos(id);

  return (
    <>
      <Seccion
        titulo={material.nombre}
        descripcion="Movimientos de stock"
        accion={
          <div className="flex gap-2">
            <Link
              href={`/materiales/${material.id}/editar`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Editar
            </Link>
            <Link
              href="/materiales"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Volver
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Stock" valor={`${fmtNumero(material.stockActual)} ${material.unidad}`} />
        <Tarjeta titulo="Costo unitario" valor={fmtMoneda(material.costoUnitario)} />
      </div>

      <div className="mb-4">
        <AjusteStockForm materialId={material.id} unidad={material.unidad} />
      </div>

      {movimientos.length === 0 ? (
        <Vacio mensaje="Sin movimientos todavía" hint="Las compras y los ajustes quedan registrados acá." />
      ) : (
        <ul className="space-y-2">
          {movimientos.map((m) => {
            const entra = m.cantidad.cmp(0) > 0;
            return (
              <li key={m.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{TEXTO_TIPO[m.tipo]}</p>
                    <p className="text-sm text-slate-500">
                      {fmtFecha(m.fecha)}
                      {m.motivo ? ` · ${m.motivo}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`font-semibold tabular-nums ${entra ? "text-emerald-700" : "text-red-700"}`}>
                      {entra ? "+" : ""}
                      {fmtNumero(m.cantidad)} {material.unidad}
                    </p>
                    <p className="text-xs text-slate-500">saldo {fmtNumero(m.stockResultante)}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
