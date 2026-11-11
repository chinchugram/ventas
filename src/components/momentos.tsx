"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSonido } from "@/components/sonido";
import { audioPreparado, type Momento } from "@/lib/sonido";
import type { Logro } from "@/lib/logros";
import { fmtPorcentaje } from "@/lib/money";

/*
 * Momentos (docs/brand/momentos.md): mensaje + animación + (a veces) sonido, en un solo lugar.
 *
 *  - `useMomento()` da `reproducir(momento)` (solo sonido) y `anunciar({ momento, mensaje })`
 *    (sonido + aviso flotante que sobrevive a la navegación y a que el formulario desaparezca).
 *    `useAccion` (components/form) los usa solo: ninguna pantalla repite el disparo.
 *  - `MomentosProvider` (layout.tsx) muestra ese aviso y detecta "sin conexión" (`offline`).
 *  - Piezas visuales: `Tilde` (guardado), `Moneda` (cobro), `MontoQueCuenta` (cobro),
 *    `Estallido` y `LogroMeta` (logro).
 *  - Logros que informa una acción (`logro` en el resultado, lib/logros.ts): `mensajeDeLogro` decide
 *    si se festeja (meta: una vez por mes, el mismo control que el tablero; primer cliente: el
 *    servidor ya lo informa una sola vez) y con qué mensaje. `useAccion` lo usa solo.
 *
 * Reglas que se cumplen acá: el sonido lo decide `lib/sonido.ts` (interruptor, volumen bajo, uno
 * corta al anterior, `guardado` no suena); nada suena al cargar (el estallido de la meta y el aviso
 * de sin conexión al abrir la página son solo visuales); un anuncio nuevo reemplaza al anterior;
 * con `prefers-reduced-motion` nada se mueve (globals.css acorta toda animación, y el monto y el
 * estallido se saltean acá).
 */

/** Momentos que tienen aviso propio. `offline` y `error` se muestran con su bloque, no acá. */
export type MomentoAnunciable = Extract<Momento, "guardado" | "cobro" | "turno" | "logro">;

type Anuncio = { id: number; momento: MomentoAnunciable; mensaje: ReactNode };

type ContextoMomentos = {
  /** Solo el sonido del momento (si el interruptor está prendido). */
  reproducir: (momento: Momento) => void;
  /** Sonido + aviso flotante con su animación. Fuera del provider, solo suena. */
  anunciar: (anuncio: { momento: MomentoAnunciable; mensaje: ReactNode }) => void;
};

const Contexto = createContext<ContextoMomentos | null>(null);

/** Cuánto queda a la vista un aviso (ms). Es tiempo de lectura, no de animación. */
const LECTURA_MS = 6000;

// ─── Movimiento reducido ─────────────────────────────────────────────────────

const CONSULTA_QUIETO = "(prefers-reduced-motion: reduce)";

function suscribirQuieto(alCambiar: () => void) {
  const mq = window.matchMedia(CONSULTA_QUIETO);
  mq.addEventListener("change", alCambiar);
  return () => mq.removeEventListener("change", alCambiar);
}

