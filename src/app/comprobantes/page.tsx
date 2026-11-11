import Link from "next/link";
import { NOMBRE_TIPO, numeroFormateado } from "@/lib/comprobantes";
import { ANTIGUEDAD_MINIMA_PENDIENTE_MS } from "@/lib/dominio/comprobantes";
import {
  AMBIENTES_COMPROBANTE,
  ESTADOS_COMPROBANTE,
  ETIQUETA_AMBIENTE,
  ETIQUETA_ESTADO_COMPROBANTE,
  parseFiltrosComprobantes,
  pendienteResoluble,
  queryDeFiltros,
  TIPOS_LISTADO,
  type FiltrosComprobantes,
} from "@/lib/facturacion";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { TONO_ESTADO } from "./[id]/_componentes/etiquetas";
import { getComprobantes, type ComprobanteListado } from "@/lib/queries/comprobantes";
import { estadoDemo } from "@/lib/respaldo";
import type { ParamsFecha } from "@/lib/rango-fechas";
import { Aviso, Boton, Etiqueta, Seccion, Vacio } from "@/components/ui";
import { MarcaAmbiente } from "./_componentes/marca-ambiente";
import { ResolverPendienteBoton } from "./_componentes/resolver-pendiente-boton";

export const dynamic = "force-dynamic";

const cual = (c: ComprobanteListado) => `${NOMBRE_TIPO[c.tipo]} ${numeroFormateado(c.puntoVenta, c.numero)}`;

/**
 * Listado de comprobantes (facturas y notas de credito). Los filtros viven en la
 * URL (`?tipo=&estado=&ambiente=&desde=&hasta=&pagina=`) y son un formulario GET:
 * el link de una busqueda se puede mandar por WhatsApp. Mas nuevos primero.
 * Solo muestra lo que tiene el comprobante (precios e impuestos): nada de costos.
 */
