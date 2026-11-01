/**
 * Marca visual de un negocio (F4.2): reglas puras, sin base ni Next, para que las pruebe
 * `scripts/verificar-marca.ts`.
 *
 * Aca vive la validacion del logo que sube el dueño. Es lo unico que entra a la app desde
 * afuera y despues se sirve a TODOS (incluida la pantalla de /login, sin sesion), asi que se
 * trata como no confiable:
 *  - el tipo se decide por los PRIMEROS BYTES, nunca por el nombre ni por el `type` que mande
 *    el navegador;
 *  - PNG y JPG se aceptan tal cual (el navegador no ejecuta nada de una imagen);
 *  - SVG solo si pasa una LISTA BLANCA estricta (elementos, atributos y valores). Lo que no
 *    se reconoce se RECHAZA (no se "limpia"): un SVG con `<script>`, `onload=`, `<foreignObject>`,
 *    referencias externas, DOCTYPE/entidades o CSS con `url(...)` externo no se guarda.
 *    Ademas la ruta que lo sirve lo manda con CSP `sandbox` y `nosniff` (defensa en profundidad).
 */

/** Tope del archivo: 1 MB. */
export const MAX_LOGO_BYTES = 1024 * 1024;

export type TipoLogo = "image/png" | "image/jpeg" | "image/svg+xml";

export const EXTENSION_DE_TIPO: Record<TipoLogo, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

export type LogoValidado = { tipo: TipoLogo; bytes: Uint8Array };
export type ResultadoLogo = { ok: true; logo: LogoValidado } | { ok: false; error: string };

const ERROR_FORMATO = "El archivo no es un logo válido. Subí una imagen PNG, JPG o SVG.";

function fmtTamano(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function empiezaCon(bytes: Uint8Array, firma: number[]): boolean {
  return firma.length <= bytes.length && firma.every((b, i) => bytes[i] === b);
}

/**
 * Valida el archivo del logo y devuelve el tipo real y los bytes a guardar. El mensaje de
 * error es para mostrar tal cual al dueño.
 */
export function validarLogo(bytes: Uint8Array): ResultadoLogo {
  if (bytes.length === 0) return { ok: false, error: "El archivo está vacío." };
  if (bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, error: `El logo pesa ${fmtTamano(bytes.length)} y el máximo es 1 MB. Probá con una imagen más liviana.` };
  }
  if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, logo: { tipo: "image/png", bytes } };
  }
  if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return { ok: true, logo: { tipo: "image/jpeg", bytes } };

  // ¿Texto? (SVG). Cualquier otra cosa binaria (GIF, WebP, PDF, ejecutables...) no entra.
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: ERROR_FORMATO };
  }
  if (!/^\s*(?:<\?xml|<svg|<!--)/i.test(texto.replace(/^﻿/, ""))) return { ok: false, error: ERROR_FORMATO };
  const svg = validarSvg(texto);
  if (!svg.ok) return svg;
  return { ok: true, logo: { tipo: "image/svg+xml", bytes: new TextEncoder().encode(svg.svg) } };
}

// ─── SVG ─────────────────────────────────────────────────────────────────────

const ELEMENTOS_SVG = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs",
  "lineargradient", "radialgradient", "stop", "clippath", "mask", "symbol", "use", "title", "desc",
  "text", "tspan", "style",
]);

const ATRIBUTOS_SVG = new Set([
  "id", "class", "style", "viewbox", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2",
  "fx", "fy", "fr", "dx", "dy", "d", "points", "transform", "offset", "preserveaspectratio", "version", "baseprofile",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask", "opacity", "color", "display", "visibility",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "stroke-opacity", "stop-color", "stop-opacity", "gradientunits", "gradienttransform",
  "spreadmethod", "clippathunits", "maskunits", "maskcontentunits", "font-family", "font-size", "font-weight",
  "font-style", "text-anchor", "letter-spacing", "dominant-baseline", "xml:space", "enable-background",
  "href", "xlink:href", "xmlns", "xmlns:xlink",
]);

const NS_SVG = "http://www.w3.org/2000/svg";
const NS_XLINK = "http://www.w3.org/1999/xlink";

const MAX_ELEMENTOS_SVG = 20_000;
const MAX_PROFUNDIDAD_SVG = 64;

