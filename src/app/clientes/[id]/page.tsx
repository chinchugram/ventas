import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { formatearCuit } from "@/lib/cuit";
import { ETIQUETA_CONDICION_IVA } from "@/lib/datos-fiscales";
import { getCliente } from "@/lib/queries/clientes";
import { getListaDeCliente } from "@/lib/queries/listas-precios";
import { ETIQUETA_METODO } from "@/lib/cobranzas";
import { ETIQUETA_ESTADO_PAGO } from "@/lib/queries/ventas";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { Aviso, Boton, Dato, Etiqueta, ListaPanel, Panel, Seccion, Tarjeta, TituloBloque, TONO_ESTADO_PAGO, Vacio } from "@/components/ui";
import { BotonActivoCliente } from "../_componentes/boton-activo";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requierePermisoPagina("verClientes");
  const { id } = await params;
  const c = await getCliente(id);
  if (!c) notFound();
  const lista = await getListaDeCliente(c.id);
  const puedeEditar = puede(usuario, "editarClientes");

  const debe = c.saldo.cmp(0) > 0;
  const datos = [
    { etiqueta: "Condición frente al IVA", valor: ETIQUETA_CONDICION_IVA[c.condicionIva] ?? c.condicionIva },
    { etiqueta: "CUIT", valor: formatearCuit(c.cuit) },
    { etiqueta: "DNI", valor: c.dni },
    { etiqueta: "Teléfono", valor: c.telefono },
    { etiqueta: "Email", valor: c.email },
    { etiqueta: "Dirección", valor: c.direccion },
    {
      etiqueta: "Lista de precios",
      valor: lista
        ? `${lista.nombre}${lista.descuentoPct.gt(0) ? ` (−${fmtNumero(lista.descuentoPct)}%)` : ""}${lista.activo ? "" : " · de baja, no se aplica"}`
        : null,
    },
  ].filter((x) => x.valor);
  const vigentes = c.ventas.filter((v) => v.estado !== "ANULADA").length;

  return (
    <>
      <Seccion
        epigrafe="Cliente"
        titulo={c.nombre}
        descripcion={debe && c.deudaDesde ? `Debe desde el ${fmtFecha(c.deudaDesde)}` : "Al día"}
        accion={
          <div className="flex flex-wrap gap-2">
            <Boton href="/clientes" variante="secundario">
              Volver
            </Boton>
            {!c.esDemo && puedeEditar ? <Boton href={`/clientes/${c.id}/editar`}>Editar</Boton> : null}
          </div>
        }
      />

      {!c.activo ? (
        <Aviso tono="aviso" titulo="Cliente dado de baja." className="mb-4">
          No aparece al cargar ventas nuevas. Sus ventas y pagos se conservan.
        </Aviso>
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
        <Panel className="mb-4">
          {datos.length > 0 ? (
            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {datos.map((x) => (
                <Dato key={x.etiqueta} etiqueta={x.etiqueta} tipo="texto">
                  {x.valor}
                </Dato>
              ))}
            </dl>
          ) : null}
          {c.notas ? (
            <p
              className={`text-body whitespace-pre-line text-ink-muted ${datos.length > 0 ? "mt-3 border-t-(length:--border-width) border-line pt-3" : ""}`}
            >
              {c.notas}
            </p>
          ) : null}
        </Panel>
      ) : null}

      <TituloBloque>Ventas</TituloBloque>
      {c.ventas.length === 0 ? (
        <div className="mb-4">
          <Vacio mensaje="Todavía no le vendiste nada." hint="Cuando cargues una venta para este cliente aparece acá." />
        </div>
      ) : (
        <ListaPanel className="mb-4">
          {c.ventas.map((v) => {
            const anulada = v.estado === "ANULADA";
            const contenido = (
              <div className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className={`font-mono text-mono ${anulada ? "text-ink-muted line-through" : "text-ink"}`}>
                    #{v.numero}/{v.anio}
                  </p>
                  <p className="text-body-sm text-ink-muted">{fmtFecha(v.fecha)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <p className={`monto-fila ${anulada ? "text-ink-muted" : "text-ink"}`}>{fmtMoneda(v.totalBruto)}</p>
                  {anulada ? (
                    <Etiqueta tono="critico">Anulada</Etiqueta>
                  ) : (
                    <Etiqueta tono={TONO_ESTADO_PAGO[v.estadoPago]}>
                      {v.saldo.cmp(0) > 0 && v.estadoPago === "PARCIAL"
                        ? `debe ${fmtMoneda(v.saldo)}`
                        : ETIQUETA_ESTADO_PAGO[v.estadoPago]}
                    </Etiqueta>
                  )}
                </div>
              </div>
            );
            return (
              <li key={v.id}>
                {c.esDemo ? (
                  contenido
                ) : (
                  <Link href={`/ventas/${v.id}`} className="block min-h-11 hover:bg-surface-sunken">
                    {contenido}
                  </Link>
                )}
              </li>
            );
          })}
        </ListaPanel>
      )}

      <TituloBloque>Pagos</TituloBloque>
      {c.pagos.length === 0 ? (
        <div className="mb-4">
          <Vacio mensaje="Todavía no hay pagos." hint="Los cobros se registran desde el detalle de cada venta." />
        </div>
      ) : (
        <ListaPanel className="mb-4">
          {c.pagos.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-body text-ink">
                  {fmtFecha(p.fecha)} · {ETIQUETA_METODO[p.metodo] ?? p.metodo}
                </p>
                <p className="text-body-sm break-words text-ink-muted">
                  Venta <span className="font-mono text-mono">#{p.ventaNumero}/{p.ventaAnio}</span>
                  {p.ventaAnulada ? " (anulada, no descuenta saldo)" : ""}
                  {p.anulado ? ` · Pago anulado: ${p.motivoAnulacion ?? ""}` : ""}
                  {p.notas ? ` · ${p.notas}` : ""}
                </p>
              </div>
              <p className={`monto-fila shrink-0 ${p.ventaAnulada || p.anulado ? "text-ink-muted line-through" : "text-ink"}`}>
                {fmtMoneda(p.monto)}
              </p>
            </li>
          ))}
        </ListaPanel>
      )}

      {!c.esDemo && puedeEditar ? (
        <Panel className="space-y-3">
          <TituloBloque className="mb-0">{c.activo ? "Dar de baja" : "Cliente dado de baja"}</TituloBloque>
          <BotonActivoCliente id={c.id} activo={c.activo} tieneSaldo={debe} />
        </Panel>
      ) : null}
    </>
  );
}
