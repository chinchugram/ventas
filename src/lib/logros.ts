import type { Dinero } from "@/lib/money";

/*
 * Logros que una acción de servidor le informa a la pantalla (momentos.md, momento "logro"):
 * la pantalla los festeja con el estallido, el acorde ascendente y un mensaje de marca.
 *
 * Es un campo OPCIONAL del resultado (`{ ok: true, …, logro? }`): quien no lo mira (scripts,
 * tests, otras pantallas) sigue igual. Sin dependencias de Next: lo usan las acciones y el cliente.
 */

export type Logro =
  /** La venta dejó el margen del mes arriba de la meta (antes estaba abajo). Porcentajes como texto. */
  | { tipo: "meta"; margenPct: string; metaPct: string }
  /** Se cargó el primer cliente del negocio. */
  | { tipo: "primerCliente"; nombre: string };

/**
 * ¿El margen del mes cruzó la meta hacia arriba? Misma regla que el tablero (`GananciaDelMes`:
 * "Arriba de la meta" es margen >= meta). Sin ventas antes, el margen era 0.
 */
export function cruzoLaMeta(antes: Dinero, despues: Dinero, meta: Dinero): boolean {
  return antes.cmp(meta) < 0 && despues.cmp(meta) >= 0;
}
