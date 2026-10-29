/**
 * Verificacion de la logica del aviso de respaldo (src/lib/respaldo-estado.ts).
 *
 *   npx tsx scripts/verificar-respaldo.ts
 *
 * La parte pura contra casos conocidos, y la lectura del disco contra un
 * directorio temporal (sin directorio, vacio, con un respaldo viejo y uno nuevo).
 */
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  describirAntiguedad,
  esArchivoDeRespaldo,
  evaluarRespaldo,
  getEstadoRespaldo,
  umbralDesdeEnv,
} from "../src/lib/respaldo-estado";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const ahora = new Date("2026-10-29T12:00:00-03:00");
const haceHoras = (h: number) => new Date(ahora.getTime() - h * 3_600_000);

console.log("--- Umbral desde la variable de entorno ---");
comprobar("sin variable", String(umbralDesdeEnv(undefined)), "48");
comprobar("vacia", String(umbralDesdeEnv("  ")), "48");
comprobar("72", String(umbralDesdeEnv("72")), "72");
comprobar("decimal con coma", String(umbralDesdeEnv("1,5")), "1.5");
comprobar("basura", String(umbralDesdeEnv("dos dias")), "48");
comprobar("negativo", String(umbralDesdeEnv("-3")), "48");
comprobar("0 apaga", String(umbralDesdeEnv("0")), "0");

console.log("--- Estado segun la fecha del ultimo respaldo (umbral 48 h) ---");
comprobar("hace 3 h", evaluarRespaldo(haceHoras(3), ahora, 48).estado, "ok");
comprobar("justo 48 h", evaluarRespaldo(haceHoras(48), ahora, 48).estado, "ok");
comprobar("48 h y 1 minuto", evaluarRespaldo(haceHoras(48 + 1 / 60), ahora, 48).estado, "viejo");
comprobar("hace 10 dias", evaluarRespaldo(haceHoras(240), ahora, 48).estado, "viejo");
comprobar("del futuro (reloj desfasado)", evaluarRespaldo(haceHoras(-5), ahora, 48).estado, "ok");
comprobar("ninguno", evaluarRespaldo(null, ahora, 48).estado, "nunca");
comprobar("no se pudo leer", evaluarRespaldo(undefined, ahora, 48).estado, "desconocido");
comprobar("aviso apagado", evaluarRespaldo(haceHoras(999), ahora, 0).estado, "desactivado");
const viejo = evaluarRespaldo(haceHoras(73), ahora, 48);
comprobar("horas del viejo", viejo.estado === "viejo" ? String(viejo.horas) : "-", "73");

console.log("--- Texto de antiguedad ---");
comprobar("20 minutos", describirAntiguedad(1 / 3), "hace menos de una hora");
comprobar("1 hora", describirAntiguedad(1.2), "hace 1 hora");
comprobar("30 horas", describirAntiguedad(30.9), "hace 30 horas");
comprobar("49 horas", describirAntiguedad(49), "hace 2 días");
comprobar("10 dias", describirAntiguedad(245), "hace 10 días");

console.log("--- Que archivos cuentan ---");
comprobar("volcado", String(esArchivoDeRespaldo("ventas-20261029-031500.sql.gz")), "true");
comprobar("temporal a medias", String(esArchivoDeRespaldo("ventas-20261029-031500.sql.gz.tmp")), "false");
comprobar("otro archivo", String(esArchivoDeRespaldo("notas.txt")), "false");

async function conDirectorio() {
  console.log("--- Lectura del directorio (BACKUP_DIR temporal) ---");
  const base = await mkdtemp(path.join(tmpdir(), "verificar-respaldo-"));
  const anterior = process.env.BACKUP_DIR;
  try {
    process.env.BACKUP_DIR = path.join(base, "no-existe");
    comprobar("sin directorio", (await getEstadoRespaldo(ahora)).estado, "nunca");

    process.env.BACKUP_DIR = base;
    comprobar("directorio vacio", (await getEstadoRespaldo(ahora)).estado, "nunca");

    const viejoArchivo = path.join(base, "ventas-20261020-030000.sql.gz");
    await writeFile(viejoArchivo, "x");
    await utimes(viejoArchivo, haceHoras(200), haceHoras(200));
    const tmp = path.join(base, "ventas-20261029-110000.sql.gz.tmp");
    await writeFile(tmp, "x");
    await utimes(tmp, haceHoras(1), haceHoras(1));
    comprobar("solo uno viejo (el .tmp no cuenta)", (await getEstadoRespaldo(ahora)).estado, "viejo");

    const vacio = path.join(base, "ventas-20261029-100000.sql.gz");
    await writeFile(vacio, "");
    await utimes(vacio, haceHoras(2), haceHoras(2));
    comprobar("un .sql.gz vacio no cuenta", (await getEstadoRespaldo(ahora)).estado, "viejo");

    const nuevo = path.join(base, "ventas-20261029-090000.sql.gz");
    await writeFile(nuevo, "x");
    await utimes(nuevo, haceHoras(3), haceHoras(3));
    const estado = await getEstadoRespaldo(ahora);
    comprobar("con uno nuevo", estado.estado, "ok");
    comprobar("toma el mas nuevo", estado.estado === "ok" ? String(estado.horas) : "-", "3");

    process.env.RESPALDO_AVISO_HORAS = "2";
    comprobar("umbral 2 h por variable", (await getEstadoRespaldo(ahora)).estado, "viejo");
    delete process.env.RESPALDO_AVISO_HORAS;

    process.env.BACKUP_DIR = nuevo; // un archivo, no un directorio: no se puede leer
    comprobar("BACKUP_DIR ilegible", (await getEstadoRespaldo(ahora)).estado, "desconocido");
  } finally {
    if (anterior === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = anterior;
    await rm(base, { recursive: true, force: true });
  }
}

conDirectorio().then(() => {
  console.log("");
  console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
});
