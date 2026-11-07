"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  DURACION_SONIDO,
  guardarSonido,
  prepararAudio,
  reproducir as reproducirMomento,
  sonidoEncendido,
  suscribirSonido,
  type Momento,
} from "@/lib/sonido";

/*
 * Sonido en React (docs/brand/momentos.md). La lógica vive en src/lib/sonido.ts; acá:
 *  - `SonidoProvider` (montado en layout.tsx) prepara el audio con el PRIMER gesto del usuario
 *    (toque o tecla), solo si el sonido está encendido. Nunca suena nada al cargar.
 *  - `useSonido()` da el estado y `reproducir(momento)` a cualquier client component.
 *  - `InterruptorSonido` es el botón para prenderlo y apagarlo (lo ubica el navbar/configuración).
 *
 *   const { reproducir } = useSonido();
 *   enviar(datos, () => { reproducir("cobro"); setMensaje("¡Cobrado! $12.500 ya están en caja."); });
 */

type ContextoSonido = {
  /** El usuario prendió el sonido en este navegador. */
  encendido: boolean;
  /** Prende o apaga, y lo recuerda. */
  setEncendido: (encendido: boolean) => void;
  alternar: () => void;
  /** Hace sonar un momento si está encendido (con `guardado` no suena nada, a propósito). */
  reproducir: (momento: Momento) => void;
  /** Cuánto dura cada momento, en ms (para esperar antes de navegar sin cortarlo). */
  duracion: Record<Momento, number>;
};

const Contexto = createContext<ContextoSonido | null>(null);

/** En el servidor y al hidratar, apagado: el estado real se lee recién en el navegador. */
const apagadoEnServidor = () => false;

function useEstadoSonido(): ContextoSonido {
  const encendido = useSyncExternalStore(suscribirSonido, sonidoEncendido, apagadoEnServidor);
  const setEncendido = useCallback((valor: boolean) => guardarSonido(valor), []);
  const alternar = useCallback(() => guardarSonido(!sonidoEncendido()), []);
  const reproducir = useCallback((m: Momento) => reproducirMomento(m), []);
  return useMemo(
    () => ({ encendido, setEncendido, alternar, reproducir, duracion: DURACION_SONIDO }),
    [encendido, setEncendido, alternar, reproducir],
  );
}

export function SonidoProvider({ children }: { children: ReactNode }) {
  const valor = useEstadoSonido();

  // Primer gesto: si el sonido está encendido, crea el AudioContext (los navegadores no lo dejan
  // arrancar sin gesto). Después ya no hace falta escuchar.
  useEffect(() => {
    const alPrimerGesto = () => {
      prepararAudio();
      quitar();
    };
    const opciones = { capture: true, passive: true } as const;
    const quitar = () => {
      window.removeEventListener("pointerdown", alPrimerGesto, opciones);
      window.removeEventListener("keydown", alPrimerGesto, opciones);
    };
    window.addEventListener("pointerdown", alPrimerGesto, opciones);
    window.addEventListener("keydown", alPrimerGesto, opciones);
    return quitar;
  }, []);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Estado y acciones del sonido. Funciona también fuera del provider (sin el "preparar al primer gesto"). */
export function useSonido(): ContextoSonido {
  const delProvider = useContext(Contexto);
  const propio = useEstadoSonido();
  return delProvider ?? propio;
}

/**
 * Interruptor de sonido (momentos.md): botón sticker secundario con `aria-pressed`. Apagado por
 * defecto; prenderlo no hace sonar nada, solo habilita los sonidos de los momentos.
 */
export function InterruptorSonido({ className = "", conTexto = true }: { className?: string; conTexto?: boolean }) {
  const { encendido, alternar } = useSonido();
  return (
    <button
      type="button"
      aria-pressed={encendido}
      onClick={alternar}
      title={encendido ? "Sonido prendido" : "Sonido apagado"}
      className={`boton boton-secundario boton-chico ${className}`}
    >
      {conTexto ? <span>Sonido</span> : <span className="sr-only">Sonido</span>}
      <span aria-hidden="true" className="pista-sonido">
        <span className="perilla-sonido" />
      </span>
    </button>
  );
}
