import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { ESTILO_ESTADO, ETIQUETA_ESTADO, numeroPresupuesto, textoPlazo } from "@/lib/presupuestos";
import { getPresupuesto } from "@/lib/queries/presupuestos";
import { Seccion, Tarjeta } from "@/components/ui";
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
          <Link
            href="/presupuestos"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700"
          >
            Volver
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[p.estado]}`}>{ETIQUETA_ESTADO[p.estado]}</span>
        <span className="text-sm text-slate-600">
          Válido hasta {fmtFecha(p.validoHasta)}
          {plazo ? ` · ${plazo}` : ""}
        </span>
        <Link
          href={`/clientes/${p.cliente.id}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline underline-offset-2"
        >
          Ver cliente
        </Link>
      </div>

      {p.estado === "VENCIDO" ? (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Este presupuesto venció y ya no se puede convertir en venta. Duplicalo para armar uno nuevo con los precios de
          hoy.
        </p>
      ) : null}
      {p.estado === "ANULADO" ? (
        <p role="status" className="mb-4 rounded-lg bg-slate-200 p-3 text-sm text-slate-700">
          Presupuesto anulado: queda como registro, pero no se puede editar ni convertir.
        </p>
      ) : null}
      {p.venta ? (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          Se convirtió en la venta{" "}
          <Link href={`/ventas/${p.venta.id}`} className="font-semibold underline">
            #{p.venta.numero}/{p.venta.anio}
          </Link>
          {p.venta.anulada ? " (hoy anulada)" : ""}.
        </p>
      ) : null}
      {p.duplicadoDe ? (
        <p className="mb-4 text-sm text-slate-600">
          Copia del presupuesto{" "}
          <Link href={`/presupuestos/${p.duplicadoDe.id}`} className="font-medium underline">
            N° {numeroPresupuesto(p.duplicadoDe.numero, p.duplicadoDe.anio)}
          </Link>
          , con precios actualizados.
        </p>
      ) : null}
      {!p.cliente.activo && abierto ? (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          El cliente está dado de baja: no se puede convertir en venta mientras siga así.
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Tarjeta titulo="Total" valor={fmtMoneda(p.totales.totalBruto)} detalle={`IVA ${fmtMoneda(p.totales.totalIVA)}`} />
        <Tarjeta titulo="Validez" valor={`${p.validezDias} ${p.validezDias === 1 ? "día" : "días"}`} detalle={`Desde ${fmtFecha(p.fecha)}`} />
      </div>

      <ul className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {p.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{i.descripcion}</p>
              <p className="text-sm text-slate-500">
                {fmtNumero(i.cantidad)} × {fmtMoneda(i.precioUnitario)}
              </p>
            </div>
            <p className="shrink-0 font-semibold tabular-nums text-slate-900">{fmtMoneda(i.subtotal)}</p>
          </li>
        ))}
      </ul>

      {p.observaciones ? (
        <p className="mb-4 whitespace-pre-line rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {p.observaciones}
        </p>
      ) : null}

      {p.estado !== "ANULADO" ? (
        <Link
          href={`/presupuestos/${p.id}/imprimir`}
          className="mb-4 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-tinta px-4 text-sm font-semibold text-white"
        >
          Vista para el cliente (imprimir / WhatsApp)
        </Link>
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
