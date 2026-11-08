import { cookies } from "next/headers";
import { COOKIE_MODO, leerModoDe, type Modo } from "@/lib/modo";
import { COOKIE_TEMA, leerTemaDe, type Tema } from "@/lib/tema";

/** Modo elegido en este navegador (simple si nunca se eligió). Solo en el servidor. */
export async function modoActual(): Promise<Modo> {
  return leerModoDe((await cookies()).get(COOKIE_MODO)?.value);
}

/** Tema elegido en este navegador ("sistema" si nunca se eligió). Solo en el servidor. */
export async function temaActual(): Promise<Tema> {
  return leerTemaDe((await cookies()).get(COOKIE_TEMA)?.value);
}
