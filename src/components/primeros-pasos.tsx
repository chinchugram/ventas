import Link from "next/link";
import type { PasoEstado } from "@/lib/queries/primeros-pasos";
import { Etiqueta, TituloBloque } from "@/components/ui";

/**
 * Checklist de puesta en marcha para el dueño de un negocio nuevo. Se muestra
 * mientras falte algun paso obligatorio y desaparece solo cuando estan todos.
 * Cada paso lleva a la pantalla donde se resuelve.
 */
export function PrimerosPasos({ pasos }: { pasos: PasoEstado[] }) {
  const obligatorios = pasos.filter((p) => !p.opcional);
  const hechos = obligatorios.filter((p) => p.hecho).length;
  if (hechos === obligatorios.length) return null;
  // El primero sin hacer es el que conviene encarar ahora.
  const siguiente = pasos.find((p) => !p.hecho);

  return (
    <section className="tarjeta mb-6 p-4 sm:p-6" aria-labelledby="primeros-pasos">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <TituloBloque id="primeros-pasos" className="mb-0">
          Primeros pasos
        </TituloBloque>
        <p className="text-body-sm tabular-nums text-ink-muted">
          {hechos} de {obligatorios.length} listos
        </p>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${(hechos / obligatorios.length) * 100}%` }} />
      </div>
      <ol className="space-y-1">
        {pasos.map((p) => (
          <li key={p.titulo}>
            <Link
              href={p.ruta}
              className={`flex min-h-11 items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-sunken ${
                p === siguiente ? "bg-surface-sunken" : ""
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-(length:--border-width) text-body-sm font-bold ${
                  p.hecho ? "border-ok-line bg-ok-soft text-ok-text" : "border-line-strong text-ink-muted"
                }`}
                aria-hidden
              >
                {p.hecho ? "✓" : ""}
              </span>
              <span className={`min-w-0 flex-1 text-body ${p.hecho ? "text-ink-muted line-through" : "font-semibold text-ink"}`}>
                {p.titulo}
                <span className="sr-only">{p.hecho ? " (listo)" : " (pendiente)"}</span>
              </span>
              {p.opcional && !p.hecho ? <Etiqueta>Opcional</Etiqueta> : null}
            </Link>
          </li>
        ))}
      </ol>
      {siguiente ? <p className="mt-3 text-body-sm text-ink-muted">{siguiente.texto}</p> : null}
      <Link href="/ayuda" className="enlace mt-2 inline-flex min-h-11 items-center text-label">
        Ver la guía completa
      </Link>
    </section>
  );
}
