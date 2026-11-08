/**
 * Tema de colores elegido en este navegador (cookie). "sistema" sigue al dispositivo
 * (`prefers-color-scheme`); "claro" y "oscuro" lo fijan. Se aplica con `data-tema` en <html>
 * (ver globals.css). Imprimir sale siempre en claro.
 */
export type Tema = "sistema" | "claro" | "oscuro";

export const COOKIE_TEMA = "tema";

export function leerTemaDe(valor: string | undefined | null): Tema {
  return valor === "claro" || valor === "oscuro" ? valor : "sistema";
}