/** `true` si el usuario pidió menos movimiento. En el servidor, `true` (no se anima nada al hidratar). */
export function useMovimientoReducido(): boolean {
  return useSyncExternalStore(
    suscribirQuieto,
    () => window.matchMedia(CONSULTA_QUIETO).matches,
    () => true,
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useMomento(): ContextoMomentos {
  const delProvider = useContext(Contexto);
  const { reproducir } = useSonido();
  const anunciar = useCallback((a: { momento: MomentoAnunciable }) => reproducir(a.momento), [reproducir]);
  const suelto = useMemo(() => ({ reproducir, anunciar }), [reproducir, anunciar]);
  return delProvider ?? suelto;
}

// ─── Provider: aviso flotante y conexión ──────────────────────────────────────

function suscribirConexion(alCambiar: () => void) {
  window.addEventListener("online", alCambiar);
  window.addEventListener("offline", alCambiar);
  return () => {
    window.removeEventListener("online", alCambiar);
    window.removeEventListener("offline", alCambiar);
  };
}

export function MomentosProvider({ children }: { children: ReactNode }) {
  const { reproducir } = useSonido();
  const [anuncio, setAnuncio] = useState<Anuncio | null>(null);
  const siguienteId = useRef(0);

  const anunciar = useCallback(
    ({ momento, mensaje }: { momento: MomentoAnunciable; mensaje: ReactNode }) => {
      reproducir(momento);
      siguienteId.current += 1;
      setAnuncio({ id: siguienteId.current, momento, mensaje });
    },
    [reproducir],
  );

  // El aviso se va solo después de un rato de lectura (o con "Cerrar").
  useEffect(() => {
    if (!anuncio) return;
    const t = window.setTimeout(() => setAnuncio((a) => (a?.id === anuncio.id ? null : a)), LECTURA_MS);
    return () => window.clearTimeout(t);
  }, [anuncio]);

  // Sin conexión: el navegador avisa con `offline`/`online`. Al cargar ya sin conexión, solo se muestra.
  const enLinea = useSyncExternalStore(suscribirConexion, () => navigator.onLine, () => true);
  useEffect(() => {
    const alCortarse = () => {
      // No sale de un toque: suena solo si el audio ya lo preparó un gesto (nunca crea uno nuevo).
      if (audioPreparado()) reproducir("offline");
    };
    const alVolver = () => {
      siguienteId.current += 1;
      setAnuncio({ id: siguienteId.current, momento: "guardado", mensaje: "Volvió la conexión. Ya podés guardar." });
    };
    window.addEventListener("offline", alCortarse);
    window.addEventListener("online", alVolver);
    return () => {
      window.removeEventListener("offline", alCortarse);
      window.removeEventListener("online", alVolver);
    };
  }, [reproducir]);

  const valor = useMemo(() => ({ reproducir, anunciar }), [reproducir, anunciar]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/* Debajo del encabezado (min-h-16 + borde), para no tapar las barras de abajo (navegación, guardar). */}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(4rem+var(--border-width)+0.5rem)] z-[45] px-4">
        <div className="mx-auto max-w-read space-y-2">
          {/* Región viva siempre montada: así el lector de pantalla anuncia cada cambio. */}
          <div role="status" aria-live="polite">
            {enLinea ? null : <AvisoSinConexion />}
          </div>
          <div role="status" aria-live="polite" data-momento-anuncio>
            {anuncio ? (
              <AvisoMomento key={anuncio.id} anuncio={anuncio} alCerrar={() => setAnuncio(null)} />
            ) : null}
          </div>
        </div>
      </div>
    </Contexto.Provider>
  );
}

const ANIMACION_AVISO: Record<MomentoAnunciable, string> = {
  guardado: "animate-entrada",
  cobro: "animate-salto",
  turno: "animate-salto",
  logro: "animate-salto",
};

