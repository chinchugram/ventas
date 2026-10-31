import Link from "next/link";
import { Seccion, Vacio } from "@/components/ui";
import { fmtFecha, fmtNumero } from "@/lib/money";
import { requierePermisoPagina } from "@/lib/permisos";
import { ETIQUETA_FILTRO, FILTROS_PRODUCCION, parsearBusqueda, parsearFiltro, type FiltroProduccion } from "@/lib/produccion";
import { getListadoProduccion } from "@/lib/queries/produccion";

// Depende de lo que se cargue en el taller: nunca se cachea.
export const dynamic = "force-dynamic";

const BOTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition-transform active:scale-[0.98]";

function hrefFiltro(filtro: FiltroProduccion, q: string) {
  const params = new URLSearchParams();
  if (filtro !== "pendientes") params.set("estado", filtro);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `/produccion?${qs}` : "/produccion";
}

export default async function ProduccionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requierePermisoPagina("cargarProduccion");
  const params = await searchParams;
  const filtro = parsearFiltro(params.estado);
  const q = parsearBusqueda(params.q);
  const { lineas, cuenta, hayMas } = await getListadoProduccion(filtro, q);

  const cantidadDe = (f: FiltroProduccion) => (f === "pendientes" ? cuenta.pendientes : f === "cargadas" ? cuenta.cargadas : cuenta.pendientes + cuenta.cargadas);

  return (
    <>
      <Seccion
        titulo="Producción"
        descripcion="Cargá lo que realmente se usó en cada trabajo: minutos de máquina, mano de obra y materiales"
        accion={
          <Link href="/produccion/estimar" className={`${BOTON} border border-slate-300 bg-white text-slate-800`}>
            Estimar tiempos
          </Link>
        }
      />

      <nav aria-label="Filtro" className="mb-3 flex flex-wrap gap-2">
        {FILTROS_PRODUCCION.map((f) => (
          <Link
            key={f}
            href={hrefFiltro(f, q)}
            aria-current={f === filtro ? "page" : undefined}
            className={`${BOTON} ${f === filtro ? "bg-tinta text-white" : "border border-slate-300 bg-white text-slate-800"}`}
          >
            {ETIQUETA_FILTRO[f]} ({cantidadDe(f)})
          </Link>
        ))}
      </nav>

      <form action="/produccion" method="get" role="search" className="mb-4 flex gap-2">
        {filtro !== "pendientes" ? <input type="hidden" name="estado" value={filtro} /> : null}
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="sr-only">
            Buscar por cliente, artículo o número de venta
          </label>
          <input id="q" name="q" type="search" defaultValue={q} maxLength={60} placeholder="Cliente, artículo o n.º" />
        </div>
        <button type="submit" className={`${BOTON} border border-slate-300 bg-white text-slate-800`}>
          Buscar
        </button>
      </form>

      {lineas.length === 0 ? (
        <Vacio
          mensaje={q ? "No hay líneas con esa búsqueda" : filtro === "cargadas" ? "Todavía no se cargó ningún trabajo" : "No hay líneas para mostrar"}
          hint={filtro === "pendientes" && !q ? "Todas las líneas de ventas vigentes tienen su trabajo cargado." : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {lineas.map((l) => (
            <li key={l.ventaItemId} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words text-slate-900">{l.descripcion}</p>
                  <p className="text-sm text-slate-600">
                    {fmtNumero(l.cantidad)} u · {l.cliente}
                  </p>
                  <p className="text-xs text-slate-500">
                    Venta #{l.numero}/{l.anio} · {fmtFecha(l.fecha)}
                  </p>
                </div>
                {l.trabajo ? (
                  <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">Cargado</span>
                ) : (
                  <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Sin cargar</span>
                )}
              </div>
              {l.trabajo ? (
                <p className="mt-2 text-xs text-slate-500">
                  Trabajo del {fmtFecha(l.trabajo.fecha)} · cargado por {l.trabajo.cargadoPor ?? "—"}
                </p>
              ) : null}
              <div className="mt-3">
                {l.trabajo ? (
                  <Link href={`/produccion/trabajo/${l.trabajo.id}`} className={`${BOTON} w-full border border-slate-400 bg-white text-slate-900`}>
                    Ver trabajo<span className="sr-only"> de {l.descripcion}, venta {l.numero}/{l.anio}</span>
                  </Link>
                ) : (
                  <Link href={`/produccion/cargar/${l.ventaItemId}`} className={`${BOTON} w-full bg-marca text-tinta`}>
                    Cargar trabajo<span className="sr-only"> de {l.descripcion}, venta {l.numero}/{l.anio}</span>
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hayMas ? <p className="mt-3 text-sm text-slate-600">Se muestran las primeras 100 líneas: usá la búsqueda para acotar.</p> : null}
    </>
  );
}
