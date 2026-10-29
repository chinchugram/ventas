/**
 * Auditoria estatica de permisos sobre el codigo de `src/app` (sin base, sin Next).
 * La usan `scripts/verificar-auth.ts` (con AUTH_ESTRICTO=1) y
 * `scripts/verificar-permisos.ts` (siempre).
 *
 *  - Server actions (`actions.ts`): CADA funcion exportada tiene que empezar con
 *    `await requierePermiso("x")` o con `const p = await verificarPermiso("x");
 *    if (!p.ok) return p;`, como PRIMERA sentencia, antes de leer o validar nada.
 *    Una verificacion enterrada en medio de la funcion, o dentro de un `if`, no cuenta.
 *  - Todo archivo con "use server" tiene que ser un `actions.ts` auditado.
 *  - Paginas (`page.tsx`): llaman a `requierePermisoPagina(...)` antes de leer
 *    datos; se devuelven los permisos literales para compararlos contra la tabla
 *    esperada de `verificar-permisos.ts`.
 *  - Route handlers (`route.ts`): verifican sesion y permisos antes de leer nada.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ACCIONES } from "../src/lib/permisos-pura";

export const RAIZ_APP = join(__dirname, "..", "src", "app");
const RAIZ_SRC = join(__dirname, "..", "src");

/** Sin sesion: el login y su accion son lo unico publico. */
export const PUBLICAS = new Set(["login/page.tsx", "login/actions.ts"]);

export type Hallazgo = { archivo: string; detalle: string };

function recorrer(dir: string, aceptar: (nombre: string) => boolean, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) recorrer(ruta, aceptar, salida);
    else if (aceptar(e.name)) salida.push(ruta);
  }
  return salida;
}

export function archivosDe(nombre: RegExp): string[] {
  return recorrer(RAIZ_APP, (n) => nombre.test(n)).sort();
}

export const rel = (archivo: string) => relative(RAIZ_APP, archivo);

// ─── Lector minimo de TypeScript ──────────────────────────────────────────────
// El compilador de TypeScript 7 no trae API de JavaScript y no hay otro parser en
// el repo: un tokenizador chico alcanza para leer los `actions.ts` (funciones
// `export async function` con cuerpo simple). Entiende comentarios, cadenas,
// plantillas y literales de regex, que son lo que podria confundir el conteo de llaves.

type Tok = { t: "id" | "str" | "tpl" | "num" | "p"; v: string };

const ANTES_DE_REGEX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "=>", "return", "&&", "||"]);
const BARRA_INVERTIDA = String.fromCharCode(92);

export function tokenizar(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;

  // Lee una cadena o plantilla que empieza en `i` (con comilla `q`) y devuelve su valor.
  const leerCadena = (q: string): string => {
    let valor = "";
    i += 1;
    while (i < src.length && src[i] !== q) {
      if (src[i] === BARRA_INVERTIDA) {
        valor += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        let prof = 1;
        while (i < src.length && prof > 0) {
          const c = src[i]!;
          if (c === "'" || c === '"' || c === "`") leerCadena(c);
          else {
            if (c === "{") prof += 1;
            if (c === "}") prof -= 1;
            i += 1;
          }
        }
        continue;
      }
      valor += src[i];
      i += 1;
    }
    i += 1;
    return valor;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
    } else if (c === "/" && src[i + 1] === "*") {
      const fin = src.indexOf("*/", i + 2);
      i = fin < 0 ? src.length : fin + 2;
    } else if (c === "'" || c === '"') {
      toks.push({ t: "str", v: leerCadena(c) });
    } else if (c === "`") {
      toks.push({ t: "tpl", v: leerCadena(c) });
    } else if (c === "/" && (toks.length === 0 || ANTES_DE_REGEX.has(toks[toks.length - 1]!.v))) {
      // literal de regex: hasta la "/" que cierra, fuera de una clase [...]
      i += 1;
      let clase = false;
      while (i < src.length && (src[i] !== "/" || clase)) {
        if (src[i] === BARRA_INVERTIDA) i += 1;
        else if (src[i] === "[") clase = true;
        else if (src[i] === "]") clase = false;
        i += 1;
      }
      i += 1;
      while (/[a-z]/.test(src[i] ?? "")) i += 1;
      toks.push({ t: "str", v: "/regex/" });
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[\w$]+/.exec(src.slice(i))!;
      toks.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if (/[0-9]/.test(c)) {
      const m = /^[\w.]+/.exec(src.slice(i))!;
      toks.push({ t: "num", v: m[0] });
      i += m[0].length;
    } else if (src.startsWith("=>", i)) {
      toks.push({ t: "p", v: "=>" });
      i += 2;
    } else {
      toks.push({ t: "p", v: c });
      i += 1;
    }
  }
  return toks;
}

