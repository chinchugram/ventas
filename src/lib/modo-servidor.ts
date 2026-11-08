import { cookies } from "next/headers";
import { COOKIE_MODO, leerModoDe, type Modo } from "@/lib/modo";

/** Modo elegido en este navegador (simple si nunca se eligió). Solo en el servidor. */
export async function modoActual(): Promise<Modo> {
  return leerModoDe((await cookies()).get(COOKIE_MODO)?.value);
}
