import { ETIQUETA_ROL } from "@/lib/dominio/usuarios";
import type { Rol } from "@/lib/auth-pura";

/** Fecha de un instante (timestamptz) en hora de Argentina: `fmtFecha` usa UTC, que de noche cambia el dia. */
export function fechaArgentina(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(fecha);
}

const ESTILO_ROL: Record<Rol, string> = {
  DUENO: "bg-slate-900 text-white",
  EMPLEADO: "bg-sky-50 text-sky-800",
};

export function InsigniaRol({ rol }: { rol: Rol }) {
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${ESTILO_ROL[rol]}`}>
      {ETIQUETA_ROL[rol]}
    </span>
  );
}

/** Texto suelto en una pastilla (Vos, Dado de baja, En pausa). */
export function Pastilla({ children, tono }: { children: React.ReactNode; tono: "marca" | "gris" | "aviso" }) {
  const clase = {
    marca: "bg-marca text-tinta",
    gris: "bg-slate-200 text-slate-700",
    aviso: "bg-amber-50 text-amber-800",
  }[tono];
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${clase}`}>{children}</span>;
}
