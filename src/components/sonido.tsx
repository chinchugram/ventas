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
 *  - `InterruptorSonido` es el botón del encabezado para apagarlo en un toque (navbar, /admin, /login).
 *  - `SwitchSonido` es el interruptor de Configuración (`role="switch"`). Los dos leen y escriben la
 *    misma preferencia (`lib/sonido.ts`), así que quedan sincronizados, también entre pestañas.
 *
 *   const { reproducir } = useSonido();
 *   enviar(datos, () => { reproducir("cobro"); setMensaje("¡Cobrado! $12.500 ya están en caja."); });
 */

type ContextoSonido = {
  /** El sonido está prendido en este navegador (por defecto, sí). */
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

/**
 * En el servidor y al hidratar, prendido (el valor por defecto): el estado real se lee recién en el
 * navegador. Es solo lo que muestran los interruptores; no crea audio ni suena nada.
 */
const encendidoEnServidor = () => true;

function useEstadoSonido(): ContextoSonido {
  const encendido = useSyncExternalStore(suscribirSonido, sonidoEncendido, encendidoEnServidor);
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
 * Interruptor de sonido del encabezado (momentos.md: "tiene que poder apagarse en un toque"): botón
 * sticker secundario con `aria-pressed`. Prendido por defecto; prenderlo no hace sonar nada, solo
 * habilita los sonidos de los momentos.
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

/**
 * Interruptor de sonido de Configuración: `role="switch"` con `aria-checked`, etiqueta visible y texto
 * de ayuda (`aria-describedby`). Misma preferencia que `InterruptorSonido`.
 */
export function SwitchSonido({ id = "switch-sonido" }: { id?: string }) {
  const { encendido, alternar } = useSonido();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={`${id}-etiqueta`} className="text-body font-semibold text-ink">
          Sonidos de cobros y logros
        </p>
        <p id={`${id}-ayuda`} className="mt-1 text-body-sm text-ink-muted">
          Suena cuando entra plata, cuando pasás la meta del mes o cargás tu primer cliente. Guardar y
          editar no suenan nunca. Vale para este navegador; también lo apagás en un toque con el botón
          de sonido de arriba.
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={encendido}
        aria-labelledby={`${id}-etiqueta`}
        aria-describedby={`${id}-ayuda`}
        onClick={alternar}
        className="boton boton-secundario boton-chico min-h-11 shrink-0"
      >
        <span aria-hidden="true">{encendido ? "Prendido" : "Apagado"}</span>
        <span aria-hidden="true" className="pista-sonido">
          <span className="perilla-sonido" />
        </span>
      </button>
    </div>
  );
}