const ABRE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Indice del token que cierra el que abre en `desde` (( [ {), o -1. */
function cerrar(toks: Tok[], desde: number): number {
  const pila: string[] = [];
  for (let k = desde; k < toks.length; k++) {
    const tk = toks[k]!;
    if (tk.t !== "p") continue;
    if (ABRE[tk.v]) pila.push(ABRE[tk.v]!);
    else if (tk.v === pila[pila.length - 1]) {
      pila.pop();
      if (pila.length === 0) return k;
    }
  }
  return -1;
}

/** Tokens de una sentencia que empieza en `desde`: hasta el primer `;` fuera de ( [ {. */
function sentencia(toks: Tok[], desde: number): { tokens: Tok[]; siguiente: number } {
  let prof = 0;
  for (let k = desde; k < toks.length; k++) {
    const tk = toks[k]!;
    if (tk.t !== "p") continue;
    if (tk.v in ABRE) prof += 1;
    else if (tk.v === ")" || tk.v === "]" || tk.v === "}") {
      if (prof === 0) return { tokens: toks.slice(desde, k), siguiente: k }; // cierra el bloque que contiene
      prof -= 1;
      // un `if (...) { ... }` termina en su llave de cierre (si no sigue un `else`)
      if (prof === 0 && tk.v === "}" && toks[desde]?.v === "if" && toks[k + 1]?.v !== "else") {
        return { tokens: toks.slice(desde, k + 1), siguiente: k + 1 };
      }
    } else if (tk.v === ";" && prof === 0) return { tokens: toks.slice(desde, k), siguiente: k + 1 };
  }
  return { tokens: toks.slice(desde), siguiente: toks.length };
}

const VERIFICADORES = new Set(["requierePermiso", "verificarPermiso"]);

/** [const x =] await requierePermiso("a") / verificarPermiso("a")  →  { variable, fn, accion } | null. */
function esLlamadaDePermiso(st: Tok[]): { variable: string | null; fn: string; accion: string | null } | null {
  let k = 0;
  let variable: string | null = null;
  if (st[0]?.v === "const" && st[1]?.t === "id" && st[2]?.v === "=") {
    variable = st[1].v;
    k = 3;
  }
  if (st[k]?.v !== "await" || st[k + 1]?.t !== "id" || !VERIFICADORES.has(st[k + 1]!.v) || st[k + 2]?.v !== "(") return null;
  const arg = st[k + 3];
  const bien = arg?.t === "str" && st[k + 4]?.v === ")" && st.length === k + 5;
  return { variable, fn: st[k + 1]!.v, accion: bien ? arg!.v : null };
}

/** `if (!x.ok) return x` (con o sin llaves). */
function esChequeoDeResultado(st: Tok[] | undefined, variable: string): boolean {
  if (!st) return false;
  const v = st.filter((x) => x.v !== ";").map((x) => x.v).join(" ");
  return v === `if ( ! ${variable} . ok ) return ${variable}` || v === `if ( ! ${variable} . ok ) { return ${variable} }`;
}

export type ResultadoAcciones = {
  /** "ventas/actions.ts#registrarVenta" → accion que exige (o null si no se pudo leer). */
  exigidas: Map<string, string | null>;
  hallazgos: Hallazgo[];
};

/** Analiza el texto de un `actions.ts`. */
export function analizarActions(archivo: string, texto: string): ResultadoAcciones {
  const exigidas = new Map<string, string | null>();
  const hallazgos: Hallazgo[] = [];
  const toks = tokenizar(texto);

  if (!(toks[0]?.t === "str" && toks[0].v === "use server")) {
    hallazgos.push({ archivo, detalle: 'no empieza con la directiva "use server"' });
  }

  // Solo sentencias de nivel superior: se salta cada ( ) [ ] { } completo.
  let k = 0;
  while (k < toks.length) {
    const tk = toks[k]!;
    if (tk.t === "p" && tk.v in ABRE) {
      const fin = cerrar(toks, k);
      k = fin < 0 ? toks.length : fin + 1;
      continue;
    }
    if (!(tk.t === "id" && tk.v === "export")) {
      k += 1;
      continue;
    }

    const sig = toks[k + 1]?.v;
    if (sig === "type" || sig === "interface") {
      k += 2;
      continue;
    }

    const esFuncion = sig === "function" || (sig === "async" && toks[k + 2]?.v === "function");
    if (esFuncion) {
      const asincrona = sig === "async";
      const iNombre = k + (asincrona ? 3 : 2);
      const nombre = toks[iNombre]?.v ?? "?";
      const clave = `${archivo}#${nombre}`;
      if (!asincrona) hallazgos.push({ archivo, detalle: `${nombre}: no es async` });

      // Parametros → tipo de retorno → cuerpo. El cuerpo es la primera "{" fuera de < >, ( ) y [ ].
      const iParams = iNombre + 1;
      const finParams = toks[iParams]?.v === "(" ? cerrar(toks, iParams) : -1;
      let iCuerpo = -1;
      let angulos = 0;
      for (let j = finParams + 1; finParams >= 0 && j < toks.length; j++) {
        const v = toks[j]!;
        if (v.t !== "p") continue;
        if (v.v === "<") angulos += 1;
        else if (v.v === ">") angulos -= 1;
        else if (v.v === "{" && angulos === 0) {
          iCuerpo = j;
          break;
        } else if (v.v === "{" || v.v === "(" || v.v === "[") {
          j = cerrar(toks, j);
          if (j < 0) break;
        }
      }
      const finCuerpo = iCuerpo >= 0 ? cerrar(toks, iCuerpo) : -1;
      if (iCuerpo < 0 || finCuerpo < 0) {
        hallazgos.push({ archivo, detalle: `${nombre}: no se pudo leer el cuerpo de la funcion` });
        exigidas.set(clave, null);
        k = iNombre + 1;
        continue;
      }

      const s0 = sentencia(toks, iCuerpo + 1);
      const llamada = esLlamadaDePermiso(s0.tokens);
      if (!llamada) {
        hallazgos.push({
          archivo,
          detalle: `${nombre}: la PRIMERA sentencia no es \`await requierePermiso("...")\` ni \`const x = await verificarPermiso("...")\``,
        });
        exigidas.set(clave, null);
      } else {
        if (llamada.accion === null || !(ACCIONES as string[]).includes(llamada.accion)) {
          hallazgos.push({ archivo, detalle: `${nombre}: la accion de ${llamada.fn}() no es un literal de \`Accion\` conocido` });
        }
        if (llamada.fn === "verificarPermiso") {
          const s1 = sentencia(toks, s0.siguiente);
          if (!(llamada.variable && esChequeoDeResultado(s1.tokens, llamada.variable))) {
            hallazgos.push({ archivo, detalle: `${nombre}: tras verificarPermiso tiene que seguir \`if (!x.ok) return x;\`` });
          }
        }
        exigidas.set(clave, llamada.accion);
      }
      k = finCuerpo + 1;
      continue;
    }

    // Cualquier otro `export` de valor (const, let, class, default, { a }, *): no se puede auditar.
    if (sig === "{" || sig === "*") {
      hallazgos.push({ archivo, detalle: "re-exporta valores: cada accion tiene que declararse en este archivo para poder auditarla" });
    } else {
      hallazgos.push({ archivo, detalle: `exporta \`${sig ?? "?"}\`: en un archivo de acciones solo se exportan funciones async (y tipos)` });
    }
    k += 2;
  }
  return { exigidas, hallazgos };
}

/** Todos los `actions.ts` de `src/app` (menos los publicos) + los archivos con "use server" que no son `actions.ts`. */
export function auditarAcciones(): ResultadoAcciones {
  const exigidas = new Map<string, string | null>();
  const hallazgos: Hallazgo[] = [];

  for (const archivo of archivosDe(/^actions\.ts$/)) {
    const r = rel(archivo);
    if (PUBLICAS.has(r)) continue;
    const analisis = analizarActions(r, readFileSync(archivo, "utf8"));
    for (const [k, v] of analisis.exigidas) exigidas.set(k, v);
    hallazgos.push(...analisis.hallazgos);
  }

  // Un archivo con "use server" que no se llame `actions.ts` quedaria fuera de la auditoria.
  const todos = recorrer(RAIZ_SRC, (n) => /\.(ts|tsx)$/.test(n));
  for (const archivo of todos) {
    const r = relative(RAIZ_SRC, archivo);
    if (/(^|\/)actions\.ts$/.test(r)) continue;
    if (/^\s*(["'])use server\1/m.test(readFileSync(archivo, "utf8").slice(0, 400))) {
      hallazgos.push({ archivo: r, detalle: 'tiene "use server" pero no se llama actions.ts: sus acciones no se auditan' });
    }
  }
  return { exigidas, hallazgos };
}

// ─── Paginas y route handlers ─────────────────────────────────────────────────

/**
 * Permisos literales de `requierePermisoPagina(...)` en el texto de una pagina,
 * o `null` si no la llama. Cada ruta se compara contra la tabla de
 * `verificar-permisos.ts`.
 */
export function permisosDePagina(texto: string): string[] | null {
  const m = /\brequierePermisoPagina\s*\(([^)]*)\)/.exec(texto);
  if (!m) return null;
  return [...m[1]!.matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]!);
}

/** La llamada a `requierePermisoPagina` va antes de cualquier lectura de datos de la pagina. */
export function verificaAntesDeLeer(texto: string): boolean {
  const verificacion = texto.search(/\brequierePermisoPagina\s*\(/);
  if (verificacion < 0) return false;
  const lectura = texto.search(/\b(get[A-Z]\w*|prisma|dbDisponible)\s*\(/);
  return lectura < 0 || verificacion < lectura;
}

/** "ventas/[id]/page.tsx" → "/ventas/[id]". */
export function rutaDePagina(archivoRel: string): string {
  const ruta = "/" + archivoRel.replace(/(^|\/)page\.tsx$/, "");
  return ruta === "/" ? "/" : ruta.replace(/\/$/, "");
}

export function paginas(): { ruta: string; archivo: string; texto: string }[] {
  return archivosDe(/^page\.tsx$/)
    .map((a) => ({ archivo: rel(a), ruta: rutaDePagina(rel(a)), texto: readFileSync(a, "utf8") }))
    .filter((p) => !PUBLICAS.has(p.archivo));
}

export function routeHandlers(): { archivo: string; texto: string }[] {
  return archivosDe(/^route\.ts$/).map((a) => ({ archivo: rel(a), texto: readFileSync(a, "utf8") }));
}

/** Un route handler verifica sesion (y permisos con `puede`) o usa `requierePermiso`. */
export function verificaRouteHandler(texto: string): boolean {
  return /\b(requierePermiso|verificarPermiso)\s*\(/.test(texto) || (/\busuarioActual\s*\(/.test(texto) && /\bpuede\s*\(/.test(texto));
}
