"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { claseBoton } from "@/components/ui";
import { Icono } from "@/components/iconos";

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
    if (abierto) inputRef.current?.focus();
  }, [abierto]);

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
          aria-label="Abrir ayuda"
          className={`${claseBoton({ variante: "secundario" })} fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[55] h-12 w-12 p-0 md:bottom-6`}
        >
          <Icono nombre="ayuda" className="h-6 w-6" />
        </button>
      )}

      {abierto && (
        <section
          aria-label="Asistente de ayuda"
          className="tarjeta fixed inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[65] flex max-h-[70dvh] flex-col overflow-hidden md:inset-x-auto md:right-6 md:bottom-6 md:w-96"
        >
          <header className="flex items-center justify-between gap-2 border-b-(length:--border-width) border-line px-4 py-2">
            <p className="font-display text-body font-bold text-ink">Ayuda</p>
            <button type="button" onClick={() => setAbierto(false)} className="enlace min-h-11 text-label">
              Cerrar
            </button>
          </header>

          <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
            <Burbuja rol="asistente" texto={SALUDO} />
            {mensajes.map((m, i) => (
              <Burbuja key={i} rol={m.rol} texto={m.texto} />
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
            <button type="submit" disabled={enviando || !texto.trim()} className={`${claseBoton({ chico: true })} min-h-11`}>
              Enviar
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

function Burbuja({ rol, texto }: Mensaje) {
  const propio = rol === "usuario";
  return (
    <p
      className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-body-sm ${
        propio ? "ml-auto bg-brand text-on-color" : "bg-surface-sunken text-ink"
      }`}
    >
      {texto}
    </p>
  );
}
