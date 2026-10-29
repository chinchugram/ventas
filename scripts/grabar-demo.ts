/**
 * Graba la demo con testreel y le agrega la narracion (Edge TTS + ffmpeg).
 *
 * Uso (con `npm run dev` corriendo en el puerto de la definicion):
 *   npm run demo:video
 *
 * Los pasos y los textos viven en recordings/narracion.json. Cada segmento
 * termina con un `wait` con `fill: true`: el script lo estira para que la
 * pantalla dure lo que dura el audio. Para eso graba dos veces: la primera
 * mide cuanto tardan los pasos reales, la segunda ya sale con los tiempos justos.
 *
 * Ojo: el texto de la narracion se envia al servicio de voz de Microsoft Edge.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { EdgeTTS } from "node-edge-tts";

type Paso = { action: string; fill?: boolean; ms?: number; [k: string]: unknown };
type Segmento = { id: string; texto: string; pasos: Paso[] };
type Narracion = { voz: string; idioma: string; segmentos: Segmento[] };

const RAIZ = resolve(__dirname, "..");
const SALIDA = join(RAIZ, "testreel-output");
const AUDIO = join(SALIDA, "audio");
const BASE = join(RAIZ, "recordings", "demo-app.json");
const NARRACION = join(RAIZ, "recordings", "narracion.json");

// Pausa que se deja despues de cada frase antes de pasar a la siguiente pantalla.
const COLCHON_MS = 900;
// Lo que pasa entre que arranca la grabacion y el primer paso (carga de la pagina).
const DESFASE_INICIAL_MS = Number(process.env.DEMO_DESFASE_MS ?? 1500);
// La voz entra un poco despues de que arranca cada segmento.
const RETRASO_VOZ_MS = 300;

const ffmpeg = ffmpegPath as unknown as string;

function duracionAudioMs(archivo: string): number {
  const r = spawnSync(ffmpeg, ["-i", archivo], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  if (!m) throw new Error(`No pude leer la duracion de ${archivo}`);
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

async function generarAudios(n: Narracion): Promise<Map<string, { archivo: string; ms: number }>> {
  mkdirSync(AUDIO, { recursive: true });
  const tts = new EdgeTTS({ voice: n.voz, lang: n.idioma, timeout: 30000 });
  const out = new Map<string, { archivo: string; ms: number }>();
  for (const s of n.segmentos) {
    const hash = createHash("sha1").update(`${n.voz}|${s.texto}`).digest("hex").slice(0, 8);
    const archivo = join(AUDIO, `${s.id}-${hash}.mp3`);
    if (!existsSync(archivo)) {
      console.log(`  voz: ${s.id}`);
      await tts.ttsPromise(s.texto, archivo);
    }
    out.set(s.id, { archivo, ms: duracionAudioMs(archivo) });
  }
  return out;
}

/** Arma la definicion con los waits `fill` resueltos segun `fills`. */
function armarDefinicion(n: Narracion, fills: Map<string, number>, destino: string) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const steps: Paso[] = [];
  for (const s of n.segmentos) {
    for (const p of s.pasos) {
      if (p.fill) steps.push({ action: "wait", ms: fills.get(s.id) ?? 100 });
      else steps.push(p);
    }
  }
  writeFileSync(destino, JSON.stringify({ ...base, outputFormat: "mp4", steps }, null, 2));
}

