import { EXTENSION_DE_TIPO } from "@/lib/marca-pura";
import { leerLogoPorSlug, type LogoGuardado } from "@/lib/marca";

export const dynamic = "force-dynamic";

/**
 * Logo que subio un negocio (F4.2), por slug. PUBLICA a proposito: el proxy excluye `marca/` y
 * el /login la necesita antes de que haya sesion. Solo sirve logos que `validarLogo` ya acepto
 * (PNG, JPG o SVG de lista blanca) y solo de negocios activos; un slug que no existe, no tiene
 * logo propio o esta inactivo da el mismo 404.
 *
 * Aunque el SVG ya viene validado, se sirve con CSP `sandbox` y `nosniff`: si alguien abre la URL
 * directo, el navegador no ejecuta nada. La version (`?v=`) va en la URL de la marca, asi que
 * con la version vigente se cachea para siempre y cambiar el logo cambia la URL.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let logo: LogoGuardado | null;
  try {
    logo = await leerLogoPorSlug(slug);
  } catch (error) {
    console.error("[marca/logo] No se pudo leer el logo:", error);
    return new Response("No disponible", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!logo) return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });

  const etag = `"${logo.version}"`;
  const vigente = new URL(request.url).searchParams.get("v") === logo.version;
  const cabeceras = {
    "Content-Type": logo.tipo,
    "Content-Disposition": `inline; filename="logo.${EXTENSION_DE_TIPO[logo.tipo]}"`,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": vigente ? "public, max-age=31536000, immutable" : "public, max-age=60, must-revalidate",
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: cabeceras });
  return new Response(logo.bytes as BodyInit, { headers: { ...cabeceras, "Content-Length": String(logo.bytes.length) } });
}
