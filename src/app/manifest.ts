import type { MetadataRoute } from "next";
import { getMarca } from "@/lib/marca";

/** Permite "agregar a la pantalla de inicio": se abre como app, sin barra del navegador. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { nombre } = await getMarca();

  return {
    name: nombre,
    short_name: nombre,
    description: "Control de ventas, costos y cobranzas",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1a171a",
    theme_color: "#1a171a",
    lang: "es-AR",
    icons: [
      { src: "/marca/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/marca/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/marca/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
