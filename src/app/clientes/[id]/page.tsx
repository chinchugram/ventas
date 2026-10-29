import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import { formatearCuit } from "@/lib/cuit";
import { getCliente } from "@/lib/queries/clientes";
import { ESTILO_ESTADO_PAGO, ETIQUETA_ESTADO_PAGO } from "@/lib/queries/ventas";
import { Seccion, Tarjeta, Vacio } from "@/components/ui";
import { BotonActivoCliente } from "../_componentes/boton-activo";

export const dynamic = "force-dynamic";

const METODO: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  OTRO: "Otro",
};

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCliente(id);
  if (!c) notFound();

  const debe = c.saldo.cmp(0) > 0;
  const datos = [
    { etiqueta: "CUIT", valor: formatearCuit(c.cuit) },
    { etiqueta: "Teléfono", valor: c.telefono },
    { etiqueta: "Email", valor: c.email },
    { etiqueta: "Dirección", valor: c.direccion },
  ].filter((x) => x.valor);
  const vigentes = c.ventas.filter((v) => v.estado !== "ANULADA").length;

  return (
    <>
      <Seccion
        titulo={c.nombre}
        descripcion={debe && c.deudaDesde ? `Debe desde el ${fmtFecha(c.deudaDesde)}` : "Al día"}
        accion={
          <div className="flex gap-2">
            <Link
              href="/clientes"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Volver
            </Link>
            {!c.esDemo ? (
              <Link
                href={`/clientes/${c.id}/editar`}
                className="rounded-lg bg-marca px-3 py-2 text-sm font-semibold text-tinta"
              >
                Editar
              </Link>
            ) : null}
          </div>
        }
      />

      {!c.activo ? (
        <p className="mb-4 rounded-lg bg-slate-200 p-3 text-sm text-slate-700">
          Cliente dado de baja: no aparece al cargar ventas nuevas. Sus ventas y pagos se conservan.
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Saldo" valor={fmtMoneda(c.saldo)} tono={debe ? "aviso" : "ok"} />
        <Tarjeta
          titulo="Facturado"
          valor={fmtMoneda(c.facturado)}
          detalle={`${vigentes} ${vigentes === 1 ? "venta" : "ventas"} · cobrado ${fmtMoneda(c.pagado)}`}
        />
      </div>

      {datos.length > 0 || c.notas ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          {datos.length > 0 ? (
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              {datos.map((x) => (
                <div key={x.etiqueta} className="min-w-0">
                  <dt className="text-xs text-slate-500">{x.etiqueta}</dt>
                  <dd className="break-words text-slate-900">{x.valor}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {c.notas ? (
            <p className={`whitespace-pre-line text-sm text-slate-600 ${datos.length > 0 ? "mt-3 border-t border-slate-100 pt-3" : ""}`}>
              {c.notas}
            </p>
          ) : null}
        </div>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Ventas</h2>
      {c.ventas.length === 0 ? (
        <div className="mb-4">
          <Vacio mensaje="Todavía no tiene ventas" />
        </div>
      ) : (
        <ul className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {c.ventas.map((v) => {
            const anulada = v.estado === "ANULADA";
            const contenido = (
              <div className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className={`font-medium ${anulada ? "text-slate-400 line-through" : "text-slate-900"}`}>
                    #{v.numero}/{v.anio}
                  </p>
                  <p className="text-sm text-slate-500">{fmtFecha(v.fecha)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-semibold tabular-nums ${anulada ? "text-slate-400" : "text-slate-900"}`}>
                    {fmtMoneda(v.totalBruto)}
                  </p>
                  {anulada ? (
                    <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">Anulada</span>
                  ) : (
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO_PAGO[v.estadoPago]}`}>
                      {v.saldo.cmp(0) > 0 && v.estadoPago === "PARCIAL"
                        ? `debe ${fmtMoneda(v.saldo)}`
                        : ETIQUETA_ESTADO_PAGO[v.estadoPago]}
                    </span>
                  )}
                </div>
              </div>
            );
            return (
              <li key={v.id}>
                {c.esDemo ? contenido : <Link href={`/ventas/${v.id}`} className="block">{contenido}</Link>}
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Pagos</h2>
      {c.pagos.length === 0 ? (
        <div className="mb-4">
          <Vacio mensaje="Todavía no hay pagos registrados" />
        </div>
      ) : (
        <ul className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {c.pagos.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <p className="text-slate-900">
                  {fmtFecha(p.fecha)} · {METODO[p.metodo] ?? p.metodo}
                </p>
                <p className="text-slate-500">
                  Venta #{p.ventaNumero}/{p.ventaAnio}
                  {p.ventaAnulada ? " (anulada, no descuenta saldo)" : ""}
                  {p.anulado ? ` · Pago anulado: ${p.motivoAnulacion ?? ""}` : ""}
                  {p.notas ? ` · ${p.notas}` : ""}
                </p>
              </div>
              <p className={`shrink-0 font-semibold tabular-nums ${p.ventaAnulada || p.anulado ? "text-slate-400 line-through" : "text-slate-900"}`}>
                {fmtMoneda(p.monto)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!c.esDemo ? <BotonActivoCliente id={c.id} activo={c.activo} tieneSaldo={debe} /> : null}
    </>
  );
}
