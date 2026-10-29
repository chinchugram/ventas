import Link from "next/link";
import { fmtFecha, fmtMoneda, fmtMonedaCorta, sumar } from "@/lib/money";
import { agruparPorAntiguedad, agruparPorCliente, ETIQUETA_METODO, type VentaConSaldo } from "@/lib/cobranzas";
import { ESTILO_ESTADO_PAGO, ETIQUETA_ESTADO_PAGO } from "@/lib/queries/ventas";
import { estadoDemo } from "@/lib/respaldo";
import { Seccion, Tarjeta, Vacio } from "@/components/ui";
import { getCobradoDelMes, getPagosRecientes, getVentasConSaldo } from "./consultas";

export const dynamic = "force-dynamic";

type Vista = "clientes" | "antiguedad";

const ESTILO_TRAMO = {
  HASTA_30: "text-slate-900",
  HASTA_60: "text-amber-700",
  HASTA_90: "text-orange-700",
  MAS_90: "text-red-700",
} as const;

export default async function CobranzasPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { vista: vistaPedida } = await searchParams;
  const vista: Vista = vistaPedida === "antiguedad" ? "antiguedad" : "clientes";

  const [ventas, pagos, cobradoMes] = await Promise.all([getVentasConSaldo(), getPagosRecientes(20), getCobradoDelMes()]);
  // Las ventas de demostracion no tienen detalle: solo se enlaza con base real.
  const conDetalle = !estadoDemo().activo;

  const porCobrar = sumar(...ventas.map((v) => v.saldo));
  const clientes = agruparPorCliente(ventas);
  const tramos = agruparPorAntiguedad(ventas);
  const vencido = sumar(...tramos.filter((t) => t.clave !== "HASTA_30").map((t) => t.saldo));

  return (
    <>
      <Seccion titulo="Cobranzas" descripcion="Quién debe, cuánto y desde cuándo" />

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta
          titulo="Por cobrar"
          valor={fmtMonedaCorta(porCobrar)}
          tono={porCobrar.gt(0) ? "aviso" : "ok"}
          detalle={`${ventas.length} ${ventas.length === 1 ? "venta" : "ventas"} · ${clientes.length} ${clientes.length === 1 ? "cliente" : "clientes"}`}
        />
        <Tarjeta
          titulo="Cobrado del mes"
          valor={fmtMonedaCorta(cobradoMes)}
          tono="ok"
          detalle={vencido.gt(0) ? `Más de 30 días: ${fmtMonedaCorta(vencido)}` : "Nada de más de 30 días"}
        />
      </div>

      {ventas.length === 0 ? (
        <div className="mb-6">
          <Vacio mensaje="No hay ventas con saldo pendiente" hint="Todo lo vendido está cobrado." />
        </div>
      ) : (
        <>
          <nav className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-200 p-1 text-sm font-semibold" aria-label="Agrupar deuda">
            {(
              [
                ["clientes", "Por cliente"],
                ["antiguedad", "Por antigüedad"],
              ] as const
            ).map(([clave, texto]) => (
              <Link
                key={clave}
                href={clave === "clientes" ? "/cobranzas" : "/cobranzas?vista=antiguedad"}
                aria-current={vista === clave ? "page" : undefined}
                className={`rounded-md py-2 text-center ${vista === clave ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                {texto}
              </Link>
            ))}
          </nav>

          {vista === "clientes" ? (
            <ul className="mb-6 space-y-3">
              {clientes.map((c) => (
                <li key={c.clienteId} className="rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-start justify-between gap-3 p-4 pb-2">
                    <div className="min-w-0">
                      <p className="font-semibold break-words text-slate-900">
                        {conDetalle ? (
                          <Link href={`/clientes/${c.clienteId}`} className="underline-offset-2 hover:underline">
                            {c.nombre}
                          </Link>
                        ) : (
                          c.nombre
                        )}
                      </p>
                      <p className="text-sm text-slate-500">
                        Debe desde el {fmtFecha(c.desde)} ({c.diasMax} {c.diasMax === 1 ? "día" : "días"})
                        {c.telefono ? (
                          <>
                            {" · "}
                            <a href={`tel:${c.telefono}`} className="underline underline-offset-2">
                              {c.telefono}
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums text-amber-700">{fmtMoneda(c.saldo)}</p>
                  </div>
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {c.ventas.map((v) => (
                      <FilaVenta key={v.id} venta={v} conDetalle={conDetalle} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mb-6 space-y-3">
              {tramos.map((t) => (
                <section key={t.clave} className="rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-3 p-4 pb-2">
                    <h2 className={`text-sm font-semibold ${ESTILO_TRAMO[t.clave]}`}>
                      {t.etiqueta}
                      <span className="ml-1 font-normal text-slate-500">({t.ventas.length})</span>
                    </h2>
                    <p className={`shrink-0 font-semibold tabular-nums ${ESTILO_TRAMO[t.clave]}`}>{fmtMoneda(t.saldo)}</p>
                  </div>
                  {t.ventas.length === 0 ? (
                    <p className="border-t border-slate-100 p-4 pt-2 text-sm text-slate-400">Sin deuda en este tramo</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 border-t border-slate-100">
                      {t.ventas.map((v) => (
                        <FilaVenta key={v.id} venta={v} conDetalle={conDetalle} conCliente />
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Pagos recientes</h2>
      {pagos.length === 0 ? (
        <Vacio
          mensaje="Todavía no hay pagos registrados"
          hint="Los pagos se registran desde el detalle de cada venta."
        />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {pagos.map((p) => {
            const noCuenta = p.anulado || p.ventaAnulada;
            return (
              <li key={p.id}>
                <Link href={`/ventas/${p.ventaId}`} className="flex items-start justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0">
                    <p className={`break-words ${noCuenta ? "text-slate-400" : "text-slate-900"}`}>
                      {p.clienteNombre} · #{p.ventaNumero}/{p.ventaAnio}
                    </p>
                    <p className="text-slate-500">
                      {fmtFecha(p.fecha)} · {ETIQUETA_METODO[p.metodo] ?? p.metodo}
                      {p.notas ? ` · ${p.notas}` : ""}
                    </p>
                    {p.anulado ? (
                      <p className="break-words text-xs text-red-700">Anulado: {p.motivoAnulacion}</p>
                    ) : p.ventaAnulada ? (
                      <p className="text-xs text-slate-500">Venta anulada: no cuenta</p>
                    ) : null}
                  </div>
                  <p
                    className={`shrink-0 font-semibold tabular-nums ${noCuenta ? "text-slate-400 line-through" : "text-emerald-700"}`}
                  >
                    {fmtMoneda(p.monto)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Una venta con saldo: toca para ir a cobrarla. */
function FilaVenta({
  venta: v,
  conDetalle,
  conCliente = false,
}: {
  venta: VentaConSaldo;
  conDetalle: boolean;
  conCliente?: boolean;
}) {
  const contenido = (
    <div className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="break-words text-slate-900">
          #{v.numero}/{v.anio}
          {conCliente ? ` · ${v.clienteNombre}` : ""}
        </p>
        <p className="text-slate-500">
          {fmtFecha(v.fecha)} · {v.dias} {v.dias === 1 ? "día" : "días"}
          {v.estado === "PENDIENTE" ? " · sin entregar" : ""}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums text-slate-900">{fmtMoneda(v.saldo)}</p>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO_PAGO[v.estadoPago]}`}>
          {v.estadoPago === "PARCIAL" ? `de ${fmtMonedaCorta(v.totalBruto)}` : ETIQUETA_ESTADO_PAGO[v.estadoPago]}
        </span>
      </div>
    </div>
  );
  return (
    <li>
      {conDetalle ? (
        <Link href={`/ventas/${v.id}`} className="block">
          {contenido}
        </Link>
      ) : (
        contenido
      )}
    </li>
  );
}
