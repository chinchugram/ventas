import { usuarioActual } from "@/lib/auth";
import { fmtNumero } from "@/lib/money";
import { puede } from "@/lib/permisos";
import { getProduccionDeVenta } from "@/lib/queries/produccion";
import { Boton, Etiqueta, ListaPanel, TituloBloque } from "@/components/ui";

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
    <section aria-label="Producción" className="mb-4">
      <TituloBloque>Producción</TituloBloque>
      <ListaPanel>
        {lineas.map((l) => (
          <li key={l.ventaItemId} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <p className="text-body break-words text-ink">
                {l.descripcion} <span className="text-ink-muted tabular-nums">× {fmtNumero(l.cantidad)}</span>
              </p>
              <Etiqueta tono={l.trabajoId ? "ok" : "aviso"}>{l.trabajoId ? "Cargado" : "Sin cargar"}</Etiqueta>
            </div>
            <Boton
              href={l.trabajoId ? `/produccion/trabajo/${l.trabajoId}` : `/produccion/cargar/${l.ventaItemId}`}
              variante={l.trabajoId ? "secundario" : "primario"}
              className="shrink-0"
            >
              {l.trabajoId ? "Ver trabajo" : "Cargar"}
              <span className="sr-only"> de {l.descripcion}</span>
            </Boton>
          </li>
        ))}
      </ListaPanel>
    </section>
  );
}
