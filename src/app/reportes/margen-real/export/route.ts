import { construirCSV } from "@/lib/csv";
import { SIN_SESION, usuarioActual } from "@/lib/auth";
import { mensajeSinPermiso, puede, type Accion } from "@/lib/permisos";
import { csvDe, leerDetalleCsv, DETALLES_CSV } from "@/lib/margen-real";
import { getMargenReal } from "@/lib/queries/margen-real";
import { parseRangoFechas, type ParamsFecha, type RangoFechas } from "@/lib/rango-fechas";

export const dynamic = "force-dynamic";

/**
 * Export CSV del margen real (6.2). Recibe los mismos parametros de filtro que la
 * pantalla (`?mes=AAAA-MM` o `?desde=..&hasta=..`) y, ademas, `?detalle=`:
 * `articulos` (por defecto), `periodos` o `trabajos`. Las filas salen de
 * `lib/margen-real.ts` (las mismas cifras que la pantalla): aca solo se arma el archivo.
 *
 * Trae costos reales y margenes: pide `verMargenReal` ademas de los permisos de
 * exportacion de los demas reportes, ANTES de leer nada.
 */

// Costos y margenes: hace falta poder verlos Y poder exportarlos.
const PERMISOS_EXPORT: Accion[] = ["exportarCsv", "verReportes", "verCostos", "verMargenes", "verMargenReal"];

/** Texto plano con el estado que corresponde: un 403 claro, nunca una redireccion HTML. */
function denegado(status: 401 | 403, mensaje: string): Response {
  return new Response(mensaje, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function paramsDesde(url: URL): ParamsFecha {
  const params: ParamsFecha = {};
  for (const [clave, valor] of url.searchParams) {
    const previo = params[clave];
    params[clave] = previo === undefined ? valor : Array.isArray(previo) ? [...previo, valor] : [previo, valor];
  }
  return params;
}

/** "2026-10" para un mes, "2026-10-14_2026-10-23" para un rango. */
function periodoDe(rango: RangoFechas): string {
  return rango.tipo === "mes" ? rango.desdeISO.slice(0, 7) : `${rango.desdeISO}_${rango.hastaISO}`;
}

export async function GET(request: Request) {
  // Primero quien es y que puede; recien despues se mira que se pide.
  const usuario = await usuarioActual();
  if (!usuario) return denegado(401, SIN_SESION);
  const faltante = PERMISOS_EXPORT.find((accion) => !puede(usuario, accion));
  if (faltante) return denegado(403, mensajeSinPermiso(faltante));

  const url = new URL(request.url);
  const detalle = leerDetalleCsv(url.searchParams.get("detalle"));
  if (!detalle) {
    return new Response(`Detalle no válido. Opciones: ${DETALLES_CSV.join(", ")}.`, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const rango = parseRangoFechas(paramsDesde(url));
  const reporte = await getMargenReal(rango);
  const { encabezados, filas } = csvDe(detalle, reporte);

  return new Response(construirCSV(encabezados, filas), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="margen-real-${detalle}-${periodoDe(rango)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
