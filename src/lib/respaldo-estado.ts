/**
 * Estado del ultimo respaldo de la base (scripts/backup.sh), para avisar en
 * pantalla si quedo viejo. No confundir con src/lib/respaldo.ts, que es el
 * respaldo de *datos de demostracion* cuando no hay base.
 *
 * La fuente es simple a proposito: la fecha de modificacion del .sql.gz mas
 * nuevo en BACKUP_DIR (por defecto ./backups, el mismo que llena el servicio
 * `backup` del compose). Si el directorio no se puede leer, el estado es
 * "desconocido" y la app sigue como si nada.
 *
 * Variables de entorno:
 *   BACKUP_DIR              directorio de respaldos (relativo al proceso de la app)
 *   RESPALDO_AVISO_HORAS    antiguedad a partir de la cual se avisa (48; 0 apaga el aviso)
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const UMBRAL_HORAS_POR_DEFECTO = 48;

export type EstadoRespaldo =
  /** Hay un respaldo dentro del umbral. */
  | { estado: "ok"; ultimo: Date; horas: number }
  /** El ultimo respaldo es mas viejo que el umbral. */
  | { estado: "viejo"; ultimo: Date; horas: number }
  /** El directorio se leyo (o no existe) y no hay ningun respaldo. */
  | { estado: "nunca" }
  /** No se pudo leer el directorio (permisos, etc.): no se avisa. */
  | { estado: "desconocido" }
  /** RESPALDO_AVISO_HORAS=0: el aviso esta apagado. */
  | { estado: "desactivado" };

// ---------------------------------------------------------------------------
// Logica pura (verificada en scripts/verificar-respaldo.ts)
// ---------------------------------------------------------------------------

/** Umbral en horas desde la variable de entorno; vacio o invalido = 48. */
export function umbralDesdeEnv(valor: string | undefined): number {
  if (valor === undefined || valor.trim() === "") return UMBRAL_HORAS_POR_DEFECTO;
  const n = Number(valor.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return UMBRAL_HORAS_POR_DEFECTO;
  return n;
}

/**
 * Decide el estado a partir de la fecha del ultimo respaldo.
 * `ultimo`: Date si hay respaldo, null si no hay ninguno, undefined si no se pudo leer.
 * Un respaldo "del futuro" (reloj desfasado) cuenta como recien hecho.
 */
export function evaluarRespaldo(
  ultimo: Date | null | undefined,
  ahora: Date,
  umbralHoras: number,
): EstadoRespaldo {
  if (umbralHoras <= 0) return { estado: "desactivado" };
  if (ultimo === undefined) return { estado: "desconocido" };
  if (ultimo === null) return { estado: "nunca" };
  const horas = Math.max(0, (ahora.getTime() - ultimo.getTime()) / 3_600_000);
  return horas > umbralHoras ? { estado: "viejo", ultimo, horas } : { estado: "ok", ultimo, horas };
}

/** "hace 5 horas", "hace 3 días". Para el texto del aviso. */
export function describirAntiguedad(horas: number): string {
  if (horas < 1) return "hace menos de una hora";
  if (horas < 48) {
    const h = Math.floor(horas);
    return `hace ${h} ${h === 1 ? "hora" : "horas"}`;
  }
  const dias = Math.floor(horas / 24);
  return `hace ${dias} días`;
}

/** Solo cuentan los volcados terminados (el temporal es `.sql.gz.tmp`). */
export function esArchivoDeRespaldo(nombre: string): boolean {
  return nombre.endsWith(".sql.gz");
}

// ---------------------------------------------------------------------------
// Lectura del disco (servidor)
// ---------------------------------------------------------------------------

export function directorioRespaldos(): string {
  return path.resolve(process.cwd(), process.env.BACKUP_DIR || "backups");
}

/** Fecha del respaldo mas nuevo; null si no hay; undefined si no se pudo leer. */
async function fechaUltimoRespaldo(dir: string): Promise<Date | null | undefined> {
  let nombres: string[];
  try {
    nombres = await readdir(dir);
  } catch (error) {
    // Sin directorio = nunca se hizo un respaldo en esta instalacion.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn("[respaldo-estado] No se pudo leer el directorio de respaldos:", (error as Error).message);
    return undefined;
  }

  let ultimo: Date | null = null;
  for (const nombre of nombres.filter(esArchivoDeRespaldo)) {
    try {
      const info = await stat(path.join(dir, nombre));
      if (info.isFile() && info.size > 0 && (!ultimo || info.mtime > ultimo)) ultimo = info.mtime;
    } catch {
      // Un archivo que desaparece entre readdir y stat (rotacion) no importa.
    }
  }
  return ultimo;
}

export async function getEstadoRespaldo(ahora: Date = new Date()): Promise<EstadoRespaldo> {
  const umbral = umbralDesdeEnv(process.env.RESPALDO_AVISO_HORAS);
  if (umbral <= 0) return { estado: "desactivado" };
  try {
    return evaluarRespaldo(await fechaUltimoRespaldo(directorioRespaldos()), ahora, umbral);
  } catch (error) {
    console.warn("[respaldo-estado] Error inesperado:", error);
    return { estado: "desconocido" };
  }
}
