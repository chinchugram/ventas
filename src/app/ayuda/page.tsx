import type { Metadata } from "next";
import Link from "next/link";
import { requierePermisoPagina } from "@/lib/permisos";
import { puede } from "@/lib/permisos-pura";
import { ARRANQUE, INTRO, PREGUNTAS, SECCIONES } from "@/lib/ayuda/guia";
import { Etiqueta, Plegable, Seccion, TituloBloque } from "@/components/ui";

export const metadata: Metadata = { title: "Ayuda" };

/**
 * Guia de uso (welcome kit): por donde empezar, que hace cada pantalla y preguntas
 * frecuentes. La ve cualquier usuario con sesion; al empleado no se le muestran
 * las pantallas que no puede abrir. El contenido vive en `src/lib/ayuda/guia.ts`.
 */
export default async function AyudaPage() {
  // Toda sesion de un negocio puede cambiar su clave: es el permiso de "cualquier usuario".
  const usuario = await requierePermisoPagina("cambiarClavePropia");
  const esDueno = puede(usuario, "configuracion");
  const secciones = SECCIONES.filter((s) => esDueno || !s.soloDueno);

  return (
    <>
      <Seccion epigrafe="Ayuda" titulo="Cómo usar la app" descripcion={INTRO} />

      {esDueno && (
        <section className="mb-8" aria-labelledby="arranque">
          <TituloBloque id="arranque">Por dónde empezar</TituloBloque>
          <ol className="space-y-2">
            {ARRANQUE.map((p, i) => (
              <li key={p.titulo} className="tarjeta flex gap-3 p-4">
                <span className="font-display text-body-lg font-bold tabular-nums text-ink-muted" aria-hidden>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
                    <Link href={p.ruta} className="underline-offset-2 hover:underline">
                      {p.titulo}
                    </Link>
                    {p.opcional ? <Etiqueta>Opcional</Etiqueta> : null}
                  </p>
                  <p className="mt-1 text-body-sm text-ink-muted">{p.texto}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mb-8" aria-labelledby="pantallas">
        <TituloBloque id="pantallas">Qué hace cada pantalla</TituloBloque>
        <div className="space-y-2">
          {secciones.map((s) => (
            <Plegable
              key={s.id}
              titulo={
                <span>
                  {s.titulo} <span className="font-normal text-ink-muted">· {s.resumen}</span>
                </span>
              }
            >
              <ul className="list-disc space-y-1 py-3 pl-9 pr-4 text-body-sm text-ink">
                {s.puntos.map((punto) => (
                  <li key={punto}>{punto}</li>
                ))}
              </ul>
              {s.ruta ? (
                <Link href={s.ruta} className="enlace mb-3 ml-4 inline-flex min-h-11 items-center text-label">
                  Ir a {s.titulo}
                </Link>
              ) : null}
            </Plegable>
          ))}
        </div>
      </section>

      <section className="mb-8" aria-labelledby="preguntas">
        <TituloBloque id="preguntas">Preguntas frecuentes</TituloBloque>
        <dl className="space-y-3">
          {PREGUNTAS.map((q) => (
            <div key={q.pregunta} className="tarjeta p-4">
              <dt className="text-body font-semibold text-ink">{q.pregunta}</dt>
              <dd className="mt-1 text-body-sm text-ink-muted">{q.respuesta}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
