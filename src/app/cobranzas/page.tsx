import Link from "next/link";
import { fmtFecha, fmtMoneda, fmtMonedaCorta, sumar } from "@/lib/money";
import { agruparPorAntiguedad, agruparPorCliente, ETIQUETA_METODO, type VentaConSaldo } from "@/lib/cobranzas";
import { ETIQUETA_ESTADO_PAGO } from "@/lib/queries/ventas";
import { estadoDemo } from "@/lib/respaldo";
import { requierePermisoPagina } from "@/lib/permisos";
import { Etiqueta, ListaPanel, Seccion, Tarjeta, TituloBloque, TONO_ESTADO_PAGO, Vacio } from "@/components/ui";
import { getCobradoDelMes, getPagosRecientes, getVentasConSaldo } from "./consultas";

export const dynamic = "force-dynamic";

type Vista = "clientes" | "antiguedad";

const ESTILO_TRAMO = {
  HASTA_30: "text-ink",
  HASTA_60: "text-aviso-text",
  HASTA_90: "text-brand-text",
  MAS_90: "text-critico-text",
} as const;

export default async function CobranzasPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  await requierePermisoPagina("verCobranzas");
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
      <Seccion epigrafe="Plata por cobrar" titulo="Cobranzas" descripcion="Quién debe, cuánto y desde cuándo" />

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
        <div className="mb-8">
          <Vacio mensaje="Nadie te debe nada." hint="Todo lo vendido está cobrado. Buen momento para un mate." />
        </div>
      ) : (
        <>
          <nav className="mb-4 grid grid-cols-2 gap-2" aria-label="Agrupar deuda">
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
                className="chip justify-center"
              >
                {texto}
              </Link>
            ))}
          </nav>

          {vista === "clientes" ? (
            <ul className="mb-8 space-y-3">
              {clientes.map((c) => (
                <li key={c.clienteId} className="tarjeta overflow-hidden">
                  <div className="flex items-start justify-between gap-3 p-4 pb-2">
                    <div className="min-w-0">
                      <p className="text-body font-semibold break-words text-ink">
                        {conDetalle ? (
                          <Link href={`/clientes/${c.clienteId}`} className="enlace inline-flex min-h-11 items-center">
                            {c.nombre}
                          </Link>
                        ) : (
                          c.nombre
                        )}
                      </p>
                      <p className="text-body-sm text-ink-muted">
                        Debe desde el {fmtFecha(c.desde)} ({c.diasMax} {c.diasMax === 1 ? "día" : "días"})
                        {c.telefono ? (
                          <>
                            {" · "}
                            <a href={`tel:${c.telefono}`} className="enlace inline-flex min-h-11 items-center">
                              {c.telefono}
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <p className="monto-fila shrink-0 text-aviso-text">{fmtMoneda(c.saldo)}</p>
                  </div>
                  <ul className="divide-y-(length:--border-width) divide-line border-t-(length:--border-width) border-line">
                    {c.ventas.map((v) => (
                      <FilaVenta key={v.id} venta={v} conDetalle={conDetalle} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mb-8 space-y-3">
              {tramos.map((t) => (
                <section key={t.clave} className="tarjeta overflow-hidden">
                  <div className="flex items-center justify-between gap-3 p-4 pb-2">
                    <h2 className={`font-display text-body-lg font-bold ${ESTILO_TRAMO[t.clave]}`}>
                      {t.etiqueta}
                      <span className="ml-1 font-sans text-body font-normal text-ink-muted">({t.ventas.length})</span>
                    </h2>
                    <p className={`monto-fila shrink-0 ${ESTILO_TRAMO[t.clave]}`}>{fmtMoneda(t.saldo)}</p>
                  </div>
                  {t.ventas.length === 0 ? (
                    <p className="border-t-(length:--border-width) border-line p-4 text-body-sm text-ink-muted">Sin deuda en este tramo.</p>
                  ) : (
                    <ul className="divide-y-(length:--border-width) divide-line border-t-(length:--border-width) border-line">
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

      <TituloBloque>Pagos recientes</TituloBloque>
      {pagos.length === 0 ? (
        <Vacio
          mensaje="Todavía no se cobró nada."
          hint="Los pagos se registran desde el detalle de cada venta."
        />
      ) : (
        <ListaPanel>
          {pagos.map((p) => {
            const noCuenta = p.anulado || p.ventaAnulada;
            return (
              <li key={p.id}>
                <Link href={`/ventas/${p.ventaId}`} className="flex min-h-11 items-start justify-between gap-3 p-4 hover:bg-surface-sunken">
                  <div className="min-w-0">
                    <p className={`text-body break-words ${noCuenta ? "text-ink-muted" : "text-ink"}`}>
                      {p.clienteNombre} · <span className="font-mono text-mono">#{p.ventaNumero}/{p.ventaAnio}</span>
                    </p>
                    <p className="text-body-sm text-ink-muted">
                      {fmtFecha(p.fecha)} · {ETIQUETA_METODO[p.metodo] ?? p.metodo}
                      {p.notas ? ` · ${p.notas}` : ""}
                    </p>
                    {p.anulado ? (
                      <p className="text-body-sm font-semibold break-words text-critico-text">Anulado: {p.motivoAnulacion}</p>
                    ) : p.ventaAnulada ? (
                      <p className="text-body-sm text-ink-muted">Venta anulada: no cuenta</p>
                    ) : null}
                  </div>
                  <p className={`monto-fila shrink-0 ${noCuenta ? "text-ink-muted line-through" : "text-ok-text"}`}>
                    {fmtMoneda(p.monto)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ListaPanel>
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
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-body break-words text-ink">
          <span className="font-mono text-mono">
            #{v.numero}/{v.anio}
          </span>
          {conCliente ? ` · ${v.clienteNombre}` : ""}
        </p>
        <p className="text-body-sm text-ink-muted">
          {fmtFecha(v.fecha)} · {v.dias} {v.dias === 1 ? "día" : "días"}
          {v.estado === "PENDIENTE" ? " · sin entregar" : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className="monto-fila text-ink">{fmtMoneda(v.saldo)}</p>
        <Etiqueta tono={TONO_ESTADO_PAGO[v.estadoPago]}>
          {v.estadoPago === "PARCIAL" ? `de ${fmtMonedaCorta(v.totalBruto)}` : ETIQUETA_ESTADO_PAGO[v.estadoPago]}
        </Etiqueta>
      </div>
    </div>
  );
  return (
    <li>
      {conDetalle ? (
        <Link href={`/ventas/${v.id}`} className="block min-h-11 hover:bg-surface-sunken">
          {contenido}
        </Link>
      ) : (
        contenido
      )}
    </li>
  );
}
