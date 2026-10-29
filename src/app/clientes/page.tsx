import { fmtFecha, fmtMonedaCorta as fmtMoneda, fmtNumero } from "@/lib/money";
import { getClientes } from "@/lib/queries/clientes";
import { Seccion, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const clientes = await getClientes();

  if (clientes.length === 0) {
    return (
      <>
        <Seccion titulo="Clientes" />
        <Vacio mensaje="No hay clientes cargados" hint="Se cargan al crear la primera venta." />
      </>
    );
  }

  const deudores = clientes.filter((c) => c.saldo.cmp(0) > 0);

  return (
    <>
      <Seccion
        titulo="Clientes"
        descripcion={
          deudores.length > 0
            ? `${deudores.length} con saldo pendiente`
            : "Todos al dia"
        }
      />

      <ul className="space-y-2">
        {clientes.map((c) => (
          <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{c.nombre}</p>
                <p className="text-sm text-slate-500">
                  {c.telefono ?? "sin telefono"}
                  {c.cuit ? ` · ${c.cuit}` : ""}
                </p>
              </div>
              {c.saldo.cmp(0) > 0 ? (
                <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  debe {fmtMoneda(c.saldo)}
                </span>
              ) : (
                <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  al dia
                </span>
              )}
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Ventas</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {fmtNumero(c.ventas)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Facturado</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {fmtMoneda(c.facturado)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Ultima venta</dt>
                <dd className="font-semibold text-slate-900">{fmtFecha(c.ultimaVenta)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
