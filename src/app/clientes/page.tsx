import Link from "next/link";
import { fmtFecha, fmtMonedaCorta as fmtMoneda, fmtNumero } from "@/lib/money";
import { formatearCuit } from "@/lib/cuit";
import { getClientes, getClientesDeBaja } from "@/lib/queries/clientes";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { Boton, Dato, Etiqueta, Plegable, Seccion, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const usuario = await requierePermisoPagina("verClientes");
  const [clientes, bajas] = await Promise.all([getClientes(), getClientesDeBaja()]);

  const deudores = clientes.filter((c) => c.saldo.cmp(0) > 0);
  const botonNuevo = <Boton href="/clientes/nuevo">Nuevo cliente</Boton>;

  return (
    <>
      <Seccion
        epigrafe="Quién te compra"
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
        <Vacio mensaje="Ni un cliente a la vista." hint="Cargá el primero con «Nuevo cliente» y ya podés venderle." />
      ) : (
        <ul className="space-y-2">
          {clientes.map((c) => (
            <li key={c.id}>
              <Link href={`/clientes/${c.id}`} className="tarjeta block p-4 hover:bg-surface-sunken">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-semibold break-words text-ink">{c.nombre}</p>
                    <p className="text-body-sm text-ink-muted">
                      {c.telefono ?? "sin teléfono"}
                      {c.cuit ? (
                        <>
                          {" · "}
                          <span className="font-mono text-mono whitespace-nowrap">{formatearCuit(c.cuit)}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {c.saldo.cmp(0) > 0 ? (
                    <Etiqueta tono="aviso" className="shrink-0 tabular-nums">
                      debe {fmtMoneda(c.saldo)}
                    </Etiqueta>
                  ) : (
                    <Etiqueta tono="ok" className="shrink-0">
                      al día
                    </Etiqueta>
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2">
                  <Dato etiqueta="Ventas">{fmtNumero(c.ventas)}</Dato>
                  <Dato etiqueta="Facturado">{fmtMoneda(c.facturado)}</Dato>
                  <Dato etiqueta="Última venta" tipo="texto">
                    {fmtFecha(c.ultimaVenta)}
                  </Dato>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {bajas.length > 0 ? (
        <Plegable titulo={`Dados de baja (${bajas.length})`} className="mt-6">
          <ul className="divide-y-(length:--border-width) divide-line">
            {bajas.map((c) => (
              <li key={c.id}>
                <Link href={`/clientes/${c.id}`} className="block min-h-11 px-4 py-3 hover:underline">
                  <p className="text-body font-semibold text-ink-muted">{c.nombre}</p>
                  <p className="text-body-sm text-ink-muted">
                    {c.telefono ?? "sin teléfono"}
                    {c.cuit ? (
                      <>
                        {" · "}
                        <span className="font-mono text-mono whitespace-nowrap">{formatearCuit(c.cuit)}</span>
                      </>
                    ) : null}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Plegable>
      ) : null}
    </>
  );
}