// Una etiqueta de apertura/cierre. Los atributos SIEMPRE llevan valor entre comillas (XML bien
// formado); cualquier otra forma no coincide y el SVG se rechaza. Sin cuantificadores anidados
// que se solapen (el nombre no contiene espacios): no hay backtracking explosivo.
const ETIQUETA = /<(\/?)([A-Za-z][A-Za-z0-9_.:-]*)((?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
const ATRIBUTO = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
const DECLARACION_XML = /<\?xml\s[^?<>]*\?>/y;

const ENTIDADES_OK = /&(?:amp|lt|gt|quot|apos);/g;

/** Texto o valor sin entidades raras (`&#...;`, entidades propias) ni barras invertidas. */
function textoLimpio(s: string): boolean {
  return !s.replace(ENTIDADES_OK, "").includes("&") && !s.includes("\\");
}

/** CSS (atributo `style` o elemento `<style>`): nada de @import/@font-face ni url() que no sea interna. */
function cssSeguro(css: string): boolean {
  if (!textoLimpio(css)) return false;
  if (css.includes("@") || css.includes("<") || css.includes("/*")) return false;
  if (/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/i.test(css)) return false;
  for (const m of css.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    if (!(m[2] ?? "").startsWith("#")) return false;
  }
  // Un `url(` que la regex de arriba no entendio tambien se rechaza.
  return (css.match(/url\s*\(/gi)?.length ?? 0) === (css.match(/url\s*\(\s*(['"]?)[^)'"]*\1\s*\)/gi)?.length ?? 0);
}

function valorDeAtributoSeguro(nombre: string, valor: string): boolean {
  if (!textoLimpio(valor)) return false;
  if (/javascript:|vbscript:|data:|expression\s*\(/i.test(valor)) return false;
  if (nombre === "href" || nombre === "xlink:href") return valor.startsWith("#") && valor.length > 1;
  if (nombre === "style") return cssSeguro(valor);
  if (nombre === "xmlns") return valor === NS_SVG;
  if (nombre === "xmlns:xlink") return valor === NS_XLINK;
  // fill="url(#grad)", clip-path="url(#c)", mask="url(#m)": solo referencias internas.
  if (/url\s*\(/i.test(valor)) return /^\s*url\(\s*['"]?#[^)'"]+['"]?\s*\)\s*(?:none|[a-z]+)?\s*$/i.test(valor);
  return true;
}

export type ResultadoSvg = { ok: true; svg: string } | { ok: false; error: string };

/**
 * Valida un SVG contra la lista blanca. Devuelve el mismo texto (sin BOM ni comentarios ni
 * declaracion XML) si es seguro. No intenta arreglar nada: ante la duda, rechaza.
 */
export function validarSvg(entrada: string): ResultadoSvg {
  const no = (detalle: string): ResultadoSvg => ({
    ok: false,
    error: `El SVG no se puede usar: ${detalle}. Exportalo como SVG simple (sin scripts, imágenes incrustadas ni enlaces) o subí un PNG.`,
  });
  const texto = entrada.replace(/^﻿/, "");
  const salida: string[] = [];
  const pila: string[] = [];
  let i = 0;
  let raiz = false;
  let cerroRaiz = false;
  let elementos = 0;

  while (i < texto.length) {
    const lt = texto.indexOf("<", i);
    const tramo = texto.slice(i, lt === -1 ? texto.length : lt);

    if (tramo.length > 0) {
      if (pila.length === 0) {
        if (tramo.trim() !== "") return no("hay texto fuera del elemento <svg>");
      } else {
        if (!textoLimpio(tramo)) return no("tiene entidades o caracteres no permitidos");
        const actual = pila[pila.length - 1] ?? "";
        if (actual === "style") {
          if (!cssSeguro(tramo)) return no("el CSS incluido usa @import, url() externas u otras construcciones no permitidas");
        } else if (!["text", "tspan", "title", "desc"].includes(actual) && tramo.trim() !== "") {
          return no(`hay texto suelto dentro de <${actual}>`);
        }
      }
      salida.push(tramo);
    }
    if (lt === -1) break;
    i = lt;

    if (texto.startsWith("<!--", i)) {
      const fin = texto.indexOf("-->", i + 4);
      if (fin === -1) return no("comentario sin cerrar");
      i = fin + 3;
      continue;
    }
    if (texto.startsWith("<?", i)) {
      DECLARACION_XML.lastIndex = i;
      if (raiz || !DECLARACION_XML.test(texto)) return no("tiene instrucciones de procesamiento no permitidas");
      i = DECLARACION_XML.lastIndex;
      continue;
    }

    ETIQUETA.lastIndex = i;
    const m = ETIQUETA.exec(texto);
    if (!m) {
      if (texto.startsWith("<!", i)) return no("tiene DOCTYPE, CDATA o entidades");
      return no("hay una etiqueta mal formada o con atributos sin comillas");
    }
    i = ETIQUETA.lastIndex;
    const cierre = m[1] ?? "";
    const nombreCrudo = m[2] ?? "";
    const atributos = m[3] ?? "";
    const autocierre = m[4] ?? "";
    const nombre = nombreCrudo.toLowerCase();

    if (!ELEMENTOS_SVG.has(nombre)) return no(`el elemento <${nombreCrudo}> no está permitido`);
    if (++elementos > MAX_ELEMENTOS_SVG) return no("tiene demasiados elementos");

    if (cierre) {
      if (atributos.trim() !== "" || autocierre) return no("etiqueta de cierre inválida");
      if (pila.pop() !== nombre) return no("las etiquetas no están bien anidadas");
      if (pila.length === 0) cerroRaiz = true;
      salida.push(m[0]);
      continue;
    }

    if (pila.length === 0) {
      if (raiz || cerroRaiz) return no("tiene más de un elemento raíz");
      if (nombre !== "svg") return no("el elemento raíz tiene que ser <svg>");
      raiz = true;
    } else if (nombre === "svg") {
      return no("tiene <svg> anidados");
    }

    let tieneNs = false;
    const vistos = new Set<string>();
    for (const a of atributos.matchAll(ATRIBUTO)) {
      const nombreAttr = a[1] ?? "";
      const attr = nombreAttr.toLowerCase();
      const valor = a[2] ?? a[3] ?? "";
      if (!ATRIBUTOS_SVG.has(attr)) return no(`el atributo "${nombreAttr}" no está permitido`);
      if (vistos.has(attr)) return no(`el atributo "${nombreAttr}" está repetido`);
      vistos.add(attr);
      if (!valorDeAtributoSeguro(attr, valor)) return no(`el valor del atributo "${nombreAttr}" no está permitido`);
      if (attr === "xmlns" && nombre === "svg") tieneNs = true;
    }
    if (nombre === "svg" && pila.length === 0 && !tieneNs) {
      return no('falta xmlns="http://www.w3.org/2000/svg" en <svg>');
    }
    if (nombre !== "svg" && (vistos.has("xmlns") || vistos.has("xmlns:xlink"))) return no("xmlns solo va en <svg>");
    if (nombre === "use" && !vistos.has("href") && !vistos.has("xlink:href")) return no("<use> sin referencia interna");

    if (!autocierre) {
      if (pila.length >= MAX_PROFUNDIDAD_SVG) return no("está anidado en exceso");
      pila.push(nombre);
    } else if (pila.length === 0) {
      cerroRaiz = true;
    }
    salida.push(m[0]);
  }

  if (!raiz) return no("no tiene elemento <svg>");
  if (pila.length > 0) return no("hay etiquetas sin cerrar");
  return { ok: true, svg: salida.join("") };
}

// ─── Nombre e iniciales ──────────────────────────────────────────────────────

/** Hasta dos iniciales del nombre ("HL Laser" → "HL", "Taller" → "T") para el placeholder sin logo. */
export function inicialesDe(nombre: string): string {
  const palabras = nombre
    .normalize("NFC")
    .split(/\s+/)
    .map((p) => [...p].find((c) => /[\p{L}\p{N}]/u.test(c)))
    .filter((c): c is string => Boolean(c));
  const letras = palabras.slice(0, 2);
  return letras.join("").toLocaleUpperCase("es-AR") || "?";
}

/**
 * `Negocio.logoUrl` solo se usa si es una ruta del propio sitio ("/marca/logo.png") o una
 * URL https. Cualquier otra cosa (javascript:, data:, //host) se descarta: nunca llega a un `src`.
 */
export function logoUrlSegura(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u) return null;
  if (u.startsWith("/") && !u.startsWith("//") && !u.includes("\\") && !/[\s<>"']/.test(u)) return u;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" && !/[\s<>"']/.test(u) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Tipo de imagen por la extension de una ruta propia (para los iconos del manifiesto). */
export function tipoPorExtension(ruta: string): TipoLogo | null {
  const limpia = (ruta.split(/[?#]/)[0] ?? "").toLowerCase();
  if (limpia.endsWith(".png")) return "image/png";
  if (limpia.endsWith(".jpg") || limpia.endsWith(".jpeg")) return "image/jpeg";
  if (limpia.endsWith(".svg")) return "image/svg+xml";
  return null;
}
