import Anthropic from "@anthropic-ai/sdk";
import { SIN_SESION, usuarioActual } from "@/lib/auth";
import { asistenteDisponible, responder, validarConversacion } from "@/lib/ayuda/asistente";

export const dynamic = "force-dynamic";

/**
 * Chat de ayuda: POST { mensajes: [{ rol: "usuario" | "asistente", texto }] } → { respuesta } o { error }.
 * Solo usuarios con sesion de un negocio. No lee ni escribe datos del negocio.
 */

// Tope por usuario para que nadie dispare el gasto. Vive en memoria de cada instancia del
// servidor (en Vercel puede haber varias): es un freno de mano, no una cuota exacta.
const LIMITE_POR_HORA = 30;
const VENTANA_MS = 60 * 60 * 1000;
const usos = new Map<string, number[]>();

function superaLimite(usuarioId: string, ahora: number): boolean {
  const recientes = (usos.get(usuarioId) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (recientes.length >= LIMITE_POR_HORA) {
    usos.set(usuarioId, recientes);
    return true;
  }
  recientes.push(ahora);
  usos.set(usuarioId, recientes);
  return false;
}

function json(cuerpo: object, status = 200): Response {
  return Response.json(cuerpo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const usuario = await usuarioActual();
  if (!usuario) return json({ error: SIN_SESION }, 401);
  if (usuario.rol !== "DUENO" && usuario.rol !== "EMPLEADO") return json({ error: "No disponible." }, 403);
  if (!asistenteDisponible()) return json({ error: "El asistente no está configurado." }, 503);

  // Cuerpo chico: 6 mensajes de ~1000 caracteres entran de sobra en 16 KB.
  const crudo = await request.text();
  if (crudo.length > 16_000) return json({ error: "Mensaje demasiado largo." }, 413);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return json({ error: "Mensaje no válido." }, 400);
  }
  const validado = validarConversacion(cuerpo);
  if (!validado.ok) return json({ error: validado.error }, 400);

  if (superaLimite(usuario.id, Date.now())) {
    return json({ error: "Hiciste muchas preguntas seguidas. Probá de nuevo en un rato." }, 429);
  }

  try {
    const respuesta = await responder(validado.mensajes, usuario.rol);
    return json({ respuesta });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: "El asistente está ocupado. Probá en un minuto." }, 503);
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`[ayuda] Error de la API (${error.status}):`, error.message);
    } else {
      console.error("[ayuda] No se pudo responder:", error);
    }
    return json({ error: "No pude responder ahora. Probá de nuevo." }, 502);
  }
}