/** Corre testreel y devuelve la duracion (ms) de cada paso y el video generado. */
function grabar(definicion: string): { pasosMs: number[]; video: string } {
  const r = spawnSync("npx", ["testreel", definicion], { cwd: RAIZ, encoding: "utf8", shell: true });
  const log = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) throw new Error(`testreel fallo:\n${log}`);
  // Los pasos con selector imprimen "click a[href=...] (0.8s)", asi que el nombre no es una sola palabra.
  const pasosMs = [...log.matchAll(/^\s*\[\d+\/\d+\] .* \(([\d.]+)s\)\s*$/gm)].map((m) => Math.round(Number(m[1]) * 1000));
  const total = /\[\d+\/(\d+)\]/.exec(log)?.[1];
  if (total && pasosMs.length !== Number(total)) {
    throw new Error(`Lei ${pasosMs.length} duraciones pero testreel tiene ${total} pasos:\n${log}`);
  }
  const video = /Video: (.+\.mp4)/.exec(log)?.[1]?.trim();
  if (!video) throw new Error(`testreel no informo el video:\n${log}`);
  return { pasosMs, video: resolve(RAIZ, video) };
}

function cortesPorSegmento(n: Narracion, pasosMs: number[]) {
  let i = 0;
  return n.segmentos.map((s) => {
    const ini = i;
    i += s.pasos.length;
    const fillIdx = ini + s.pasos.findIndex((p) => p.fill);
    const otros = pasosMs.slice(ini, i).reduce((a, b) => a + b, 0) - (pasosMs[fillIdx] ?? 0);
    return { id: s.id, indiceInicio: ini, otrosMs: otros };
  });
}

async function main() {
  const n: Narracion = JSON.parse(readFileSync(NARRACION, "utf8"));
  mkdirSync(SALIDA, { recursive: true });
  console.log("Generando voz...");
  const audios = await generarAudios(n);

  const defTmp = join(SALIDA, "_narrado.json");

  console.log("Pasada 1: midiendo pasos...");
  armarDefinicion(n, new Map(), defTmp);
  const p1 = grabar(defTmp);
  const medidos = cortesPorSegmento(n, p1.pasosMs);

  const fills = new Map<string, number>();
  for (const m of medidos) {
    const audioMs = audios.get(m.id)!.ms;
    fills.set(m.id, Math.max(400, audioMs + RETRASO_VOZ_MS + COLCHON_MS - m.otrosMs));
  }

  console.log("Pasada 2: grabando con los tiempos justos...");
  armarDefinicion(n, fills, defTmp);
  const p2 = grabar(defTmp);

  // Momento (ms de video) en que arranca cada segmento.
  const inicios: number[] = [];
  let acum = DESFASE_INICIAL_MS;
  let idx = 0;
  for (const s of n.segmentos) {
    inicios.push(acum);
    for (let k = 0; k < s.pasos.length; k++) acum += p2.pasosMs[idx++] ?? 0;
  }

  // La voz nunca pisa a la anterior.
  const delays: number[] = [];
  let finAnterior = 0;
  n.segmentos.forEach((s, k) => {
    const d = Math.max((inicios[k] ?? 0) + RETRASO_VOZ_MS, finAnterior + 300);
    delays.push(d);
    finAnterior = d + audios.get(s.id)!.ms;
  });

  const destino = join(SALIDA, "demo-ventas-narrado.mp4");
  const entradas = n.segmentos.flatMap((s) => ["-i", audios.get(s.id)!.archivo]);
  const filtros = n.segmentos.map((_, k) => `[${k + 1}:a]adelay=${delays[k]}|${delays[k]}[a${k}]`);
  const mezcla = `${n.segmentos.map((_, k) => `[a${k}]`).join("")}amix=inputs=${n.segmentos.length}:normalize=0,apad[a]`;
  const r = spawnSync(
    ffmpeg,
    ["-y", "-i", p2.video, ...entradas, "-filter_complex", [...filtros, mezcla].join(";"),
     "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", destino],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffmpeg fallo:\n${r.stderr}`);

  console.log("\nSegmentos (inicio de voz en segundos):");
  n.segmentos.forEach((s, k) =>
    console.log(`  ${((delays[k] ?? 0) / 1000).toFixed(1).padStart(5)}s  ${s.id} (${(audios.get(s.id)!.ms / 1000).toFixed(1)}s de voz)`),
  );
  console.log(`\nListo: ${destino}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
