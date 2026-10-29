import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { enlaceWhatsApp } from "@/lib/recordatorios-cobranza";
import { mensajeWhatsAppPresupuesto, numeroPresupuesto } from "@/lib/presupuestos";
import { getMarca } from "@/lib/marca";
import { getPresupuesto } from "@/lib/queries/presupuestos";
import { estadoDemo } from "@/lib/respaldo";
import { BotonImprimir } from "../../_componentes/boton-imprimir";
import { SinBase } from "../../_componentes/sin-base";

export const dynamic = "force-dynamic";

// Al imprimir se ocultan el encabezado, la barra inferior y todo lo que el layout
// pone fuera de <main> (sin tocar navbar.tsx): en el <body> los hijos son el
// enlace de salto, el navbar y <main>.
const CSS_IMPRESION = `
@media print {
  body > :not(main) { display: none !important; }
  body { background: #fff !important; }
  main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
  @page { margin: 14mm; }
}
`;

/**
 * Vista para el cliente: SOLO lo que el cliente tiene que ver (negocio, numero,
 * fecha, validez, lineas, IVA y total). Ni costos, ni margenes, ni notas
 * internas, ni datos de otros clientes.
 */
export default async function ImprimirPresupuestoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, marca] = await Promise.all([getPresupuesto(id), getMarca()]);
  if (!p) {
    if (estadoDemo().activo) return <SinBase />;
    notFound();
  }

  const volver = (
    <Link
      href={`/presupuestos/${p.id}`}
      className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700"
    >
      Volver
    </Link>
  );

  if (p.estado === "ANULADO") {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-slate-200 p-4 text-sm text-slate-700">
          Este presupuesto está anulado: no se imprime ni se envía.
        </p>
        {volver}
      </div>
    );
  }

  const whatsapp =
    p.estado === "ABIERTO"
      ? enlaceWhatsApp(
          p.cliente.telefono,
          mensajeWhatsAppPresupuesto({
            clienteNombre: p.cliente.nombre,
            numero: p.numero,
            anio: p.anio,
            total: p.totales.totalBruto,
            fecha: p.fecha,
            validezDias: p.validezDias,
          }),
        )
      : null;

  return (
    <div className="space-y-4">
      <style>{CSS_IMPRESION}</style>

      <div className="space-y-3 print:hidden">
        {p.estado === "VENCIDO" ? (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Este presupuesto venció el {fmtFecha(p.validoHasta)}: no lo envíes así. Duplicalo desde el detalle para
            actualizar los precios.
          </p>
        ) : null}
        {p.estado === "CONVERTIDO" ? (
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            Este presupuesto ya se convirtió en venta.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {volver}
          <BotonImprimir />
          {whatsapp?.valido ? (
            <a
              href={whatsapp.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white"
            >
              Enviar por WhatsApp
            </a>
          ) : null}
        </div>
        {whatsapp && !whatsapp.valido ? (
          <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            No se puede armar el WhatsApp: {whatsapp.motivo}{" "}
            <Link href={`/clientes/${p.cliente.id}`} className="font-semibold underline">
              Corregir el teléfono del cliente
            </Link>
          </p>
        ) : null}
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-5 text-slate-900 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-bold">{marca.nombre}</p>
            <p className="text-sm text-slate-600">Presupuesto</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums">N° {numeroPresupuesto(p.numero, p.anio)}</p>
            <p className="text-sm text-slate-600">Fecha: {fmtFecha(p.fecha)}</p>
            <p className="text-sm text-slate-600">
              Válido hasta: {fmtFecha(p.validoHasta)} ({p.validezDias} {p.validezDias === 1 ? "día" : "días"})
            </p>
          </div>
        </header>

        <p className="mt-4 text-sm">
          <span className="text-slate-600">Para: </span>
          <span className="font-semibold">{p.cliente.nombre}</span>
        </p>

        <table className="mt-4">
          <thead>
            <tr>
              <th scope="col">Descripción</th>
              <th scope="col" className="text-right">
                Cant.
              </th>
              <th scope="col" className="text-right">
                Precio
              </th>
              <th scope="col" className="text-right">
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.id}>
                <td>{i.descripcion}</td>
                <td className="text-right tabular-nums">{fmtNumero(i.cantidad)}</td>
                <td className="text-right tabular-nums">{fmtMoneda(i.precioUnitario)}</td>
                <td className="text-right tabular-nums">{fmtMoneda(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Subtotal neto</dt>
            <dd className="tabular-nums">{fmtMoneda(p.totales.totalNeto)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>IVA</dt>
            <dd className="tabular-nums">{fmtMoneda(p.totales.totalIVA)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{fmtMoneda(p.totales.totalBruto)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-right text-xs text-slate-500">Precios con IVA incluido.</p>

        {p.observaciones ? <p className="mt-4 whitespace-pre-line border-t border-slate-200 pt-3 text-sm">{p.observaciones}</p> : null}
      </article>
    </div>
  );
}
