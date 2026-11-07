import Link from "next/link";
import { notFound } from "next/navigation";
import { discriminaIva, esNotaCredito, letraDe, NOMBRE_TIPO, numeroFormateado } from "@/lib/comprobantes";
import { formatearCuit } from "@/lib/cuit";
import { fmtFecha, fmtMoneda, fmtNumero, fmtPorcentaje } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { getComprobante, type ComprobanteRef } from "@/lib/queries/comprobante";
import { Aviso, Boton, Etiqueta, Seccion } from "@/components/ui";
import {
  codigoDe,
  ETIQUETA_AMBIENTE,
  ETIQUETA_CONDICION_IVA,
  ETIQUETA_ESTADO,
  TONO_ESTADO,
  fmtUnitario,
  textoDocumento,
} from "./_componentes/etiquetas";
import { FranjaSinValidez } from "./_componentes/marca-sin-validez";

export const dynamic = "force-dynamic";

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
        epigrafe="Comprobante"
        titulo={`${NOMBRE_TIPO[c.tipo]} ${nroCompleto}`}
        descripcion={`${c.receptor.nombre} · ${fmtFecha(c.fecha)}`}
        accion={
          <Boton href="/comprobantes" variante="secundario">
            Volver
          </Boton>
        }
      />

      <FranjaSinValidez ambiente={c.ambiente} variante="app" className="mb-4 rounded-md" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Etiqueta tono={TONO_ESTADO[c.estado]}>{ETIQUETA_ESTADO[c.estado]}</Etiqueta>
        <Boton href={`/comprobantes/${c.id}/imprimir`}>Ver para imprimir</Boton>
      </div>

      {c.estado === "RECHAZADO" ? (
        <Aviso tono="critico" titulo="El emisor rechazó este comprobante." className="mb-4">
          {c.observaciones ? <p className="break-words whitespace-pre-line">{c.observaciones}</p> : null}
          <p className={c.observaciones ? "mt-1" : ""}>No tiene validez fiscal: revisá el motivo y volvé a intentarlo desde la venta.</p>
        </Aviso>
      ) : c.estado === "PENDIENTE" ? (
        <Aviso tono="aviso" titulo="Pendiente de autorización: todavía no tiene CAE." className="mb-4">
          {c.observaciones ? <p className="break-words whitespace-pre-line">{c.observaciones}</p> : null}
          <p className={c.observaciones ? "mt-1" : ""}>Hasta que lo autorice el emisor no vale como comprobante.</p>
        </Aviso>
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
                <Link href={`/ventas/${c.venta.id}`} className="enlace">
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
          <Dato etiqueta="Total" valor={<span className="monto">{fmtMoneda(c.importeTotal)}</span>} />
        </Bloque>
      </div>

      <Bloque titulo="Detalle" className="mt-4" datos={false}>
        <ul className="divide-y-(length:--border-width) divide-line">
          {c.items.map((i) => (
            <li key={i.orden} className="flex items-baseline justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-semibold break-words text-ink">{i.descripcion}</p>
                <p className="text-body-sm text-ink-muted tabular-nums">
                  {fmtNumero(i.cantidad)} × {fmtUnitario(i.precioUnitario)}
                  {discrimina ? ` · IVA ${fmtPorcentaje(i.ivaPct)}` : ""}
                </p>
              </div>
              <span className="monto-fila shrink-0">{fmtMoneda(i.subtotalBruto)}</span>
            </li>
          ))}
        </ul>
      </Bloque>

      {esNotaCredito(c.tipo) && c.comprobanteAsociado ? (
        <Bloque titulo="Factura que anula" className="mt-4" datos={false}>
          <Enlace r={c.comprobanteAsociado} />
        </Bloque>
      ) : null}

      {c.notasDeCredito.length > 0 ? (
        <Bloque titulo="Notas de crédito relacionadas" className="mt-4" datos={false}>
          <ul className="space-y-2">
            {c.notasDeCredito.map((nc) => (
              <li key={nc.id}>
                <Enlace r={nc} />
              </li>
            ))}
          </ul>
        </Bloque>
      ) : null}

      <p className="mt-4 text-body-sm text-ink-muted">
        Letra {letraDe(c.tipo)}. Todo lo que se muestra sale de los datos guardados al emitir: no cambia aunque después se edite el cliente, el artículo o la configuración.
      </p>
    </>
  );
}

function Enlace({ r }: { r: ComprobanteRef }) {
  return (
    <Link
      href={`/comprobantes/${r.id}`}
      className="borde flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border-line px-3 py-2 hover:bg-surface-sunken"
    >
      <span className="enlace">
        {NOMBRE_TIPO[r.tipo]} {numeroFormateado(r.puntoVenta, r.numero)}
      </span>
      <span className="flex items-center gap-2 text-body-sm tabular-nums text-ink-muted">
        {fmtFecha(r.fecha)} · {fmtMoneda(r.importeTotal)}
        <Etiqueta tono={TONO_ESTADO[r.estado]}>{ETIQUETA_ESTADO[r.estado]}</Etiqueta>
      </span>
    </Link>
  );
}

/** Bloque con título. Por defecto sus hijos son pares `Dato` (una lista de definición); `datos={false}` para otro contenido. */
function Bloque({ titulo, children, className = "", datos = true }: { titulo: string; children: React.ReactNode; className?: string; datos?: boolean }) {
  return (
    <section className={`tarjeta min-w-0 p-4 sm:p-6 ${className}`}>
      <h2 className="eyebrow mb-3">{titulo}</h2>
      {datos ? <dl className="space-y-2 text-body">{children}</dl> : children}
    </section>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-body-sm text-ink-muted">{etiqueta}</dt>
      <dd className="min-w-0 text-right break-words tabular-nums text-ink">{valor}</dd>
    </div>
  );
}
