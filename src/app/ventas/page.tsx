import { fmtFecha, fmtMonedaCorta as fmtMoneda, fmtNumero, sumar } from "@/lib/money";
import { ETIQUETA_ESTADO_PAGO, ESTILO_ESTADO_PAGO, getVentas } from "@/lib/queries/ventas";
import { Seccion, Tarjeta, Vacio } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function VentasPage() {
  const ventas = await getVentas(50);

  const facturado = sumar(...ventas.map((v) => v.totalBruto));
  const pendiente = sumar(...ventas.map((v) => v.saldo));

  return (
    <>
      <Seccion titulo="Ventas" descripcion={`Últimas ${ventas.length}`} />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Facturado" valor={fmtMoneda(facturado)} />
        <Tarjeta
          titulo="Sin cobrar"
          valor={fmtMoneda(pendiente)}
          tono={pendiente.cmp(0) > 0 ? "aviso" : "ok"}
        />
      </div>

      {ventas.length === 0 ? (
        <Vacio
          mensaje="No hay ventas registradas"
          hint="La primera venta es la que empieza a darle sentido al sistema."
        />
      ) : (
        <ul className="space-y-2">
          {ventas.map((v) => (
            <li key={v.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    #{v.numero}/{v.anio} · {v.clienteNombre}
                  </p>
                  <p className="text-sm text-slate-500">
                    {fmtFecha(v.fecha)} · {fmtNumero(v.items)}{" "}
                    {v.items === 1 ? "item" : "items"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                    ESTILO_ESTADO_PAGO[v.estadoPago]
                  }`}
                >
                  {ETIQUETA_ESTADO_PAGO[v.estadoPago]}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Total</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">
                    {fmtMoneda(v.totalBruto)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Ganancia</dt>
                  <dd className="font-semibold tabular-nums text-emerald-700">
                    {fmtMoneda(v.ganancia)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Saldo</dt>
                  <dd
                    className={`font-semibold tabular-nums ${
                      v.saldo.cmp(0) > 0 ? "text-amber-700" : "text-slate-400"
                    }`}
                  >
                    {v.saldo.cmp(0) > 0 ? fmtMoneda(v.saldo) : "al día"}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
