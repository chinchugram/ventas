import Link from "next/link";
import type { ReactNode } from "react";
import { Aviso, claseBoton, Etiqueta, Panel } from "@/components/ui";
import { rangoDeMes, type RangoFechas } from "@/lib/rango-fechas";

/*
 * Piezas compartidas por /reportes, /reportes/stock y /reportes/margen-real: el encabezado de cada
 * reporte, el aviso de fechas corregidas y el filtro de fechas. Son server components: los filtros
 * son formularios GET (el navegador arma la URL, sirve sin JavaScript y se puede compartir).
 */

/** Un reporte: título, a qué período refiere, descripción y (si hay) el botón de exportar a CSV. */
export function Reporte({
  titulo,
  descripcion,
  badge,
  exportar,
  etiquetaExportar,
  children,
}: {
  titulo: string;
  descripcion?: string;
  /** "Por período" cambia con el filtro de fechas; "A hoy" es el estado de hoy y no cambia. */
  badge: "Por período" | "A hoy";
  /** Ruta del CSV de este reporte (ya con el filtro activo, si depende del período). */
  exportar?: string;
  etiquetaExportar?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-body-lg font-bold text-ink">{titulo}</h2>
        <Etiqueta tono={badge === "A hoy" ? "aviso" : "neutro"}>{badge}</Etiqueta>
        {exportar ? (
          <a
            href={exportar}
            aria-label={etiquetaExportar ?? `Exportar CSV: ${titulo}`}
            className={`${claseBoton({ variante: "secundario" })} ml-auto`}
          >
            Exportar CSV
          </a>
        ) : null}
      </div>
      {descripcion ? <p className="mb-3 text-body-sm text-ink-muted">{descripcion}</p> : null}
      {children}
    </section>
  );
}

/** Lo que se corrigió de las fechas de la URL (rango al revés, mes inválido…). */
export function AvisosFiltro({ avisos }: { avisos: string[] }) {
  if (avisos.length === 0) return null;
  return (
    <Aviso tono="aviso" role="status" className="mb-4">
      <ul className="space-y-1">
        {avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </Aviso>
  );
}

/** Mes anterior y siguiente del filtro, si el período es un mes. */
function mesesVecinos(rango: RangoFechas) {
  if (rango.anio === undefined || rango.mes === undefined) return null;
  const { anio, mes } = rango;
  return {
    anterior: mes === 1 ? rangoDeMes(anio - 1, 12) : rangoDeMes(anio, mes - 1),
    siguiente: mes === 12 ? rangoDeMes(anio + 1, 1) : rangoDeMes(anio, mes + 1),
  };
}

/**
 * Filtro de fechas: dos formularios GET independientes (mes; desde/hasta). Van separados a propósito:
 * el parser da prioridad al rango, así que un formulario único con los dos valores precargados haría
 * imposible volver a elegir un mes. `conservar` son otros parámetros de la URL que no se pierden al
 * cambiar el período (en el reporte de stock, `dias`). `children` son formularios extra, debajo.
 */
export function FiltroFechas({
  rango,
  ruta,
  conservar = {},
  children,
}: {
  rango: RangoFechas;
  ruta: string;
  conservar?: Record<string, string | number>;
  children?: ReactNode;
}) {
  const mes = rango.desdeISO.slice(0, 7);
  const vecinos = mesesVecinos(rango);
  const extra = new URLSearchParams(Object.entries(conservar).map(([k, v]) => [k, String(v)])).toString();
  const enlace = (query: string) => `${ruta}?${query}${extra ? `&${extra}` : ""}`;
  const ocultos = Object.entries(conservar).map(([nombre, valor]) => <input key={nombre} type="hidden" name={nombre} value={valor} />);

  return (
    <Panel compacto className="mb-5 space-y-3">
      <form method="get" action={ruta} className="flex flex-wrap items-end gap-3">
        {ocultos}
        <label className="mb-0 min-w-0 flex-1 basis-40">
          Mes
          <input type="month" name="mes" defaultValue={mes} min="2000-01" max="2100-12" required className="mt-1" />
        </label>
        <button type="submit" className={claseBoton({ variante: "secundario" })}>
          Ver mes
        </button>
        {vecinos ? (
          <span className="flex items-center gap-2">
            <a href={enlace(vecinos.anterior.query)} aria-label={`Mes anterior: ${vecinos.anterior.etiqueta}`} className={claseBoton({ variante: "secundario" })}>
              &larr;
            </a>
            <a href={enlace(vecinos.siguiente.query)} aria-label={`Mes siguiente: ${vecinos.siguiente.etiqueta}`} className={claseBoton({ variante: "secundario" })}>
              &rarr;
            </a>
          </span>
        ) : null}
      </form>

      <form method="get" action={ruta} className="flex flex-wrap items-end gap-3 border-t-(length:--border-width) border-line pt-3">
        {ocultos}
        <label className="mb-0 min-w-0 flex-1 basis-36">
          Desde
          <input type="date" name="desde" defaultValue={rango.desdeISO} min="2000-01-01" max="2100-12-31" required className="mt-1" />
        </label>
        <label className="mb-0 min-w-0 flex-1 basis-36">
          Hasta (incluido)
          <input type="date" name="hasta" defaultValue={rango.hastaISO} min="2000-01-01" max="2100-12-31" required className="mt-1" />
        </label>
        <button type="submit" className={claseBoton({ variante: "secundario" })}>
          Ver rango
        </button>
      </form>

      {children}

      {rango.tipo === "rango" || !rango.porDefecto ? (
        <Link href={extra ? `${ruta}?${extra}` : ruta} className="enlace inline-flex min-h-11 items-center">
          Volver al mes actual
        </Link>
      ) : null}
    </Panel>
  );
}
