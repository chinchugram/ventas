import Link from "next/link";
import { Boton, Etiqueta, Seccion, Vacio } from "@/components/ui";
import { fmtFecha, fmtNumero } from "@/lib/money";
import { requierePermisoPagina } from "@/lib/permisos";
import { ETIQUETA_FILTRO, FILTROS_PRODUCCION, parsearBusqueda, parsearFiltro, type FiltroProduccion } from "@/lib/produccion";
import { getListadoProduccion } from "@/lib/queries/produccion";

// Depende de lo que se cargue en el taller: nunca se cachea.
export const dynamic = "force-dynamic";

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
        epigrafe="Lo que pasa en el taller"
        titulo="Producción"
        descripcion="Cargá lo que realmente se usó en cada trabajo: minutos de máquina, mano de obra y materiales."
        accion={
          <Boton href="/produccion/estimar" variante="secundario">
            Estimar tiempos
          </Boton>
        }
      />

      <nav aria-label="Filtro" className="mb-3 flex flex-wrap gap-2">
        {FILTROS_PRODUCCION.map((f) => (
          <Link
            key={f}
            href={hrefFiltro(f, q)}
            aria-current={f === filtro ? "page" : undefined}
            className="chip"
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
        <Boton type="submit" variante="secundario">
          Buscar
        </Boton>
      </form>

      {lineas.length === 0 ? (
        <Vacio
          mensaje={
            q
              ? "Ninguna línea con esa búsqueda."
              : filtro === "cargadas"
                ? "Todavía no se cargó ningún trabajo."
                : filtro === "pendientes"
                  ? "Nada pendiente en el taller. Buen momento para un mate."
                  : "No hay líneas para mostrar."
          }
          hint={
            q
              ? "Probá con otro cliente, artículo o número de venta."
              : filtro === "pendientes"
                ? "Todas las líneas de ventas vigentes tienen su trabajo cargado."
                : filtro === "cargadas"
                  ? "Cuando cargues el primero lo ves acá."
                  : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {lineas.map((l) => (
            <li key={l.ventaItemId} className="tarjeta p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-semibold break-words text-ink">{l.descripcion}</p>
                  <p className="text-body-sm text-ink-muted">
                    <span className="tabular-nums">{fmtNumero(l.cantidad)}</span> u · {l.cliente}
                  </p>
                  <p className="text-body-sm text-ink-muted">
                    Venta <span className="font-mono text-mono">#{l.numero}/{l.anio}</span> · {fmtFecha(l.fecha)}
                  </p>
                </div>
                {l.trabajo ? (
                  <Etiqueta tono="ok" className="shrink-0">
                    Cargado
                  </Etiqueta>
                ) : (
                  <Etiqueta tono="aviso" className="shrink-0">
                    Sin cargar
                  </Etiqueta>
                )}
              </div>
              {l.trabajo ? (
                <p className="mt-2 text-body-sm text-ink-muted">
                  Trabajo del {fmtFecha(l.trabajo.fecha)} · cargado por {l.trabajo.cargadoPor ?? "—"}
                </p>
              ) : null}
              <div className="mt-3">
                {l.trabajo ? (
                  <Boton href={`/produccion/trabajo/${l.trabajo.id}`} variante="secundario" ancho>
                    Ver trabajo<span className="sr-only"> de {l.descripcion}, venta {l.numero}/{l.anio}</span>
                  </Boton>
                ) : (
                  <Boton href={`/produccion/cargar/${l.ventaItemId}`} ancho>
                    Cargar trabajo<span className="sr-only"> de {l.descripcion}, venta {l.numero}/{l.anio}</span>
                  </Boton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hayMas ? <p className="mt-3 text-body-sm text-ink-muted">Se muestran las primeras 100 líneas: usá la búsqueda para acotar.</p> : null}
    </>
  );
}
