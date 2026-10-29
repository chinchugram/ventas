import Link from "next/link";
import { fmtFecha, fmtMonedaCorta as fmtMoneda, fmtNumero } from "@/lib/money";
import { formatearCuit } from "@/lib/cuit";
import { getClientes, getClientesDeBaja } from "@/lib/queries/clientes";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { Seccion, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const usuario = await requierePermisoPagina("verClientes");
  const [clientes, bajas] = await Promise.all([getClientes(), getClientesDeBaja()]);

  const deudores = clientes.filter((c) => c.saldo.cmp(0) > 0);
  const botonNuevo = (
    <Link href="/clientes/nuevo" className="inline-flex min-h-11 items-center rounded-lg bg-marca px-3 text-sm font-semibold text-tinta">
      Nuevo cliente
    </Link>
  );

  return (
    <>
      <Seccion
        titulo="Clientes"
        descripcion={
          clientes.length === 0
            ? undefined
            : deudores.length > 0
              ? `${deudores.length} con saldo pendiente`
              : "Todos al día"
        }
        accion={puede(usuario, "editarClientes") ? botonNuevo : undefined}
      />

      {clientes.length === 0 ? (
        <Vacio mensaje="No hay clientes cargados" hint="Cargá el primero con «Nuevo cliente»." />
      ) : (
        <ul className="space-y-2">
          {clientes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clientes/${c.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{c.nombre}</p>
                    <p className="text-sm text-slate-500">
                      {c.telefono ?? "sin teléfono"}
                      {c.cuit ? (
                        <>
                          {" · "}
                          <span className="whitespace-nowrap">{formatearCuit(c.cuit)}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {c.saldo.cmp(0) > 0 ? (
                    <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      debe {fmtMoneda(c.saldo)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      al día
                    </span>
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Ventas</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{fmtNumero(c.ventas)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Facturado</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">{fmtMoneda(c.facturado)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Última venta</dt>
                    <dd className="font-semibold text-slate-900">{fmtFecha(c.ultimaVenta)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {bajas.length > 0 ? (
        <details className="mt-6">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-600">
            Dados de baja ({bajas.length})
          </summary>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {bajas.map((c) => (
              <li key={c.id}>
                <Link href={`/clientes/${c.id}`} className="block p-4">
                  <p className="font-medium text-slate-500">{c.nombre}</p>
                  <p className="text-sm text-slate-500">
                    {c.telefono ?? "sin teléfono"}
                    {c.cuit ? (
                      <>
                        {" · "}
                        <span className="whitespace-nowrap">{formatearCuit(c.cuit)}</span>
                      </>
                    ) : null}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
