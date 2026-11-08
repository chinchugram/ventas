/**
 * Modo de uso de la app: "simple" (lo indispensable para vender) o "avanzado" (todo).
 *
 * Es solo una preferencia de presentación de este navegador (cookie): oculta entradas del menú y
 * partes del Inicio. No es un permiso: una pantalla oculta se sigue pudiendo abrir por su dirección,
 * y cada pantalla exige sus permisos como siempre. Cambiar de modo no borra ni toca datos.
 */
export type Modo = "simple" | "avanzado";

export const COOKIE_MODO = "modo";
/** Un negocio nuevo arranca simple: menos pantallas, menos dudas. */
export const MODO_POR_DEFECTO: Modo = "simple";

export function leerModoDe(valor: string | undefined | null): Modo {
  return valor === "avanzado" || valor === "simple" ? valor : MODO_POR_DEFECTO;
}

/** Secciones del menú en modo simple. El resto solo aparece en avanzado. */
export const RUTAS_MODO_SIMPLE: ReadonlySet<string> = new Set([
  "/",
  "/ventas",
  "/clientes",
  "/cobranzas",
  "/catalogo",
  "/cortes",
  "/configuracion",
  "/ayuda",
]);