function AvisoMomento({ anuncio, alCerrar }: { anuncio: Anuncio; alCerrar: () => void }) {
  return (
    <div
      data-momento={anuncio.momento}
      className={`pointer-events-auto borde flex items-center gap-3 rounded-md border-ok-line bg-ok-soft py-1 pr-1 pl-3 text-body-sm font-semibold text-ok-text shadow-press ${ANIMACION_AVISO[anuncio.momento]}`}
    >
      {anuncio.momento === "cobro" ? <Moneda /> : anuncio.momento === "logro" ? <InsigniaLogro /> : <Tilde />}
      <p className="min-w-0 flex-1 py-2">{anuncio.mensaje}</p>
      <button
        type="button"
        onClick={alCerrar}
        className="boton boton-fantasma min-w-11 shrink-0 px-0 text-ok-text hover:bg-transparent"
      >
        <span className="sr-only">Cerrar aviso</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

function AvisoSinConexion() {
  return (
    <div
      data-momento="offline"
      className="borde flex items-center gap-3 rounded-md border-aviso-line bg-aviso-soft p-3 text-body-sm text-ink shadow-press animate-entrada"
    >
      {/* Momento "sin conexión": un punto que late suave. */}
      <span aria-hidden="true" className="size-2.5 shrink-0 animate-latido rounded-full bg-aviso" />
      <p>
        <span className="font-bold text-aviso-text">Se cortó internet.</span> Lo que estás cargando sigue en pantalla: guardalo
        cuando vuelva la conexión.
      </p>
    </div>
  );
}

// ─── Piezas visuales ─────────────────────────────────────────────────────────

/** Momento "guardado": un tilde que se dibuja. Con movimiento reducido aparece ya dibujado. */
export function Tilde({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1"
        className="animate-tilde"
      />
    </svg>
  );
}

/** Momento "cobro": cae una moneda (sticker sol con on-color). */
export function Moneda() {
  return (
    <span
      aria-hidden="true"
      className="borde inline-flex size-7 shrink-0 animate-caer items-center justify-center rounded-full border-line-strong bg-sol font-display text-label text-on-color"
    >
      $
    </span>
  );
}

/**
 * Momento "cobro": el monto cuenta de 0 al total en `--dur-momento`. Con movimiento reducido
 * aparece directo. El lector de pantalla oye solo el total (el conteo es decorativo).
 */
export function MontoQueCuenta({ valor, formato }: { valor: number; formato: (n: number) => string }) {
  const quieto = useMovimientoReducido();
  const [mostrado, setMostrado] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (quieto || !ref.current) return;
    const crudo = getComputedStyle(ref.current).getPropertyValue("--dur-momento").trim();
    const duracion = crudo.endsWith("ms") ? parseFloat(crudo) : parseFloat(crudo) * 1000 || 0;
    let cuadro = 0;
    const inicio = performance.now();
    const paso = (ahora: number) => {
      const t = duracion > 0 ? Math.min((ahora - inicio) / duracion, 1) : 1;
      const suave = 1 - (1 - t) ** 3;
      setMostrado(t >= 1 ? valor : valor * suave);
      if (t < 1) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(cuadro);
  }, [valor, quieto]);

  return (
    <span ref={ref} className="tabular-nums">
      <span aria-hidden="true">{formato(quieto ? valor : mostrado)}</span>
      <span className="sr-only">{formato(valor)}</span>
    </span>
  );
}

const PUNTOS_ESTALLIDO = ["bg-sol", "bg-menta", "bg-cielo", "bg-frambuesa", "bg-brand", "bg-sol", "bg-menta", "bg-cielo"];

/**
 * Momento "logro": estallido de puntos de color desde el centro del elemento que lo contiene
 * (que tiene que ser `relative`). Una sola vez; con movimiento reducido no se dibuja.
 */
export function Estallido() {
  const quieto = useMovimientoReducido();
  if (quieto) return null;
  return (
    <span aria-hidden="true" data-estallido className="pointer-events-none absolute top-1/2 left-1/2">
      {PUNTOS_ESTALLIDO.map((color, i) => {
        const angulo = (i / PUNTOS_ESTALLIDO.length) * 2 * Math.PI;
        const estilo = {
          "--dx": `calc(${Math.cos(angulo).toFixed(3)} * var(--spacing) * 12)`,
          "--dy": `calc(${Math.sin(angulo).toFixed(3)} * var(--spacing) * 8)`,
        } as CSSProperties;
        return <span key={i} style={estilo} className={`absolute top-0 left-0 size-2 animate-estallido rounded-full ${color}`} />;
      })}
    </span>
  );
}

/** Momento "logro" en el aviso flotante: un sticker con una estrella y el estallido alrededor. */
function InsigniaLogro() {
  return (
    <span
      aria-hidden="true"
      className="borde relative inline-flex size-7 shrink-0 items-center justify-center rounded-full border-line-strong bg-sol text-on-color"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
        <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
      </svg>
      <Estallido />
    </span>
  );
}

const CLAVE_LOGRO_META = "ventas:logro-meta";

function mesActual(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

/** ¿La meta de este mes ya se festejó en este navegador? (tablero o una venta). */
function metaYaFestejada(mes: string): boolean {
  try {
    return localStorage.getItem(CLAVE_LOGRO_META) === mes;
  } catch {
    // Sin almacenamiento: festeja igual (una vez por carga).
    return false;
  }
}

function anotarMetaFestejada(mes: string) {
  try {
    localStorage.setItem(CLAVE_LOGRO_META, mes);
  } catch {
    // Sin almacenamiento: vale solo para esta carga.
  }
}

/** Mensajes de festejo (voz.md: festejo con todo, una exclamación, el dato real; se rotan). */
const MENSAJES_LOGRO: { [T in Logro["tipo"]]: ((l: Extract<Logro, { tipo: T }>) => string)[] } = {
  meta: [
    (l) => `¡Pasaste la meta del mes! El margen va en ${fmtPorcentaje(l.margenPct)} y la meta es ${fmtPorcentaje(l.metaPct)}.`,
    (l) => `¡Meta del mes cumplida! Margen ${fmtPorcentaje(l.margenPct)}, arriba del ${fmtPorcentaje(l.metaPct)} que te propusiste.`,
    (l) => `¡Arriba de la meta! El margen del mes ya llegó a ${fmtPorcentaje(l.margenPct)}.`,
  ],
  primerCliente: [
    (l) => `¡${l.nombre} es tu primer cliente! Esto recién arranca.`,
    (l) => `¡Primer cliente adentro: ${l.nombre}! Esto recién empieza.`,
    (l) => `¡Tu primer cliente, ${l.nombre}! Arrancamos.`,
  ],
};

/**
 * Mensaje para festejar un logro que informó una acción, o `null` si no corresponde festejarlo.
 * La meta se festeja una vez por mes (la misma marca que `LogroMeta`, así el tablero no repite);
 * el primer cliente lo informa el servidor una sola vez por negocio.
 */
export function mensajeDeLogro(logro: Logro): string | null {
  if (logro.tipo === "meta") {
    const mes = mesActual();
    if (metaYaFestejada(mes)) return null;
    anotarMetaFestejada(mes);
  }
  const opciones = MENSAJES_LOGRO[logro.tipo] as ((l: Logro) => string)[];
  const elegido = opciones[Math.floor(Math.random() * opciones.length)] ?? opciones[0];
  return elegido ? elegido(logro) : null;
}

/**
 * Logro "meta del mes" en el tablero: la primera vez que el usuario ve el margen arriba de la meta
 * en el mes (en este navegador), estalla una vez. No suena: aparece al cargar la página y el manual
 * no deja sonar nada al cargar. Si la meta ya se festejó con sonido al guardar la venta que la
 * cruzó (`mensajeDeLogro`), el tablero no la repite ese mes.
 */
export function LogroMeta({ activo, children }: { activo: boolean; children: ReactNode }) {
  const [festejar, setFestejar] = useState(false);

  useEffect(() => {
    if (!activo) return;
    const mes = mesActual();
    if (metaYaFestejada(mes)) return;
    // Después de hidratar (el estallido es solo del navegador). Se anota recién al festejar, así un
    // efecto que se monta dos veces (modo estricto) no se lo saltea.
    const t = window.setTimeout(() => {
      anotarMetaFestejada(mes);
      setFestejar(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, [activo]);

  return (
    <span className="relative inline-flex" data-logro-meta={festejar ? "festejo" : undefined}>
      {children}
      {festejar ? <Estallido /> : null}
    </span>
  );
}
