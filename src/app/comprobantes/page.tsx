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
  type EstadoComprobante,
  type FiltrosComprobantes,
} from "@/lib/facturacion";
import { fmtFecha, fmtMoneda } from "@/lib/money";
import { puede, requierePermisoPagina } from "@/lib/permisos";
import { getComprobantes, type ComprobanteListado } from "@/lib/queries/comprobantes";
import { estadoDemo } from "@/lib/respaldo";
import type { ParamsFecha } from "@/lib/rango-fechas";
import { Seccion, Vacio } from "@/components/ui";
import { MarcaAmbiente } from "./_componentes/marca-ambiente";
import { ResolverPendienteBoton } from "./_componentes/resolver-pendiente-boton";

export const dynamic = "force-dynamic";

const CLASE_INPUT = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const CLASE_BOTON = "inline-flex min-h-11 items-center justify-center rounded-lg bg-tinta px-4 text-sm font-semibold text-white";
const CLASE_BOTON_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700";

const ESTILO_ESTADO: Record<EstadoComprobante, string> = {
  PENDIENTE: "bg-amber-50 text-amber-800",
  EMITIDO: "bg-emerald-50 text-emerald-700",
  RECHAZADO: "bg-red-50 text-red-700",
};

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
        <Vacio mensaje="Sin base de datos" hint="Los comprobantes no existen en el modo de demostración." />
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
        titulo="Comprobantes"
        descripcion={`${pagina.total} ${pagina.total === 1 ? "comprobante" : "comprobantes"}${hayFiltros ? " con estos filtros" : ""}`}
      />

      <Filtros filtros={filtros} />

      {filtros.avisos.length > 0 ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <ul className="space-y-1">
            {filtros.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {pagina.filas.length === 0 ? (
        <Vacio
          mensaje={hayFiltros ? "Ningún comprobante cumple los filtros" : "Todavía no se emitió ningún comprobante"}
          hint={hayFiltros ? "Probá con otros filtros." : "Las facturas se emiten desde cada venta."}
        />
      ) : (
        <>
          {/* Desktop: tabla. */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white sm:block">
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
                    <td className="font-medium text-slate-900">
                      <Link href={`/comprobantes/${c.id}`} className="underline underline-offset-2">
                        {cual(c)}
                      </Link>
                    </td>
                    <td className="tabular-nums">{fmtFecha(c.fecha)}</td>
                    <td className="max-w-[16rem] truncate">{c.receptorNombre}</td>
                    <td className="tabular-nums">{fmtMoneda(c.importeTotal)}</td>
                    <td>
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[c.estado]}`}>
                        {ETIQUETA_ESTADO_COMPROBANTE[c.estado]}
                      </span>
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
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/comprobantes/${c.id}`} className="min-w-0 font-medium text-slate-900 underline underline-offset-2">
                    {cual(c)}
                  </Link>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[c.estado]}`}>
                    {ETIQUETA_ESTADO_COMPROBANTE[c.estado]}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-slate-700">{c.receptorNombre}</p>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-sm text-slate-500">{fmtFecha(c.fecha)}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{fmtMoneda(c.importeTotal)}</span>
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
            <nav aria-label="Páginas" className="mt-4 flex items-center justify-between gap-2">
              {pagina.pagina > 1 ? (
                <Link href={enlace(pagina.pagina - 1)} className={CLASE_BOTON_SECUNDARIO}>
                  &larr; Más nuevos
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-slate-600">
                Página {pagina.pagina} de {pagina.totalPaginas}
              </span>
              {pagina.pagina < pagina.totalPaginas ? (
                <Link href={enlace(pagina.pagina + 1)} className={CLASE_BOTON_SECUNDARIO}>
                  Más viejos &rarr;
                </Link>
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
    <section aria-label="Comprobantes pendientes" className="mt-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3 sm:p-4">
      <h2 className="text-sm font-semibold text-amber-900">Pendientes de respuesta del emisor</h2>
      <p className="text-sm text-amber-800">
        El emisor no respondió y no se sabe si autorizó estos comprobantes. Mientras estén pendientes no se puede volver a facturar
        sus ventas ni emitir otro del mismo tipo.
      </p>
      <ul className="space-y-3">
        {viejos.map((c) => (
          <li key={c.id} className="rounded-lg bg-white p-3">
            <p className="mb-2 text-sm font-medium text-slate-900">
              {cual(c)} · {fmtFecha(c.fecha)} · {fmtMoneda(c.importeTotal)}
            </p>
            {puedeResolver ? (
              <ResolverPendienteBoton comprobanteId={c.id} />
            ) : (
              <p className="text-sm text-slate-600">Pedile a quien factura que lo resuelva.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Filtros({ filtros }: { filtros: FiltrosComprobantes }) {
  return (
    <form method="get" action="/comprobantes" className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">
          Tipo
          <select name="tipo" defaultValue={filtros.tipo ?? ""} className={CLASE_INPUT}>
            <option value="">Todos</option>
            {TIPOS_LISTADO.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Estado
          <select name="estado" defaultValue={filtros.estado ?? ""} className={CLASE_INPUT}>
            <option value="">Todos</option>
            {ESTADOS_COMPROBANTE.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO_COMPROBANTE[e]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Ambiente
          <select name="ambiente" defaultValue={filtros.ambiente ?? ""} className={CLASE_INPUT}>
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
        <label className="text-xs font-medium text-slate-600">
          Desde
          <input type="date" name="desde" defaultValue={filtros.desdeISO ?? ""} min="2000-01-01" max="2100-12-31" className={CLASE_INPUT} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Hasta (incluido)
          <input type="date" name="hasta" defaultValue={filtros.hastaISO ?? ""} min="2000-01-01" max="2100-12-31" className={CLASE_INPUT} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={CLASE_BOTON}>
          Filtrar
        </button>
        <Link href="/comprobantes" className={CLASE_BOTON_SECUNDARIO}>
          Limpiar
        </Link>
      </div>
    </form>
  );
}
