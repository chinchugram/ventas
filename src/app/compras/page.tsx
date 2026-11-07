import { fmtFecha, fmtMonedaCorta, fmtNumero } from "@/lib/money";
import { getCompras } from "@/lib/queries/compras";
import { Boton, Seccion, Vacio } from "@/components/ui";
import { requierePermisoPagina } from "@/lib/permisos";

export const dynamic = "force-dynamic";

export default async function ComprasPage() {
  await requierePermisoPagina("registrarCompra", "verCostos");
  const compras = await getCompras();

  return (
    <>
      <Seccion
        epigrafe="Lo que entra al taller"
        titulo="Compras"
        descripcion="A quién le compraste y a qué costo"
        accion={<Boton href="/compras/nueva">Nueva compra</Boton>}
      />

      {compras.length === 0 ? (
        <Vacio
          mensaje="Todavía no hay compras registradas."
          hint="Cada compra suma stock y deja el precio pagado, para que el costo no dependa de la memoria."
        />
      ) : (
        <ul className="space-y-2">
          {compras.map((c) => (
            <li key={c.id} className="tarjeta p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-semibold break-words text-ink">{c.proveedor}</p>
                  <p className="text-body-sm break-words text-ink-muted">
                    {fmtFecha(c.fecha)}
                    {c.comprobante ? ` · ${c.comprobante}` : ""}
                  </p>
                  <p className="text-body-sm text-ink-muted">Registrado por {c.registradoPor ?? "—"}</p>
                </div>
                <p className="monto-fila shrink-0 text-ink">{fmtMonedaCorta(c.total)}</p>
              </div>
              <ul className="mt-3 space-y-1 border-t-(length:--border-width) border-line pt-3 text-body-sm text-ink-muted">
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
