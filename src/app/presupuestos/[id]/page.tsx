import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { ETIQUETA_ESTADO, numeroPresupuesto, textoPlazo, TONO_ESTADO } from "@/lib/presupuestos";
import { getPresupuesto } from "@/lib/queries/presupuestos";
import { Aviso, Boton, Etiqueta, ListaPanel, Panel, Seccion, Tarjeta } from "@/components/ui";
import { estadoDemo } from "@/lib/respaldo";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { AccionesPresupuesto } from "../_componentes/acciones-presupuesto";
import { SinBase } from "../_componentes/sin-base";

export const dynamic = "force-dynamic";

export default async function PresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requierePermisoPagina("verPresupuestos");
  const { id } = await params;
  const p = await getPresupuesto(id);
  if (!p) {
    if (estadoDemo().activo) {
      return (
        <>
          <Seccion titulo="Presupuesto" />
          <SinBase />
        </>
      );
    }
    notFound();
  }

  const plazo = textoPlazo(p.estado, p.diasRestantes);
  const abierto = p.estado === "ABIERTO";

  return (
    <>
      <Seccion
        titulo={`Presupuesto N° ${numeroPresupuesto(p.numero, p.anio)}`}
        descripcion={`${p.cliente.nombre} · ${fmtFecha(p.fecha)}`}
        accion={
          <Boton href="/presupuestos" variante="secundario">
            Volver
          </Boton>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Etiqueta tono={TONO_ESTADO[p.estado]}>{ETIQUETA_ESTADO[p.estado]}</Etiqueta>
        <span className="text-body-sm text-ink-muted">
          Válido hasta {fmtFecha(p.validoHasta)}
          {plazo ? ` · ${plazo}` : ""}
        </span>
        <Link href={`/clientes/${p.cliente.id}`} className="enlace inline-flex min-h-11 items-center">
          Ver cliente
        </Link>
      </div>

      <div className="space-y-3 empty:hidden">
        {p.estado === "VENCIDO" ? (
          <Aviso tono="aviso" titulo="Este presupuesto venció." role="status">
            Ya no se puede convertir en venta. Duplicalo para armar uno nuevo con los precios de hoy.
          </Aviso>
        ) : null}
        {p.estado === "ANULADO" ? (
          <Aviso tono="info" titulo="Presupuesto anulado." role="status">
            Queda como registro, pero no se puede editar ni convertir.
          </Aviso>
        ) : null}
        {p.venta ? (
          <Aviso tono="ok" role="status">
            Se convirtió en la venta{" "}
            <Link href={`/ventas/${p.venta.id}`} className="enlace">
              #{p.venta.numero}/{p.venta.anio}
            </Link>
            {p.venta.anulada ? " (hoy anulada)" : ""}.
          </Aviso>
        ) : null}
        {!p.cliente.activo && abierto ? (
          <Aviso tono="critico" titulo="El cliente está dado de baja." role="alert">
            No se puede convertir en venta mientras siga así.
          </Aviso>
        ) : null}
      </div>

      {p.duplicadoDe ? (
        <p className="mt-3 text-body-sm text-ink-muted">
          Copia del presupuesto{" "}
          <Link href={`/presupuestos/${p.duplicadoDe.id}`} className="enlace">
            N° {numeroPresupuesto(p.duplicadoDe.numero, p.duplicadoDe.anio)}
          </Link>
          , con precios actualizados.
        </p>
      ) : null}

      <p className="my-4 text-body-sm text-ink-muted">Registrado por {p.registradoPor ?? "—"}</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Total" valor={fmtMoneda(p.totales.totalBruto)} detalle={`IVA ${fmtMoneda(p.totales.totalIVA)}`} />
        <Tarjeta titulo="Validez" valor={`${p.validezDias} ${p.validezDias === 1 ? "día" : "días"}`} detalle={`Desde ${fmtFecha(p.fecha)}`} />
      </div>

      <ListaPanel className="mb-4">
        {p.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">{i.descripcion}</p>
              <p className="text-body-sm text-ink-muted tabular-nums">
                {fmtNumero(i.cantidad)} × {fmtMoneda(i.precioUnitario)}
              </p>
            </div>
            <p className="monto-fila shrink-0 text-ink">{fmtMoneda(i.subtotal)}</p>
          </li>
        ))}
      </ListaPanel>

      {p.observaciones ? (
        <Panel className="mb-4">
          <p className="eyebrow mb-1">Observaciones</p>
          <p className="text-body whitespace-pre-line text-ink">{p.observaciones}</p>
        </Panel>
      ) : null}

      {p.estado !== "ANULADO" ? (
        <Boton href={`/presupuestos/${p.id}/imprimir`} variante="secundario" ancho className="mb-4">
          Vista para el cliente (imprimir / WhatsApp)
        </Boton>
      ) : null}

      <AccionesPresupuesto
        id={p.id}
        puedeEditar={abierto && puede(usuario, "cargarPresupuesto")}
        puedeDuplicar={puede(usuario, "cargarPresupuesto")}
        puedeConvertir={abierto && puede(usuario, "convertirPresupuesto")}
        puedeAnular={(p.estado === "ABIERTO" || p.estado === "VENCIDO") && puede(usuario, "cargarPresupuesto")}
        vencido={p.estado === "VENCIDO"}
      />
    </>
  );
}
