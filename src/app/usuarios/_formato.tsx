import { ETIQUETA_ROL } from "@/lib/dominio/usuarios";
import type { Rol } from "@/lib/auth-pura";
import { Etiqueta } from "@/components/ui";

/** Fecha de un instante (timestamptz) en hora de Argentina: `fmtFecha` usa UTC, que de noche cambia el dia. */
export function fechaArgentina(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(fecha);
}

export function InsigniaRol({ rol }: { rol: Rol }) {
  return <Etiqueta tono={rol === "DUENO" ? "info" : "neutro"}>{ETIQUETA_ROL[rol]}</Etiqueta>;
}

/** Texto suelto en una pastilla (Vos, Dado de baja, En pausa). */
export function Pastilla({ children, tono }: { children: React.ReactNode; tono: "marca" | "gris" | "aviso" }) {
  return <Etiqueta tono={tono === "gris" ? "neutro" : tono}>{children}</Etiqueta>;
}
