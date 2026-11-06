/**
 * Rango de fechas para reportes, dashboard y exportaciones (CSV).
 *
 * Funcion PURA: no lee el reloj (el "ahora" se inyecta) y no importa Prisma, asi
 * que corre igual en el server, en un test y en un script.
 *
 * ─── Convencion de limites ───────────────────────────────────────────────────
 * Venta.fecha y Pago.fecha son `@db.Date` (dia calendario, sin hora). Prisma los
 * representa como medianoche UTC del dia calendario ARGENTINO (ver `fechaDesdeISO`
 * en `lib/acciones.ts`): una venta del 31/01 se guarda como 2026-01-31T00:00:00Z,
 * sin importar a que hora se cargo. Por eso los limites de este modulo son
 * tambien medianoches UTC de dias calendario, y el filtro es:
 *
 *     fecha >= desde   (desde INCLUSIVO)
 *     fecha <  hasta   (hasta EXCLUSIVO = primer dia que ya NO entra)
 *
 *     where: { fecha: { gte: rango.desde, lt: rango.hasta } }
 *
 * Coincide con `rangoMes` de `queries/ventas.ts` y `dashboard.ts` (UTC, [dia 1,
 * dia 1 del mes siguiente)). La zona Argentina (UTC-3, sin horario de verano)
 * solo interviene en UNA cosa: decidir que dia/mes es "hoy" cuando falta el
 * filtro. A las 23:30 del 31/01 en Argentina ya son las 02:30 del 01/02 en UTC;
 * con `new Date().getMonth()` el servidor (UTC) diria febrero. Aca sigue siendo
 * enero. Nunca se suma ni resta una hora a los limites: no hay "dia de 24h".
 *
 * ─── En la URL el "hasta" es INCLUSIVO ───────────────────────────────────────
 * `?desde=2026-01-01&hasta=2026-01-31` significa "del 1 al 31 de enero, ambos
 * dias incluidos" (lo que espera quien elige fechas en un <input type="date">).
 * Internamente `hasta` (Date) es 2026-02-01 (exclusivo). `hastaISO` es el ultimo
 * dia incluido, para mostrar o para rellenar el input.
 *
 * ─── Entradas invalidas ──────────────────────────────────────────────────────
 * Nunca lanza. Cae a un fallback y lo cuenta en `avisos` (la pantalla puede
 * mostrarlos). Reglas:
 *  - `desde` y/o `hasta` presentes → modo rango (tiene prioridad sobre `mes`).
 *    Si falta uno de los dos o alguno es invalido, se ignora el par entero y se
 *    sigue con `mes`, o con el mes actual.
 *  - `mes` invalido (formato, mes 13, anio fuera de 2000-2100) → mes actual.
 *  - desde > hasta → se INTERCAMBIAN (aviso). Elegi intercambiar y no fallar: el
 *    usuario que puso las fechas al reves quiere el rango entre ambas, y un
 *    reporte vacio o un error en una pantalla de lectura es peor que corregirlo.
 *  - Fechas imposibles (2026-02-30) son invalidas, no se "corrigen" a marzo.
 */

export type TipoRango = "mes" | "rango";

export type RangoFechas = {
  tipo: TipoRango;
  /** Primer dia incluido, medianoche UTC. Usar con `gte`. */
  desde: Date;
  /** Primer dia NO incluido, medianoche UTC. Usar con `lt`. */
  hasta: Date;
  /** Primer dia incluido, "YYYY-MM-DD". */
  desdeISO: string;
  /** ULTIMO dia incluido, "YYYY-MM-DD" (hasta exclusivo menos un dia). */
  hastaISO: string;
  /** Texto para titulos: "Enero 2026" o "01/01/2026 al 15/01/2026". */
  etiqueta: string;
  /** Solo tipo "mes": anio y mes (1-12). */
  anio?: number;
  mes?: number;
  /** Query string canonico ("mes=2026-01" o "desde=..&hasta=.."), sin "?". */
  query: string;
  /** true si no vino un filtro valido y se uso el mes actual. */
  porDefecto: boolean;
  /** Que se corrigio o ignoro de la entrada (vacio si vino todo bien). */
  avisos: string[];
};

/** Lo que llega de `searchParams` de Next (un valor, o array si se repite). */
export type ParamsFecha = Record<string, string | string[] | undefined>;

export const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

export const ANIO_MIN = 2000;
export const ANIO_MAX = 2100;

/** Argentina es UTC-3 todo el anio (sin horario de verano desde 2009). */
const OFFSET_ARGENTINA_MS = -3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

const pad = (n: number, largo = 2) => String(n).padStart(largo, "0");

/** Dia calendario (anio, mes 1-12, dia) en Argentina para un instante dado. */
export function hoyEnArgentina(ahora: Date): { anio: number; mes: number; dia: number } {
  const local = new Date(ahora.getTime() + OFFSET_ARGENTINA_MS);
  return { anio: local.getUTCFullYear(), mes: local.getUTCMonth() + 1, dia: local.getUTCDate() };
}