export default async function ComprobantesPage({ searchParams }: { searchParams: Promise<ParamsFecha> }) {
  const usuario = await requierePermisoPagina("verComprobantes");
  const filtros = parseFiltrosComprobantes(await searchParams);
  const pagina = await getComprobantes(filtros);

  if (estadoDemo().activo) {
    return (
      <>
        <Seccion titulo="Comprobantes" />
        <Vacio mensaje="Sin base de datos, sin comprobantes." hint="En el modo demostración no se emite ninguno. Conectá la base y vas a verlos acá." />
      </>
    );
  }

  const puedeResolver = puede(usuario, "emitirComprobante");
  const ahora = new Date();
  const hayFiltros = filtros.tipo || filtros.estado || filtros.ambiente || filtros.desdeISO;
  const enlace = (n: number) => {
    const q = queryDeFiltros(filtros, n);
    return q ? `/comprobantes?${q}` : "/comprobantes";
  };

  return (
    <>
      <Seccion
        epigrafe="Facturas y notas de crédito"
        titulo="Comprobantes"
        descripcion={`${pagina.total} ${pagina.total === 1 ? "comprobante" : "comprobantes"}${hayFiltros ? " con estos filtros" : ""}`}
      />

      <Filtros filtros={filtros} />

      {filtros.avisos.length > 0 ? (
        <Aviso tono="aviso" role="status" className="mb-4">
          <ul className="space-y-1">
            {filtros.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      {pagina.filas.length === 0 ? (
        <Vacio
          mensaje={hayFiltros ? "Ningún comprobante con esos filtros." : "Ni una factura emitida todavía."}
          hint={hayFiltros ? "Probá con otros filtros o limpialos para ver todo." : "Se emiten desde el detalle de cada venta."}
        />
      ) : (
        <>
          {/* Desktop: tabla. */}
          <div className="tarjeta hidden overflow-x-auto sm:block">
            <table>
              <thead>
                <tr>
                  {["Comprobante", "Fecha", "Receptor", "Total", "Estado", "Ambiente"].map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagina.filas.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/comprobantes/${c.id}`} className="enlace inline-flex min-h-11 items-center">
                        {cual(c)}
                      </Link>
                    </td>
                    <td className="tabular-nums">{fmtFecha(c.fecha)}</td>
                    <td className="max-w-64 truncate">{c.receptorNombre}</td>
                    <td className="font-semibold tabular-nums text-ink">{fmtMoneda(c.importeTotal)}</td>
                    <td>
                      <Etiqueta tono={TONO_ESTADO[c.estado]}>{ETIQUETA_ESTADO_COMPROBANTE[c.estado]}</Etiqueta>
                    </td>
                    <td>
                      <MarcaAmbiente ambiente={c.ambiente} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: una tarjeta por comprobante. */}
          <ul className="space-y-2 sm:hidden">
            {pagina.filas.map((c) => (
              <li key={c.id} className="tarjeta p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/comprobantes/${c.id}`} className="enlace inline-flex min-h-11 min-w-0 items-center">
                    {cual(c)}
                  </Link>
                  <Etiqueta tono={TONO_ESTADO[c.estado]} className="shrink-0">
                    {ETIQUETA_ESTADO_COMPROBANTE[c.estado]}
                  </Etiqueta>
                </div>
                <p className="break-words text-body text-ink">{c.receptorNombre}</p>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-body-sm text-ink-muted">{fmtFecha(c.fecha)}</span>
                  <span className="monto-fila text-ink">{fmtMoneda(c.importeTotal)}</span>
                </div>
                <div className="mt-2">
                  <MarcaAmbiente ambiente={c.ambiente} />
                </div>
              </li>
            ))}
          </ul>

          {/* Un PENDIENTE viejo: el emisor no respondio y hay que consultarlo. */}
          <PendientesViejos filas={pagina.filas} ahora={ahora} puedeResolver={puedeResolver} />

          {pagina.totalPaginas > 1 ? (
            <nav aria-label="Páginas" className="mt-6 flex items-center justify-between gap-3">
              {pagina.pagina > 1 ? (
                <Boton href={enlace(pagina.pagina - 1)} variante="secundario">
                  &larr; Más nuevos
                </Boton>
              ) : (
                <span />
              )}
              <span className="text-body-sm text-ink-muted">
                Página {pagina.pagina} de {pagina.totalPaginas}
              </span>
              {pagina.pagina < pagina.totalPaginas ? (
                <Boton href={enlace(pagina.pagina + 1)} variante="secundario">
                  Más viejos &rarr;
                </Boton>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

function PendientesViejos({ filas, ahora, puedeResolver }: { filas: ComprobanteListado[]; ahora: Date; puedeResolver: boolean }) {
  const viejos = filas.filter((c) => c.estado === "PENDIENTE" && pendienteResoluble(c.creadoEn, ahora, ANTIGUEDAD_MINIMA_PENDIENTE_MS));
  if (viejos.length === 0) return null;
  return (
    <section aria-label="Comprobantes pendientes" className="borde mt-6 space-y-3 rounded-lg border-aviso-line bg-aviso-soft p-4 sm:p-6">
      <h2 className="font-display text-body-lg font-bold text-aviso-text">Pendientes de respuesta del emisor</h2>
      <p className="text-body-sm text-ink">
        El emisor no respondió y no sabemos si autorizó estos comprobantes. Mientras estén pendientes no se puede volver a facturar
        sus ventas ni emitir otro del mismo tipo.
      </p>
      <ul className="space-y-3">
        {viejos.map((c) => (
          <li key={c.id} className="tarjeta p-3 sm:p-4">
            <p className="mb-2 text-body font-semibold text-ink">
              {cual(c)} · {fmtFecha(c.fecha)} · <span className="tabular-nums">{fmtMoneda(c.importeTotal)}</span>
            </p>
            {puedeResolver ? (
              <ResolverPendienteBoton comprobanteId={c.id} />
            ) : (
              <p className="text-body-sm text-ink-muted">Pedile a quien factura que lo resuelva.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Filtros({ filtros }: { filtros: FiltrosComprobantes }) {
  return (
    <form method="get" action="/comprobantes" className="tarjeta mb-4 space-y-3 p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label>
          Tipo
          <select name="tipo" defaultValue={filtros.tipo ?? ""} className="mt-1 font-normal">
            <option value="">Todos</option>
            {TIPOS_LISTADO.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select name="estado" defaultValue={filtros.estado ?? ""} className="mt-1 font-normal">
            <option value="">Todos</option>
            {ESTADOS_COMPROBANTE.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO_COMPROBANTE[e]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ambiente
          <select name="ambiente" defaultValue={filtros.ambiente ?? ""} className="mt-1 font-normal">
            <option value="">Todos</option>
            {AMBIENTES_COMPROBANTE.map((a) => (
              <option key={a} value={a}>
                {ETIQUETA_AMBIENTE[a]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          Desde
          <input type="date" name="desde" defaultValue={filtros.desdeISO ?? ""} min="2000-01-01" max="2100-12-31" className="mt-1 font-normal" />
        </label>
        <label>
          Hasta (incluido)
          <input type="date" name="hasta" defaultValue={filtros.hastaISO ?? ""} min="2000-01-01" max="2100-12-31" className="mt-1 font-normal" />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <Boton type="submit">Filtrar</Boton>
        <Boton href="/comprobantes" variante="secundario">
          Limpiar
        </Boton>
      </div>
    </form>
  );
}
