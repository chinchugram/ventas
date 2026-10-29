import { cache } from "react";
import { getConfig } from "@/lib/queries/catalogo";

/** Logo del negocio, servido desde `public/`. Es el mismo para todas las pantallas. */
const LOGO = "/marca/logo.png";

/**
 * Identidad del negocio que usa el sistema. El nombre sale de la configuracion
 * (clave `nombreNegocio`), asi que mostrarlo con otro cliente es cambiar un dato
 * y reemplazar el logo, no tocar el codigo.
 */
export const getMarca = cache(async () => {
  const config = await getConfig();
  return { nombre: config.nombreNegocio?.trim() || "HL Laser", logo: LOGO };
});
