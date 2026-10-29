import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { hoyArgentinaISO } from "@/lib/acciones";
import { ETIQUETA_METODO, tieneSaldo } from "@/lib/cobranzas";
import { ESTILO_ESTADO_PAGO, ETIQUETA_ESTADO_PAGO, getVenta } from "@/lib/queries/ventas";
import { AnularVentaBoton } from "@/components/anular-venta-boton";
import { Seccion, Tarjeta } from "@/components/ui";
import { RegistrarPagoForm } from "./_componentes/registrar-pago-form";
import { AnularPagoBoton } from "./_componentes/anular-pago-boton";
import { MarcarEntregadaBoton } from "./_componentes/marcar-entregada-boton";

export const dynamic = "force-dynamic";

const TEXTO_ESTADO = { PENDIENTE: "Pedido pendiente", ENTREGADA: "Entregada", ANULADA: "Anulada" } as const;

/** Momento de la anulacion (timestamp), en hora argentina. */
function fechaHoraAR(momento: Date): string {
  return momento.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function VentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venta = await getVenta(id);
  if (!venta) notFound();

  const anulada = venta.estado === "ANULADA";
  const debe = !anulada && tieneSaldo(venta.saldo);

  return (
    <>
      <Seccion
        titulo={`Venta #${venta.numero}/${venta.anio}`}
        descripcion={`${venta.clienteNombre} · ${fmtFecha(venta.fecha)}`}
        accion={
          <Link
            href="/ventas"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
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
        <Link href={`/clientes/${venta.clienteId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline underline-offset-2">
          Ver cliente
        </Link>
      </div>

      <p className="mb-4 text-sm text-slate-500">Registrado por {venta.registradoPor ?? "—"}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Total" valor={fmtMoneda(venta.totalBruto)} detalle={`IVA ${fmtMoneda(venta.totalIVA)}`} />
        <Tarjeta
          titulo="Saldo"
          valor={anulada ? "-" : fmtMoneda(venta.saldo)}
          tono={debe ? "aviso" : anulada ? "neutro" : "ok"}
          detalle={anulada ? undefined : `Cobrado ${fmtMoneda(venta.pagado)}`}
        />
      </div>

      {debe ? (
        <div className="mb-4">
          <RegistrarPagoForm ventaId={venta.id} saldo={venta.saldo.toFixed(2)} hoy={hoyArgentinaISO()} />
        </div>
      ) : null}

      {venta.estado === "PENDIENTE" ? (
        <div className="mb-4">
          <MarcarEntregadaBoton ventaId={venta.id} debe={debe} />
        </div>
      ) : null}

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

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Pagos</h2>
        {anulada && venta.pagos.length > 0 ? (
          <p className="mb-2 text-xs text-slate-500">Venta anulada: sus pagos se muestran, pero no cuentan.</p>
        ) : null}
        {venta.pagos.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay pagos.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {venta.pagos.map((p) => {
              const pagoAnulado = p.anuladoEn !== null;
              return (
                <li key={p.id} className="py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={pagoAnulado ? "text-slate-500 line-through" : "text-slate-900"}>
                        {fmtFecha(p.fecha)} · {ETIQUETA_METODO[p.metodo] ?? p.metodo}
                      </p>
                      {p.notas ? <p className="break-words text-slate-500">{p.notas}</p> : null}
                      <p className="text-xs text-slate-500">Registrado por {p.registradoPor ?? "—"}</p>
                      {pagoAnulado ? (
                        <p className="break-words text-xs text-red-700">
                          Anulado el {fechaHoraAR(p.anuladoEn!)}: {p.motivoAnulacion}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      <span
                        className={`font-semibold tabular-nums ${pagoAnulado || anulada ? "text-slate-500 line-through" : "text-slate-900"}`}
                      >
                        {fmtMoneda(p.monto)}
                      </span>
                    </div>
                  </div>
                  {!pagoAnulado ? (
                    <div className="flex flex-wrap justify-end">
                      <AnularPagoBoton pagoId={p.id} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {venta.observaciones ? (
        <p className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {venta.observaciones}
        </p>
      ) : null}

      {!anulada ? <AnularVentaBoton ventaId={venta.id} /> : null}
    </>
  );
}
