import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { ESTILO_ESTADO_PAGO, ETIQUETA_ESTADO_PAGO, getVenta } from "@/lib/queries/ventas";
import { AnularVentaBoton } from "@/components/anular-venta-boton";
import { Seccion, Tarjeta } from "@/components/ui";

export const dynamic = "force-dynamic";

const TEXTO_ESTADO = { PENDIENTE: "Pedido pendiente", ENTREGADA: "Entregada", ANULADA: "Anulada" } as const;

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venta = await getVenta(id);
  if (!venta) notFound();

  const anulada = venta.estado === "ANULADA";

  return (
    <>
      <Seccion
        titulo={`Venta #${venta.numero}/${venta.anio}`}
        descripcion={`${venta.clienteNombre} · ${fmtFecha(venta.fecha)}`}
        accion={
          <Link
            href="/ventas"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
          {TEXTO_ESTADO[venta.estado]}
        </span>
        {!anulada ? (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO_PAGO[venta.estadoPago]}`}>
            {ETIQUETA_ESTADO_PAGO[venta.estadoPago]}
          </span>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Total" valor={fmtMoneda(venta.totalBruto)} detalle={`IVA ${fmtMoneda(venta.totalIVA)}`} />
        <Tarjeta
          titulo="Saldo"
          valor={anulada ? "-" : fmtMoneda(venta.saldo)}
          tono={!anulada && venta.saldo.cmp(0) > 0 ? "aviso" : "neutro"}
        />
      </div>

      <ul className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {venta.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{i.descripcion}</p>
              <p className="text-sm text-slate-500">
                {fmtNumero(i.cantidad)} × {fmtMoneda(i.precioUnitario)}
              </p>
            </div>
            <p className="shrink-0 font-semibold tabular-nums text-slate-900">{fmtMoneda(i.subtotalBruto)}</p>
          </li>
        ))}
      </ul>

      {venta.pagos.length > 0 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Pagos</h2>
          <ul className="space-y-1 text-sm text-slate-600">
            {venta.pagos.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span>
                  {fmtFecha(p.fecha)} · {p.metodo.toLowerCase()}
                </span>
                <span className="tabular-nums">{fmtMoneda(p.monto)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {venta.observaciones ? (
        <p className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {venta.observaciones}
        </p>
      ) : null}

      {!anulada ? <AnularVentaBoton ventaId={venta.id} /> : null}
    </>
  );
}
