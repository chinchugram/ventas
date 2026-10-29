import { connection } from "next/server";
import { dbDisponible } from "@/lib/prisma";
import { describirAntiguedad, getEstadoRespaldo } from "@/lib/respaldo-estado";

const fmtFechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Aviso de respaldo viejo. Solo aparece si el ultimo respaldo de la base es
 * mas viejo que el umbral (RESPALDO_AVISO_HORAS, 48 h) o si nunca hubo uno.
 * Sin base (modo demostracion) o si no se puede leer el directorio, no muestra nada.
 */
export async function AvisoRespaldo() {
  // Lee el disco en cada pedido: nunca se prerenderiza.
  await connection();
  if (!(await dbDisponible())) return null;

  const estado = await getEstadoRespaldo();
  if (estado.estado !== "viejo" && estado.estado !== "nunca") return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p className="font-semibold">
        {estado.estado === "nunca"
          ? "Todavía no hay ningún respaldo de la base de datos"
          : `El último respaldo de la base es de ${describirAntiguedad(estado.horas)} (${fmtFechaHora.format(estado.ultimo)})`}
      </p>
      <p className="mt-1 text-amber-800">
        Si el servidor se rompe, se pierde lo cargado desde entonces. Hay que revisar el servicio de
        respaldo (<code className="font-mono text-xs">docker compose ps backup</code>) o generar uno
        con <code className="font-mono text-xs">npm run db:backup</code>.
      </p>
    </div>
  );
}
