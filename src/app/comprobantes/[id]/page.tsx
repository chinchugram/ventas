import Link from "next/link";
import { notFound } from "next/navigation";
import { discriminaIva, esNotaCredito, letraDe, NOMBRE_TIPO, numeroFormateado } from "@/lib/comprobantes";
import { formatearCuit } from "@/lib/cuit";
import { fmtFecha, fmtMoneda, fmtNumero, fmtPorcentaje } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { getComprobante, type ComprobanteRef } from "@/lib/queries/comprobante";
import { Seccion } from "@/components/ui";
import {
  codigoDe,
  ESTILO_ESTADO,
  ETIQUETA_AMBIENTE,
  ETIQUETA_CONDICION_IVA,
  ETIQUETA_ESTADO,
  fmtUnitario,
  textoDocumento,
} from "./_componentes/etiquetas";
import { FranjaSinValidez } from "./_componentes/marca-sin-validez";

export const dynamic = "force-dynamic";

const BOTON = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold";

export default async function ComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requierePermisoPagina("verComprobantes");
  const { id } = await params;
  const c = await getComprobante(id);
  if (!c) notFound();

  const puedeVerVenta = puede(usuario, "verVentas");
  const nroCompleto = numeroFormateado(c.puntoVenta, c.numero);
  const discrimina = discriminaIva(c.tipo);

  return (
    <>
      <Seccion
        titulo={`${NOMBRE_TIPO[c.tipo]} ${nroCompleto}`}
        descripcion={`${c.receptor.nombre} · ${fmtFecha(c.fecha)}`}
        accion={
          <Link href="/comprobantes" className={`${BOTON} border border-slate-300 bg-white font-medium text-slate-700`}>
            Volver
          </Link>
        }
      />

      <FranjaSinValidez ambiente={c.ambiente} className="mb-4 rounded-lg" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`inline-block rounded-md px-2 py-1 text-sm font-semibold ${ESTILO_ESTADO[c.estado]}`}>{ETIQUETA_ESTADO[c.estado]}</span>
        <Link href={`/comprobantes/${c.id}/imprimir`} className={`${BOTON} bg-marca text-tinta active:opacity-80`}>
          Ver para imprimir
        </Link>
      </div>

      {c.estado === "RECHAZADO" ? (
        <Aviso tono="critico" titulo="El emisor rechazó este comprobante" texto={c.observaciones} />
      ) : c.estado === "PENDIENTE" ? (
        <Aviso tono="aviso" titulo="Pendiente de autorización: todavía no tiene CAE" texto={c.observaciones} />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Bloque titulo="Comprobante">
          <Dato etiqueta="Tipo" valor={`${NOMBRE_TIPO[c.tipo]} (Cód. ${codigoDe(c.codigoArca)})`} />
          <Dato etiqueta="Número" valor={nroCompleto} />
          <Dato etiqueta="Fecha" valor={fmtFecha(c.fecha)} />
          <Dato etiqueta="Ambiente" valor={ETIQUETA_AMBIENTE[c.ambiente]} />
          <Dato etiqueta="CAE" valor={c.cae ?? "—"} />
          <Dato etiqueta="Vencimiento del CAE" valor={c.caeVencimiento ? fmtFecha(c.caeVencimiento) : "—"} />
          <Dato etiqueta="Emitido por" valor={c.emitidoPor ?? "—"} />
          <Dato
            etiqueta="Venta de origen"
            valor={
              puedeVerVenta ? (
                <Link href={`/ventas/${c.venta.id}`} className="font-medium text-marca-texto underline">
                  Venta #{c.venta.numero}/{c.venta.anio}
                </Link>
              ) : (
                `Venta #${c.venta.numero}/${c.venta.anio}`
              )
            }
          />
        </Bloque>

        <Bloque titulo="Emisor (al momento de emitir)">
          <Dato etiqueta="Razón social" valor={c.emisor.razonSocial} />
          <Dato etiqueta="CUIT" valor={formatearCuit(c.emisor.cuit)} />
          <Dato etiqueta="Condición IVA" valor={ETIQUETA_CONDICION_IVA[c.emisor.condicionIva]} />
          <Dato etiqueta="Domicilio" valor={c.emisor.domicilio} />
          <Dato etiqueta="Ingresos Brutos" valor={c.emisor.iibb ?? "No informado"} />
          <Dato etiqueta="Inicio de actividades" valor={fmtFecha(c.emisor.inicioActividades)} />
        </Bloque>

        <Bloque titulo="Receptor (al momento de emitir)">
          <Dato etiqueta="Nombre" valor={c.receptor.nombre} />
          <Dato etiqueta="Documento" valor={textoDocumento(c.receptor.docTipo, c.receptor.docNro)} />
          <Dato etiqueta="Condición IVA" valor={ETIQUETA_CONDICION_IVA[c.receptor.condicionIva]} />
          <Dato etiqueta="Domicilio" valor={c.receptor.domicilio ?? "—"} />
        </Bloque>

        <Bloque titulo="Importes">
          {discrimina ? <Dato etiqueta="Neto gravado" valor={fmtMoneda(c.importeNeto)} /> : null}
          {discrimina
            ? c.alicuotas.map((a) => (
                <Dato key={a.codigoArca} etiqueta={`IVA ${fmtPorcentaje(a.alicuotaPct)} (base ${fmtMoneda(a.baseImponible)})`} valor={fmtMoneda(a.importe)} />
              ))
            : null}
          {discrimina ? <Dato etiqueta="IVA total" valor={fmtMoneda(c.importeIva)} /> : null}
          <Dato etiqueta="Total" valor={<strong>{fmtMoneda(c.importeTotal)}</strong>} />
        </Bloque>
      </div>

      <Bloque titulo="Detalle" className="mt-4">
        <ul className="divide-y divide-slate-100">
          {c.items.map((i) => (
            <li key={i.orden} className="flex items-baseline justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium break-words">{i.descripcion}</p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {fmtNumero(i.cantidad)} × {fmtUnitario(i.precioUnitario)}
                  {discrimina ? ` · IVA ${fmtPorcentaje(i.ivaPct)}` : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">{fmtMoneda(i.subtotalBruto)}</span>
            </li>
          ))}
        </ul>
      </Bloque>

      {esNotaCredito(c.tipo) && c.comprobanteAsociado ? (
        <Bloque titulo="Factura que anula" className="mt-4">
          <Enlace r={c.comprobanteAsociado} />
        </Bloque>
      ) : null}

      {c.notasDeCredito.length > 0 ? (
        <Bloque titulo="Notas de crédito relacionadas" className="mt-4">
          <ul className="space-y-2">
            {c.notasDeCredito.map((nc) => (
              <li key={nc.id}>
                <Enlace r={nc} />
              </li>
            ))}
          </ul>
        </Bloque>
      ) : null}

      <p className="mt-4 text-xs text-slate-500">
        Letra {letraDe(c.tipo)}. Todo lo que se muestra sale de los datos guardados al emitir: no cambia aunque después se edite el cliente, el artículo o la configuración.
      </p>
    </>
  );
}

function Enlace({ r }: { r: ComprobanteRef }) {
  return (
    <Link href={`/comprobantes/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 active:bg-slate-50">
      <span className="font-medium text-marca-texto underline">
        {NOMBRE_TIPO[r.tipo]} {numeroFormateado(r.puntoVenta, r.numero)}
      </span>
      <span className="flex items-center gap-2 text-sm tabular-nums">
        {fmtFecha(r.fecha)} · {fmtMoneda(r.importeTotal)}
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[r.estado]}`}>{ETIQUETA_ESTADO[r.estado]}</span>
      </span>
    </Link>
  );
}

function Bloque({ titulo, children, className = "" }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 ${className}`}>
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{titulo}</h2>
      <dl className="space-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-slate-600">{etiqueta}</dt>
      <dd className="min-w-0 text-right break-words tabular-nums">{valor}</dd>
    </div>
  );
}

function Aviso({ tono, titulo, texto }: { tono: "critico" | "aviso"; titulo: string; texto: string | null }) {
  const clase = tono === "critico" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div role="note" className={`mb-4 rounded-lg border p-3 text-sm ${clase}`}>
      <p className="font-semibold">{titulo}</p>
      {texto ? <p className="mt-1 break-words whitespace-pre-line">{texto}</p> : null}
    </div>
  );
}
