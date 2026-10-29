import { cache } from "react";
import { dbDisponible } from "@/lib/prisma";

const baseDisponible = cache(dbDisponible);

/** Se marca cuando algun dato de la pantalla salio del juego de demostracion. */
export const estadoDemo = cache(() => ({ activo: false }));

/**
 * Ejecuta la consulta real; si no hay base (o la consulta falla, por ejemplo
 * con migraciones pendientes) devuelve los datos de demostracion.
 *
 * Asi el sistema se puede mostrar sin Postgres, y con base real nunca mezcla
 * datos de ejemplo: el respaldo solo entra cuando la base no responde.
 */
export async function conRespaldo<T>(real: () => Promise<T>, demo: () => T): Promise<T> {
  if (!(await baseDisponible())) {
    estadoDemo().activo = true;
    return demo();
  }
  try {
    return await real();
  } catch (error) {
    console.warn("[respaldo] La consulta fallo, se usan datos de demostracion:", error);
    estadoDemo().activo = true;
    return demo();
  }
}
