import type { MetadataRoute } from "next";
import { getMarca } from "@/lib/marca";

/** Permite "agregar a la pantalla de inicio": se abre como app, sin barra del navegador. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { nombre, logo, logoTipo, logoPropio } = await getMarca();

  return {
    name: nombre,
    short_name: nombre,
    description: "Control de ventas, costos y cobranzas",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // Papel de Kiwitt (`--surface` claro de globals.css): la app instalada se ve con la marca de la app.
    background_color: "#fff8ee",
    theme_color: "#fff8ee",
    lang: "es-AR",
    icons: iconosDe(logo, logoTipo, logoPropio),
  };
}

/**
 * Iconos de la app instalable. Si el negocio tiene logo, ese es el icono (`any`: el navegador lo
 * escala). El negocio inicial, con su `Negocio.logoUrl` de siempre (`/marca/logo.png`, un logo
 * apaisado), conserva los iconos cuadrados de `public/marca/`. Sin logo no se declara ninguno:
 * el navegador arma uno con la inicial, en vez de mostrar el de otro negocio.
 */
function iconosDe(logo: string | null, tipo: string | null, propio: boolean): MetadataRoute.Manifest["icons"] {
  if (logo === "/marca/logo.png" && !propio) {
    return [
      { src: "/marca/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/marca/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/marca/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ];
  }
  if (!logo) return [];
  return [{ src: logo, sizes: "any", ...(tipo ? { type: tipo } : {}), purpose: "any" }];
}