function aISO(fecha: Date): string {
  return `${pad(fecha.getUTCFullYear(), 4)}-${pad(fecha.getUTCMonth() + 1)}-${pad(fecha.getUTCDate())}`;
}

/** "YYYY-MM-DD" → Date a medianoche UTC; null si el formato o el dia no existen. */
function parseDia(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const anio = Number(m[1]);
  if (anio < ANIO_MIN || anio > ANIO_MAX) return null;
  const fecha = new Date(Date.UTC(anio, Number(m[2]) - 1, Number(m[3])));
  // Ida y vuelta: Date.UTC "corrige" 2026-02-30 a marzo; eso aca es invalido.
  return aISO(fecha) === iso ? fecha : null;
}

/** "YYYY-MM" → { anio, mes }; null si es invalido. */
function parseMes(valor: string): { anio: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (anio < ANIO_MIN || anio > ANIO_MAX || mes < 1 || mes > 12) return null;
  return { anio, mes };
}

const fmtDiaAR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Rango de un mes calendario (mes 1-12). Hasta exclusivo = dia 1 del mes siguiente. */
export function rangoDeMes(anio: number, mes: number, avisos: string[] = [], porDefecto = false): RangoFechas {
  const desde = new Date(Date.UTC(anio, mes - 1, 1));
  const hasta = new Date(Date.UTC(anio, mes, 1)); // mes 12 → enero del anio siguiente
  const mesISO = `${pad(anio, 4)}-${pad(mes)}`;
  return {
    tipo: "mes",
    desde,
    hasta,
    desdeISO: aISO(desde),
    hastaISO: aISO(new Date(hasta.getTime() - DIA_MS)),
    etiqueta: `${MESES_ES[mes - 1]} ${anio}`,
    anio,
    mes,
    query: `mes=${mesISO}`,
    porDefecto,
    avisos,
  };
}

/**
 * Rango entre dos dias, AMBOS incluidos ("YYYY-MM-DD"). Si vienen al reves los
 * intercambia. Devuelve null si alguno es invalido.
 */
export function rangoEntre(desdeISO: string, hastaISO: string, avisos: string[] = []): RangoFechas | null {
  let a = parseDia(desdeISO);
  let b = parseDia(hastaISO);
  if (!a || !b) return null;
  if (a.getTime() > b.getTime()) {
    [a, b] = [b, a];
    avisos.push("Las fechas estaban al revés (desde posterior a hasta); se intercambiaron.");
  }
  const primero = aISO(a);
  const ultimo = aISO(b);
  return {
    tipo: "rango",
    desde: a,
    hasta: new Date(b.getTime() + DIA_MS),
    desdeISO: primero,
    hastaISO: ultimo,
    etiqueta: primero === ultimo ? fmtDiaAR(primero) : `${fmtDiaAR(primero)} al ${fmtDiaAR(ultimo)}`,
    query: `desde=${primero}&hasta=${ultimo}`,
    porDefecto: false,
    avisos,
  };
}

function primerValor(v: string | string[] | undefined): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  const t = x?.trim();
  return t ? t : undefined;
}

/**
 * Interpreta `searchParams` (`mes=YYYY-MM`, o `desde=YYYY-MM-DD&hasta=YYYY-MM-DD`).
 * Sin filtro valido devuelve el mes actual en Argentina segun `ahora`.
 *
 * @param ahora Instante de referencia. Inyectalo en tests; en produccion
 *              el default es el reloj del servidor.
 */
export function parseRangoFechas(params: ParamsFecha, ahora: Date = new Date()): RangoFechas {
  const avisos: string[] = [];
  const desde = primerValor(params.desde);
  const hasta = primerValor(params.hasta);
  const mes = primerValor(params.mes);

  if (desde !== undefined || hasta !== undefined) {
    const r = desde !== undefined && hasta !== undefined ? rangoEntre(desde, hasta, avisos) : null;
    if (r) return r;
    avisos.length = 0;
    avisos.push("Rango de fechas incompleto o inválido (se espera desde=AAAA-MM-DD&hasta=AAAA-MM-DD); se ignoró.");
  }

  if (mes !== undefined) {
    const m = parseMes(mes);
    if (m) return rangoDeMes(m.anio, m.mes, avisos);
    avisos.push(`Mes inválido "${mes}" (se espera AAAA-MM); se usó el mes actual.`);
  }

  const hoy = hoyEnArgentina(ahora);
  return rangoDeMes(hoy.anio, hoy.mes, avisos, true);
}

/**
 * Serializa el filtro a query string SIN "?", para propagarlo a links y al
 * boton de CSV. Siempre explicito: aun el mes actual por defecto sale como
 * `mes=AAAA-MM`, asi el CSV no cambia de mes si se descarga pasada la medianoche
 * del ultimo dia. Parsear lo serializado devuelve el mismo rango.
 */
export function rangoAQuery(rango: Pick<RangoFechas, "query">): string {
  return rango.query;
}

/** "/ventas/export" + rango → "/ventas/export?mes=2026-01" (respeta un "?" previo). */
export function conRango(ruta: string, rango: Pick<RangoFechas, "query">): string {
  return `${ruta}${ruta.includes("?") ? "&" : "?"}${rango.query}`;
}
