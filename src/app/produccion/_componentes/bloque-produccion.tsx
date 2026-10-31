import Link from "next/link";
import { usuarioActual } from "@/lib/auth";
import { fmtNumero } from "@/lib/money";
import { puede } from "@/lib/permisos";
import { getProduccionDeVenta } from "@/lib/queries/produccion";

/**
 * Bloque "Producción" del detalle de una venta: por cada linea, si el trabajo esta
 * cargado y el enlace para cargarlo o verlo. Componente de servidor: verifica
 * `cargarProduccion` ANTES de leer nada (sin permiso no se pinta). Sin costos.
 */
export async function BloqueProduccion({ ventaId }: { ventaId: string }) {
  const usuario = await usuarioActual();
  if (!usuario || !puede(usuario, "cargarProduccion")) return null;
  const lineas = await getProduccionDeVenta(ventaId);
  if (!lineas || lineas.length === 0) return null;

  return (
    <section aria-label="Producción" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Producción</h2>
      <ul className="divide-y divide-slate-100 text-sm">
        {lineas.map((l) => (
          <li key={l.ventaItemId} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="break-words text-slate-900">
                {l.descripcion} <span className="text-slate-500">× {fmtNumero(l.cantidad)}</span>
              </p>
              <p className={l.trabajoId ? "text-xs font-medium text-emerald-800" : "text-xs font-medium text-amber-800"}>
                {l.trabajoId ? "Cargado" : "Sin cargar"}
              </p>
            </div>
            <Link
              href={l.trabajoId ? `/produccion/trabajo/${l.trabajoId}` : `/produccion/cargar/${l.ventaItemId}`}
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800"
            >
              {l.trabajoId ? "Ver trabajo" : "Cargar"}
              <span className="sr-only"> de {l.descripcion}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
