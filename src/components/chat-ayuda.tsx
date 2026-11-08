"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { claseBoton } from "@/components/ui";
import { Icono } from "@/components/iconos";
import { reproducir } from "@/lib/sonido";
import { ARRANQUE, SECCIONES } from "@/lib/ayuda/guia";

type Mensaje = { rol: "usuario" | "asistente"; texto: string };

const MAX_CARACTERES = 500;
const SALUDO = "¡Hola! Preguntame cómo hacer algo en la app. Por ejemplo: ¿cómo cargo una receta?";

/**
 * Chat de ayuda flotante. La conversacion vive solo en la pestaña (se pierde al recargar):
 * no se guarda nada. El servidor recorta el historial y limita el largo de cada pregunta.
 */
export function ChatAyuda() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes, enviando, abierto]);

  useEffect(() => {
    if (!abierto) return;
    inputRef.current?.focus();
    // Con el chat a pantalla completa, la página de atrás no se desplaza.
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const conEscape = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("keydown", conEscape);
    return () => {
      window.removeEventListener("keydown", conEscape);
      document.body.style.overflow = overflowAntes;
    };
  }, [abierto]);

  const cerrar = () => setAbierto(false);

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault();
    const pregunta = texto.trim();
    if (!pregunta || enviando) return;
    const conPregunta: Mensaje[] = [...mensajes, { rol: "usuario", texto: pregunta }];
    setMensajes(conPregunta);
    setTexto("");
    setError(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/ayuda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensajes: conPregunta.slice(-6) }),
      });
      const datos = (await r.json().catch(() => ({}))) as { respuesta?: string; error?: string };
      if (!r.ok || !datos.respuesta) throw new Error(datos.error ?? "No pude responder ahora. Probá de nuevo.");
      setMensajes([...conPregunta, { rol: "asistente", texto: datos.respuesta }]);
      // Respeta el interruptor de sonido: apagado, no suena.
      reproducir("tap");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude responder ahora.");
      // La pregunta vuelve al campo para reintentar sin tipearla de nuevo.
      setMensajes(mensajes);
      setTexto(pregunta);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {!abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className={`${claseBoton({ chico: true })} fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[55] min-h-11 md:bottom-6`}
        >
          <Icono nombre="ayuda" className="h-5 w-5" />
          Ayuda
        </button>
      )}

      {abierto && (
        // Oscurece la pantalla de atrás: el chat queda en primer plano y no se mezcla con la página.
        <div aria-hidden className="fixed inset-0 z-[62] hidden bg-black/55 md:block" onClick={() => setAbierto(false)} />
      )}

      {abierto && (
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Asistente de ayuda"
          // Celular: pantalla completa (como una hoja que tapa todo). Desde md: panel flotante abajo a la derecha.
          className="fixed inset-0 z-[65] flex h-dvh flex-col overflow-hidden bg-surface-raised pb-[env(safe-area-inset-bottom)] md:inset-auto md:right-6 md:bottom-6 md:h-auto md:max-h-[70dvh] md:w-96 md:rounded-lg md:border-2 md:border-brand md:pb-0 md:shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 bg-brand px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2 text-on-color md:pt-2">
            <p className="flex items-center gap-2 font-display text-body font-bold">
              <Icono nombre="ayuda" className="h-5 w-5" />
              Asistente de ayuda
            </p>
            <button type="button" onClick={() => setAbierto(false)} className="min-h-11 text-label font-bold underline underline-offset-2">
              Cerrar
            </button>
          </header>

          <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
            <Burbuja rol="asistente" texto={SALUDO} alElegir={cerrar} />
            {mensajes.map((m, i) => (
              <Burbuja key={i} rol={m.rol} texto={m.texto} alElegir={cerrar} />
            ))}
            {enviando && <p className="text-body-sm text-ink-muted">Pensando…</p>}
            <div ref={finRef} />
          </div>

          {error && <p className="px-3 pb-1 text-body-sm text-critico-text">{error}</p>}

          <form onSubmit={enviar} className="flex items-end gap-2 border-t-(length:--border-width) border-line p-2">
            <label htmlFor="pregunta-ayuda" className="sr-only">
              Tu pregunta
            </label>
            <textarea
              id="pregunta-ayuda"
              ref={inputRef}
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, MAX_CARACTERES))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={1}
              maxLength={MAX_CARACTERES}
              placeholder="Escribí tu duda"
              className="min-h-11 flex-1 resize-none rounded-md border-(length:--border-width) border-line-strong bg-surface px-3 py-2 text-body text-ink"
            />
            <button
              type="submit"
              aria-label="Enviar"
              title="Enviar"
              disabled={enviando || !texto.trim()}
              className={`${claseBoton()} h-11 w-11 shrink-0 rounded-full p-0`}
            >
              <Icono nombre="enviar" className="h-5 w-5" grosor={2} />
            </button>
          </form>
          <p className="px-3 pb-2 text-body-sm text-ink-muted">
            Respuestas automáticas. Guía completa en{" "}
            <Link href="/ayuda" className="enlace" onClick={() => setAbierto(false)}>
              Ayuda
            </Link>
            .
          </p>
        </section>
      )}
    </>
  );
}

// Rutas que nombra la guía: en una respuesta se vuelven enlaces (cualquier otra queda como texto).
const RUTAS = new Set([...SECCIONES.flatMap((x) => (x.ruta ? [x.ruta] : [])), ...ARRANQUE.map((p) => p.ruta), "/ayuda"]);
const PATRON_RUTA = /(\/[a-z][a-z0-9\-/]*)/g;

function conEnlaces(texto: string, alElegir: () => void): ReactNode[] {
  return texto.split(PATRON_RUTA).map((parte, i) => {
    const ruta = parte.replace(/\/$/, "");
    return i % 2 === 1 && RUTAS.has(ruta) ? (
      <Link key={i} href={ruta} onClick={alElegir} className="font-semibold underline underline-offset-2">
        {parte}
      </Link>
    ) : (
      parte
    );
  });
}

function Burbuja({ rol, texto, alElegir }: Mensaje & { alElegir: () => void }) {
  const propio = rol === "usuario";
  return (
    <p
      className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-body-sm ${
        propio ? "ml-auto bg-brand text-on-color" : "bg-surface-sunken text-ink"
      }`}
    >
      {propio ? texto : conEnlaces(texto, alElegir)}
    </p>
  );
}
