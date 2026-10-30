import { formatearCuit } from "@/lib/cuit";
import { discriminaIva, esNotaCredito, letraDe, NOMBRE_TIPO, numeroFormateado } from "@/lib/comprobantes";
import { aCosto, fmtFecha, fmtNumero, fmtPorcentaje } from "@/lib/money";
import { svgQr } from "@/lib/qr-fiscal";
import type { ComprobanteCompleto } from "@/lib/queries/comprobante";
import {
  codigoDe,
  ETIQUETA_CONDICION_IVA,
  ETIQUETA_AMBIENTE,
  fmtMoneda,
  fmtUnitario,
  LEYENDA_TRANSPARENCIA,
  textoDocumento,
  tituloDeTipo,
} from "./etiquetas";
import { FranjaSinValidez, SelloSinValidez, sinValidezFiscal } from "./marca-sin-validez";

/**
 * El comprobante tal como se imprime. Todo sale de la FOTO guardada (emisor,
 * receptor, líneas, alícuotas): nunca del cliente, la venta o la configuración
 * actuales. Server component: el QR es un SVG armado acá, idéntico en pantalla,
 * al imprimir y en el PDF.
 */
export async function DocumentoComprobante({ c }: { c: ComprobanteCompleto }) {
  const letra = letraDe(c.tipo);
  const discrimina = discriminaIva(c.tipo);
  const esNc = esNotaCredito(c.tipo);
  const emitido = c.estado === "EMITIDO" && c.cae !== null && c.caeVencimiento !== null;
  const marca = sinValidezFiscal(c.ambiente);

  let qr: string | null = null;
  let qrError = false;
  if (emitido) {
    try {
      qr = await svgQr({
        fecha: c.fecha,
        cuitEmisor: c.emisor.cuit,
        puntoVenta: c.puntoVenta,
        codigoTipo: c.codigoArca,
        numero: c.numero,
        importeTotal: c.importeTotal,
        docTipoReceptor: c.receptor.docTipo,
        docNroReceptor: c.receptor.docNro,
        cae: c.cae!,
      });
    } catch (error) {
      console.error("[comprobante] No se pudo armar el QR fiscal:", error);
      qrError = true;
    }
  }

  const nroCompleto = numeroFormateado(c.puntoVenta, c.numero);

  return (
    <article
      data-comprobante={c.id}
      className="documento relative mx-auto w-full max-w-[210mm] border border-slate-400 bg-white text-sm text-slate-900"
    >
      <SelloSinValidez ambiente={c.ambiente} />
      <FranjaSinValidez ambiente={c.ambiente} />

      {/* Encabezado: tipo y letra, datos del comprobante. */}
      <header className="grid gap-0 border-b border-slate-400 sm:grid-cols-[1fr_auto_1fr]">
        <div className="p-3 sm:order-1">
          <p className="text-lg leading-tight font-bold">{c.emisor.razonSocial}</p>
          <p className="mt-1 text-slate-700">{c.emisor.domicilio}</p>
          <p className="mt-1 font-medium">{ETIQUETA_CONDICION_IVA[c.emisor.condicionIva]}</p>
        </div>

        <div className="flex flex-col items-center justify-center border-y border-slate-400 px-4 py-2 sm:order-2 sm:border-x sm:border-y-0">
          <div className="flex h-14 w-14 flex-col items-center justify-center border-2 border-slate-900">
            <span className="text-3xl leading-none font-black">{letra}</span>
          </div>
          <span className="mt-1 text-xs font-semibold">Cód. {codigoDe(c.codigoArca)}</span>
        </div>

        <div className="p-3 sm:order-3">
          <p className="text-lg leading-tight font-bold uppercase">{tituloDeTipo(c.tipo)}</p>
          <p className="mt-1 text-base font-semibold tabular-nums">N° {nroCompleto}</p>
          <p className="tabular-nums">Fecha de emisión: {fmtFecha(c.fecha)}</p>
          <dl className="mt-1 space-y-0.5 text-slate-700">
            <div className="flex flex-wrap gap-x-1">
              <dt>CUIT:</dt>
              <dd className="tabular-nums">{formatearCuit(c.emisor.cuit)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-1">
              <dt>Ingresos Brutos:</dt>
              <dd className="tabular-nums">{c.emisor.iibb ?? "No informado"}</dd>
            </div>
            <div className="flex flex-wrap gap-x-1">
              <dt>Inicio de actividades:</dt>
              <dd className="tabular-nums">{fmtFecha(c.emisor.inicioActividades)}</dd>
            </div>
          </dl>
        </div>
      </header>

      {/* Receptor. */}
      <section aria-label="Receptor" className="border-b border-slate-400 p-3">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Cliente</h2>
        <p className="mt-0.5 text-base font-semibold">{c.receptor.nombre}</p>
        <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-1">
            <dt className="text-slate-600">Documento:</dt>
            <dd className="tabular-nums">{textoDocumento(c.receptor.docTipo, c.receptor.docNro)}</dd>
          </div>
          <div className="flex flex-wrap gap-x-1">
            <dt className="text-slate-600">Condición frente al IVA:</dt>
            <dd>{ETIQUETA_CONDICION_IVA[c.receptor.condicionIva]}</dd>
          </div>
          {c.receptor.domicilio ? (
            <div className="flex flex-wrap gap-x-1 sm:col-span-2">
              <dt className="text-slate-600">Domicilio:</dt>
              <dd>{c.receptor.domicilio}</dd>
            </div>
          ) : null}
        </dl>
        {esNc && c.comprobanteAsociado ? (
          <p className="mt-2 rounded border border-slate-400 bg-slate-50 px-2 py-1 font-medium" data-asociado>
            Comprobante asociado: {NOMBRE_TIPO[c.comprobanteAsociado.tipo]} N°{" "}
            {numeroFormateado(c.comprobanteAsociado.puntoVenta, c.comprobanteAsociado.numero)} del {fmtFecha(c.comprobanteAsociado.fecha)}
          </p>
        ) : null}
      </section>

      {/* Líneas: en celular una lista, desde sm una tabla (también en la hoja impresa). */}
      <section aria-label="Detalle" className="border-b border-slate-400">
        <ul className="divide-y divide-slate-200 sm:hidden">
          {c.items.map((i) => (
            <li key={i.orden} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 font-medium break-words">{i.descripcion}</span>
                <span className="shrink-0 font-semibold tabular-nums">{fmtMoneda(discrimina && letra === "A" ? i.subtotalNeto : i.subtotalBruto)}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-600 tabular-nums">
                {fmtNumero(i.cantidad)} × {fmtUnitario(precioMostrado(i, letra))}
                {letra === "A" ? ` + IVA ${fmtPorcentaje(i.ivaPct)}` : ""}
              </p>
            </li>
          ))}
        </ul>

        <table className="hidden sm:table">
          <thead className="bg-slate-100">
            <tr>
              <th scope="col" className="w-12 text-right">Cant.</th>
              <th scope="col">Descripción</th>
              <th scope="col" className="text-right">{letra === "A" ? "Precio unit. neto" : "Precio unit."}</th>
              {letra === "A" ? <th scope="col" className="text-right">Alíc. IVA</th> : null}
              <th scope="col" className="text-right">{letra === "A" ? "Subtotal neto" : "Subtotal"}</th>
              {letra === "A" ? <th scope="col" className="text-right">Subtotal c/IVA</th> : null}
            </tr>
          </thead>
          <tbody>
            {c.items.map((i) => (
              <tr key={i.orden}>
                <td className="text-right tabular-nums">{fmtNumero(i.cantidad)}</td>
                <td className="break-words">{i.descripcion}</td>
                <td className="text-right tabular-nums">{fmtUnitario(precioMostrado(i, letra))}</td>
                {letra === "A" ? <td className="text-right tabular-nums">{fmtPorcentaje(i.ivaPct)}</td> : null}
                <td className="text-right tabular-nums">{fmtMoneda(letra === "A" ? i.subtotalNeto : i.subtotalBruto)}</td>
                {letra === "A" ? <td className="text-right tabular-nums">{fmtMoneda(i.subtotalBruto)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Totales. */}
      <section aria-label="Totales" className="border-b border-slate-400 p-3">
        <dl className="ml-auto max-w-sm space-y-1 tabular-nums">
          {letra === "A" ? (
            <>
              <Fila etiqueta="Importe neto gravado" valor={fmtMoneda(c.importeNeto)} />
              {c.alicuotas.map((a) => (
                <Fila key={a.codigoArca} etiqueta={`IVA ${fmtPorcentaje(a.alicuotaPct)}`} valor={fmtMoneda(a.importe)} suave />
              ))}
              <Fila etiqueta="Importe total" valor={fmtMoneda(c.importeTotal)} fuerte />
            </>
          ) : (
            <Fila etiqueta="Importe total" valor={fmtMoneda(c.importeTotal)} fuerte />
          )}
        </dl>

        {letra === "B" ? (
          // Régimen de transparencia fiscal (VERIFICAR CON EL CONTADOR: ver etiquetas.ts).
          <div className="mt-3 rounded border border-slate-300 bg-slate-50 p-2 text-xs text-slate-700" data-transparencia>
            <p className="font-semibold">{LEYENDA_TRANSPARENCIA}</p>
            <p className="tabular-nums">IVA contenido: {fmtMoneda(c.importeIva)}</p>
            <p className="tabular-nums">Otros impuestos nacionales indirectos: {fmtMoneda(0)}</p>
          </div>
        ) : null}
      </section>

      {/* Autorización: CAE y QR, o la leyenda del estado. */}
      <section aria-label="Autorización" className="p-3">
        {emitido ? (
          <div className="flex flex-wrap items-center gap-4">
            {qr ? (
              <div
                role="img"
                aria-label="Código QR de la factura electrónica"
                data-qr
                className="relative z-20 h-32 w-32 shrink-0 bg-white [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            ) : qrError ? (
              <p className="max-w-[10rem] text-xs text-red-700">No se pudo generar el código QR.</p>
            ) : null}
            <dl className="min-w-0 space-y-1 tabular-nums">
              <div className="flex flex-wrap gap-x-1">
                <dt className="font-semibold">CAE N°:</dt>
                <dd className="break-all">{c.cae}</dd>
              </div>
              <div className="flex flex-wrap gap-x-1">
                <dt className="font-semibold">Fecha de vencimiento del CAE:</dt>
                <dd>{fmtFecha(c.caeVencimiento)}</dd>
              </div>
            </dl>
          </div>
        ) : c.estado === "RECHAZADO" ? (
          <div className="rounded border-2 border-red-700 bg-red-50 p-3 text-red-900" data-leyenda="rechazado">
            <p className="font-bold">Comprobante rechazado</p>
            <p>No tiene CAE: no fue autorizado y no es válido como comprobante.</p>
            {c.observaciones ? <p className="mt-1 break-words whitespace-pre-line">Observaciones: {c.observaciones}</p> : null}
          </div>
        ) : (
          <div className="rounded border-2 border-amber-600 bg-amber-50 p-3 text-amber-900" data-leyenda="pendiente">
            <p className="font-bold">Comprobante pendiente de autorización</p>
            <p>Todavía no tiene CAE: no es válido como comprobante hasta que se autorice.</p>
            {c.observaciones ? <p className="mt-1 break-words whitespace-pre-line">Observaciones: {c.observaciones}</p> : null}
          </div>
        )}
      </section>

      {marca ? (
        <FranjaSinValidez ambiente={c.ambiente} className="pie-sin-validez" />
      ) : null}

      <footer className="border-t border-slate-300 px-3 py-1 text-[11px] text-slate-500">
        {NOMBRE_TIPO[c.tipo]} {nroCompleto} · Ambiente: {ETIQUETA_AMBIENTE[c.ambiente]}
      </footer>
    </article>
  );
}

/** Precio unitario que se muestra: neto en la A (derivado del subtotal neto guardado), con IVA incluido en B y C. */
function precioMostrado(i: ComprobanteCompleto["items"][number], letra: "A" | "B" | "C") {
  if (letra === "A") return aCosto(i.subtotalNeto.div(i.cantidad));
  return i.precioUnitario;
}

function Fila({ etiqueta, valor, fuerte, suave }: { etiqueta: string; valor: string; fuerte?: boolean; suave?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${fuerte ? "border-t border-slate-400 pt-1 text-base font-bold" : ""} ${suave ? "text-slate-700" : ""}`}>
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}
