/*
 * Sonido de los momentos (docs/brand/momentos.md), portado de src/lib/sonido.ts de Kiwitt.
 * Se sintetiza con Web Audio, sin archivos. Solo navegador: ninguna función toca `window` al importar.
 *
 * Reglas del manual que se cumplen acá:
 *  - Encendido por defecto (decisión de ventas, docs/brand/README.md): quien no quiere escuchar lo
 *    apaga con el interruptor del encabezado o el de Configuración (o baja el volumen). La preferencia
 *    se guarda en el navegador (localStorage) y se avisa a todas las pestañas y componentes (evento
 *    propio + `storage`). Sin tope diario de sonidos: no se limita por cantidad.
 *  - Sin sonido automático al cargar: el AudioContext se crea recién con un gesto del usuario
 *    (`prepararAudio`, que el SonidoProvider engancha al primer toque o tecla) o en el primer
 *    `reproducir`, que siempre sale de una acción del usuario.
 *  - Volumen bajo, menos de 600 ms y nunca dos sonidos encimados: uno nuevo corta el anterior.
 *  - Lo rutinario no suena: `reproducir("guardado")` no hace nada a propósito.
 *  - El sonido nunca es la única señal: quien llama muestra texto y animación igual.
 *
 * `prefers-reduced-motion` no apaga el sonido: el manual lo pide para el movimiento, no para el audio
 * (el interruptor es la llave del sonido).
 *
 * Nota (momentos.md, "Implementación"): para producción conviene grabar o licenciar sonidos propios
 * y mantener los mismos nombres de evento. Las formas de onda de abajo son la referencia.
 */

const CLAVE = "ventas:sonido";
export const EVENTO_SONIDO = "ventas:sonido";

/** Eventos del catálogo de momentos.md, más `pop` (tocar una pieza, como en la landing) y `tap` (llega una respuesta del chat). */
export type Momento = "cobro" | "turno" | "guardado" | "logro" | "offline" | "error" | "pop" | "tap";

type Nota = {
  /** Comienzo, en segundos desde el disparo. */
  en: number;
  /** Frecuencia inicial y final (Hz). Iguales: nota fija. */
  desde: number;
  hasta?: number;
  /** Duración, en segundos. */
  dura: number;
  onda: OscillatorType;
  /** Volumen pico, de 0 a 1. Bajo siempre. */
  vol: number;
};

/*
 * Forma de cada momento. No son valores de diseño visual (no hay tokens de sonido): se dejan acá,
 * en segundos y hertz. Todas terminan antes de 600 ms.
 */
const SONIDOS: Record<Exclude<Momento, "guardado">, Nota[]> = {
  // Caja registradora: dos campanitas que suben, brillantes y cortas.
  cobro: [
    { en: 0, desde: 1318, dura: 0.12, onda: "triangle", vol: 0.1 },
    { en: 0.09, desde: 1976, dura: 0.32, onda: "triangle", vol: 0.1 },
  ],
  // Pop doble.
  turno: [
    { en: 0, desde: 420, hasta: 880, dura: 0.14, onda: "sine", vol: 0.12 },
    { en: 0.13, desde: 520, hasta: 1040, dura: 0.16, onda: "sine", vol: 0.12 },
  ],
  // Acorde ascendente (do, mi, sol, do).
  logro: [
    { en: 0, desde: 523, dura: 0.18, onda: "triangle", vol: 0.09 },
    { en: 0.08, desde: 659, dura: 0.18, onda: "triangle", vol: 0.09 },
    { en: 0.16, desde: 784, dura: 0.2, onda: "triangle", vol: 0.09 },
    { en: 0.24, desde: 1047, dura: 0.32, onda: "triangle", vol: 0.09 },
  ],
  // Aviso grave y corto.
  offline: [{ en: 0, desde: 220, hasta: 196, dura: 0.28, onda: "sine", vol: 0.14 }],
  // Dos notas que bajan.
  error: [
    { en: 0, desde: 659, dura: 0.13, onda: "sine", vol: 0.11 },
    { en: 0.14, desde: 494, dura: 0.2, onda: "sine", vol: 0.11 },
  ],
  // Una nota que sube rápido y se apaga (el pop de la landing de Kiwitt).
  pop: [{ en: 0, desde: 420, hasta: 880, dura: 0.16, onda: "sine", vol: 0.12 }],
  // Tap: un toque seco y suave, como un dedo sobre el vidrio (respuesta del chat de ayuda).
  tap: [{ en: 0, desde: 1400, hasta: 900, dura: 0.05, onda: "sine", vol: 0.1 }],
};

