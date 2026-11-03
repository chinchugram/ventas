// Utilidades minimas de XML para los mensajes SOAP de ARCA. Se arma y se lee a mano a proposito (docs/06, 4.1): son pocas
// operaciones y asi hay menos dependencias que auditar en algo que maneja credenciales.

export function escaparXml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function desescaparXml(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Contenido de cada `<tag>…</tag>` (con o sin prefijo de namespace), en orden. Sin soporte para tags anidados del mismo nombre. */
export function todos(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]!);
}

/** Contenido del primer `<tag>` (sin escapes), o null si no esta. */
export function primero(xml: string, tag: string): string | null {
  const v = todos(xml, tag)[0];
  return v === undefined ? null : desescaparXml(v.trim());
}

/** ¿Hay un `<tag/>` o `<tag>` en el XML? */
export function tiene(xml: string, tag: string): boolean {
  return new RegExp(`<(?:[\\w.-]+:)?${tag}[\\s/>]`).test(xml);
}

export const fechaArca = (f: Date): string => f.toISOString().slice(0, 10).replace(/-/g, "");

/** `yyyyMMdd` → medianoche UTC (igual que las columnas DATE). null si no es una fecha valida. */
export function parsearFechaArca(texto: string | null): Date | null {
  if (!texto || !/^\d{8}$/.test(texto)) return null;
  const f = new Date(Date.UTC(Number(texto.slice(0, 4)), Number(texto.slice(4, 6)) - 1, Number(texto.slice(6, 8))));
  return fechaArca(f) === texto ? f : null;
}
