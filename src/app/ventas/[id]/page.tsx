import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { hoyArgentinaISO } from "@/lib/acciones";
import { ETIQUETA_METODO, tieneSaldo } from "@/lib/cobranzas";
import { ETIQUETA_ESTADO_PAGO, getVenta } from "@/lib/queries/ventas";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { dbDisponible, prisma } from "@/lib/prisma";
import { conNegocio } from "@/lib/negocio";
import { negocioUnico } from "@/lib/dominio/auth";
import { facturaAnulableDeVenta } from "@/lib/dominio/notas-credito";
import { AnularVentaBoton } from "@/components/anular-venta-boton";
import { Boton, Etiqueta, ListaPanel, Panel, Seccion, Tarjeta, TituloBloque, TONO_ESTADO_PAGO, type Tono } from "@/components/ui";
import { RegistrarPagoForm } from "./_componentes/registrar-pago-form";
import { AnularPagoBoton } from "./_componentes/anular-pago-boton";
import { MarcarEntregadaBoton } from "./_componentes/marcar-entregada-boton";
import { FacturarPanel } from "./_componentes/factur-panel";
import { EmitirNotaCreditoBoton } from "./_componentes/emitir-nota-credito-boton";
import { BloqueProduccion } from "@/app/produccion/_componentes/bloque-produccion";

export const dynamic = "force-dynamic";

const TEXTO_ESTADO = { PENDIENTE: "Pedido pendiente", ENTREGADA: "Entregada", ANULADA: "Anulada" } as const;
const TONO_ESTADO: Record<keyof typeof TEXTO_ESTADO, Tono> = { PENDIENTE: "aviso", ENTREGADA: "ok", ANULADA: "critico" };

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
  const usuario = await requierePermisoPagina("verVentas");
  const { id } = await params;
  const venta = await getVenta(id);
  if (!venta) notFound();

  // Los botones de lo que el usuario no puede hacer ni se pintan (las acciones lo vuelven a verificar).
  const puedeCobrar = puede(usuario, "registrarCobro");
  const puedeEntregar = puede(usuario, "marcarEntregada");
  const puedeAnularPago = puede(usuario, "anularPago");
  const puedeAnularVenta = puede(usuario, "anularVenta");
  const puedeNotaCredito = puede(usuario, "emitirNotaCredito");

  const anulada = venta.estado === "ANULADA";
  const debe = !anulada && tieneSaldo(venta.saldo);
  // Solo el dueño ve el botón (la acción vuelve a verificar el permiso); sin base no hay facturas.
  const facturaAnulable =
    puedeNotaCredito && !anulada && (await dbDisponible())
      ? await negocioUnico(prisma).then((negocioId) => conNegocio(negocioId, (tx) => facturaAnulableDeVenta(tx, negocioId, venta.id)))
      : null;

  return (
    <>
      <Seccion
        titulo={`Venta #${venta.numero}/${venta.anio}`}
        descripcion={`${venta.clienteNombre} · ${fmtFecha(venta.fecha)}`}
        accion={
          <Boton href="/ventas" variante="secundario">
            Volver
          </Boton>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Etiqueta tono={TONO_ESTADO[venta.estado]}>{TEXTO_ESTADO[venta.estado]}</Etiqueta>
        {!anulada ? <Etiqueta tono={TONO_ESTADO_PAGO[venta.estadoPago]}>{ETIQUETA_ESTADO_PAGO[venta.estadoPago]}</Etiqueta> : null}
        <Link href={`/clientes/${venta.clienteId}`} className="enlace inline-flex min-h-11 items-center">
          Ver cliente
        </Link>
      </div>

      <p className="mb-4 text-body-sm text-ink-muted">Registrado por {venta.registradoPor ?? "—"}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Total" valor={fmtMoneda(venta.totalBruto)} detalle={`IVA ${fmtMoneda(venta.totalIVA)}`} />
        <Tarjeta
          titulo="Saldo"
          valor={anulada ? "-" : fmtMoneda(venta.saldo)}
          tono={debe ? "aviso" : anulada ? "neutro" : "ok"}
          detalle={anulada ? undefined : `Cobrado ${fmtMoneda(venta.pagado)}`}
        />
      </div>

      {debe && puedeCobrar ? (
        <div className="mb-4">
          <RegistrarPagoForm ventaId={venta.id} saldo={venta.saldo.toFixed(2)} hoy={hoyArgentinaISO()} />
        </div>
      ) : null}

      {venta.estado === "PENDIENTE" && puedeEntregar ? (
        <div className="mb-4">
          <MarcarEntregadaBoton ventaId={venta.id} debe={debe} />
        </div>
      ) : null}

      <FacturarPanel ventaId={venta.id} />

      <ListaPanel className="mb-4">
        {venta.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">{i.descripcion}</p>
              <p className="text-body-sm text-ink-muted tabular-nums">
                {fmtNumero(i.cantidad)} × {fmtMoneda(i.precioUnitario)}
              </p>
            </div>
            <p className="monto-fila shrink-0 text-ink">{fmtMoneda(i.subtotalBruto)}</p>
          </li>
        ))}
      </ListaPanel>

      <BloqueProduccion ventaId={venta.id} />

      <Panel className="mb-4">
        <TituloBloque className="mb-2">Pagos</TituloBloque>
        {anulada && venta.pagos.length > 0 ? (
          <p className="mb-2 text-body-sm text-ink-muted">Venta anulada: sus pagos se muestran, pero no cuentan.</p>
        ) : null}
        {venta.pagos.length === 0 ? (
          <p className="text-body text-ink-muted">Todavía no se cobró nada de esta venta.</p>
        ) : (
          <ul className="divide-y-(length:--border-width) divide-line">
            {venta.pagos.map((p) => {
              const pagoAnulado = p.anuladoEn !== null;
              return (
                <li key={p.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-body ${pagoAnulado ? "text-ink-muted line-through" : "text-ink"}`}>
                        {fmtFecha(p.fecha)} · {ETIQUETA_METODO[p.metodo] ?? p.metodo}
                      </p>
                      {p.notas ? <p className="text-body-sm break-words text-ink-muted">{p.notas}</p> : null}
                      <p className="text-body-sm text-ink-muted">Registrado por {p.registradoPor ?? "—"}</p>
                      {pagoAnulado ? (
                        <p className="text-body-sm font-semibold break-words text-critico-text">
                          Anulado el {fechaHoraAR(p.anuladoEn!)}: {p.motivoAnulacion}
                        </p>
                      ) : null}
                    </div>
                    <p className={`monto-fila shrink-0 ${pagoAnulado || anulada ? "text-ink-muted line-through" : "text-ink"}`}>
                      {fmtMoneda(p.monto)}
                    </p>
                  </div>
                  {!pagoAnulado && puedeAnularPago ? (
                    <div className="flex flex-wrap justify-end">
                      <AnularPagoBoton pagoId={p.id} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {venta.observaciones ? (
        <Panel className="mb-4">
          <p className="eyebrow mb-1">Observaciones</p>
          <p className="text-body whitespace-pre-line text-ink">{venta.observaciones}</p>
        </Panel>
      ) : null}

      {facturaAnulable ? (
        <div className="mb-4">
          <EmitirNotaCreditoBoton
            ventaId={venta.id}
            comprobanteId={facturaAnulable.id}
            etiquetaFactura={facturaAnulable.etiqueta}
          />
        </div>
      ) : null}

      {!anulada && puedeAnularVenta ? <AnularVentaBoton ventaId={venta.id} /> : null}
    </>
  );
}