/** Cuánto dura cada momento, en milisegundos: lo que hay que esperar para no cortarlo (p. ej. antes de navegar). */
export const DURACION_SONIDO = Object.fromEntries([
  ["guardado", 0],
  ...Object.entries(SONIDOS).map(([m, notas]) => [m, Math.round(Math.max(...notas.map((n) => n.en + n.dura)) * 1000)]),
]) as Record<Momento, number>;

// ─── Preferencia ───────────────────────────────────────────────────────────

/** Respaldo en memoria si localStorage no anda (modo privado, bloqueado). */
let memoria: boolean | undefined;

/**
 * ¿El sonido está prendido en este navegador? Encendido por defecto: solo lo apaga haber elegido
 * "apagado" (en el encabezado o en Configuración). Que esté prendido no hace sonar nada al cargar:
 * el audio arranca recién con un gesto del usuario.
 */
export function sonidoEncendido(): boolean {
  if (memoria !== undefined) return memoria;
  try {
    return localStorage.getItem(CLAVE) !== "apagado";
  } catch {
    return true;
  }
}

export function guardarSonido(encendido: boolean): void {
  try {
    localStorage.setItem(CLAVE, encendido ? "encendido" : "apagado");
  } catch {
    // Sin almacenamiento: vale solo para esta página.
    memoria = encendido;
  }
  // Prenderlo es un gesto del usuario: buen momento para preparar el audio (no suena nada).
  // Apagarlo corta en seco lo que estuviera sonando.
  if (encendido) prepararAudio();
  else if (contexto) cortarAnterior(contexto);
  document.dispatchEvent(new CustomEvent(EVENTO_SONIDO, { detail: encendido }));
}

/** Para useSyncExternalStore: avisa cuando cambia la preferencia (aquí o en otra pestaña). */
export function suscribirSonido(alCambiar: () => void): () => void {
  document.addEventListener(EVENTO_SONIDO, alCambiar);
  window.addEventListener("storage", alCambiar);
  window.addEventListener("pageshow", alCambiar);
  return () => {
    document.removeEventListener(EVENTO_SONIDO, alCambiar);
    window.removeEventListener("storage", alCambiar);
    window.removeEventListener("pageshow", alCambiar);
  };
}

// ─── Audio ───────────────────────────────────────────────────────────────

let contexto: AudioContext | undefined;
let sonando: { osc: OscillatorNode; vol: GainNode }[] = [];

function claseContexto(): typeof AudioContext | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/**
 * Crea (o despierta) el AudioContext. Solo con el sonido encendido y desde un gesto del usuario:
 * los navegadores no dejan arrancar audio de otra forma. No hace sonar nada.
 */
export function prepararAudio(): void {
  if (!sonidoEncendido()) return;
  const Contexto = claseContexto();
  if (!Contexto) return;
  try {
    contexto ??= new Contexto();
    if (contexto.state === "suspended") void contexto.resume();
  } catch {
    // Sin audio disponible: los momentos siguen con texto y animación.
  }
}

/**
 * ¿Ya hay audio listo (creado por un gesto del usuario)? Para momentos que no salen de un toque
 * (p. ej. se cortó internet): suenan solo si el usuario ya tocó algo con el sonido encendido, así
 * nunca se crea un AudioContext sin gesto.
 */
export function audioPreparado(): boolean {
  return contexto !== undefined && sonidoEncendido();
}

function cortarAnterior(ctx: AudioContext) {
  for (const { osc, vol } of sonando) {
    try {
      vol.gain.cancelScheduledValues(ctx.currentTime);
      vol.gain.setValueAtTime(0.0001, ctx.currentTime);
      osc.stop();
    } catch {
      // Ya había terminado.
    }
  }
  sonando = [];
}

/**
 * Hace sonar un momento si el sonido está encendido. Seguro de llamar siempre: con el sonido
 * apagado, sin Web Audio o con un momento silencioso (`guardado`) no hace nada.
 */
export function reproducir(momento: Momento): void {
  if (momento === "guardado") return;
  if (typeof window === "undefined" || !sonidoEncendido()) return;
  prepararAudio();
  const ctx = contexto;
  if (!ctx) return;
  try {
    cortarAnterior(ctx);
    const t0 = ctx.currentTime + 0.01;
    for (const n of SONIDOS[momento]) {
      const t = t0 + n.en;
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = n.onda;
      osc.frequency.setValueAtTime(n.desde, t);
      if (n.hasta && n.hasta !== n.desde) osc.frequency.exponentialRampToValueAtTime(n.hasta, t + Math.min(0.06, n.dura / 2));
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(n.vol, t + 0.015);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + n.dura);
      osc.connect(vol).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + n.dura + 0.02);
      const nodo = { osc, vol };
      sonando.push(nodo);
      osc.onended = () => {
        sonando = sonando.filter((s) => s !== nodo);
      };
    }
  } catch {
    // Sin audio disponible: el momento sigue con texto y animación.
  }
}
