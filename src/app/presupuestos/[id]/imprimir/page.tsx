import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/money";
import { enlaceWhatsApp } from "@/lib/recordatorios-cobranza";
import { mensajeWhatsAppPresupuesto, numeroPresupuesto } from "@/lib/presupuestos";
import { getMarca } from "@/lib/marca";
import { getPresupuesto } from "@/lib/queries/presupuestos";
import { estadoDemo } from "@/lib/respaldo";
import { requierePermisoPagina } from "@/lib/permisos";
import { Aviso, Boton, claseBoton } from "@/components/ui";
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
  await requierePermisoPagina("verPresupuestos");
  const { id } = await params;
  const [p, marca] = await Promise.all([getPresupuesto(id), getMarca()]);
  if (!p) {
    if (estadoDemo().activo) return <SinBase />;
    notFound();
  }

  const volver = (
    <Boton href={`/presupuestos/${p.id}`} variante="secundario">
      Volver
    </Boton>
  );

  if (p.estado === "ANULADO") {
    return (
      <div className="space-y-4">
        <Aviso tono="info" role="status">
          Este presupuesto está anulado: no se imprime ni se envía.
        </Aviso>
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
          <Aviso tono="aviso" titulo={`Este presupuesto venció el ${fmtFecha(p.validoHasta)}.`} role="status">
            No lo envíes así: duplicalo desde el detalle para actualizar los precios.
          </Aviso>
        ) : null}
        {p.estado === "CONVERTIDO" ? (
          <Aviso tono="ok" role="status">
            Este presupuesto ya se convirtió en venta.
          </Aviso>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {volver}
          <BotonImprimir />
          {whatsapp?.valido ? (
            <a href={whatsapp.url} target="_blank" rel="noopener noreferrer" className={claseBoton()}>
              Enviar por WhatsApp
            </a>
          ) : null}
        </div>
        {whatsapp && !whatsapp.valido ? (
          <Aviso tono="aviso" titulo="No pudimos armar el WhatsApp." role="status">
            {whatsapp.motivo}{" "}
            <Link href={`/clientes/${p.cliente.id}`} className="enlace inline-flex min-h-11 items-center">
              Corregir el teléfono del cliente
            </Link>
          </Aviso>
        ) : null}
      </div>

      <article className="tema-documento rounded-lg border border-line bg-surface p-5 text-ink print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="text-lg font-bold">{marca.nombre}</p>
            <p className="text-sm text-ink-muted">Presupuesto</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums">N° {numeroPresupuesto(p.numero, p.anio)}</p>
            <p className="text-sm text-ink-muted">Fecha: {fmtFecha(p.fecha)}</p>
            <p className="text-sm text-ink-muted">
              Válido hasta: {fmtFecha(p.validoHasta)} ({p.validezDias} {p.validezDias === 1 ? "día" : "días"})
            </p>
          </div>
        </header>

        <p className="mt-4 text-sm">
          <span className="text-ink-muted">Para: </span>
          <span className="font-semibold">{p.cliente.nombre}</span>
        </p>

        <div className="mt-4 overflow-x-auto">
        <table>
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
        </div>

        <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between text-ink-muted">
            <dt>Subtotal neto</dt>
            <dd className="tabular-nums">{fmtMoneda(p.totales.totalNeto)}</dd>
          </div>
          <div className="flex justify-between text-ink-muted">
            <dt>IVA</dt>
            <dd className="tabular-nums">{fmtMoneda(p.totales.totalIVA)}</dd>
          </div>
          <div className="flex justify-between border-t border-line-strong pt-1 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{fmtMoneda(p.totales.totalBruto)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-right text-xs text-ink-muted">Precios con IVA incluido.</p>

        {p.observaciones ? <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-sm">{p.observaciones}</p> : null}
      </article>
    </div>
  );
}
