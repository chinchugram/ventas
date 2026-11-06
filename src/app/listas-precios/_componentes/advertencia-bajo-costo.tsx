import { fmtMoneda } from "@/lib/money";
import { usuarioActual } from "@/lib/auth";
import { puede } from "@/lib/permisos";
import { getPreciosBajoCosto } from "@/lib/queries/listas-precios";

/**
 * Avisa cuando algun precio de la lista (especifico o con el descuento general)
 * queda por debajo del costo de receta. Es un Server Component: el costo se
 * calcula aca y nunca viaja a un componente cliente.
 *
 * Solo para quien puede `verCostos`. La pagina ya decide si lo pinta, pero el
 * componente lo vuelve a verificar ANTES de consultar: sin permiso ni se leen
 * las recetas ni los costos, aunque alguien lo monte en otra pantalla.
 */
export async function AdvertenciaBajoCosto({ listaId }: { listaId: string }) {
  if (!puede(await usuarioActual(), "verCostos")) return null;
  const bajoCosto = await getPreciosBajoCosto(listaId);
  if (bajoCosto.length === 0) return null;

  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        {bajoCosto.length === 1
          ? "Un artículo se vende por debajo de su costo con esta lista"
          : `${bajoCosto.length} artículos se venden por debajo de su costo con esta lista`}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-amber-900">
        {bajoCosto.map((x) => (
          <li key={x.articuloId}>
            <span className="font-medium">{x.nombre}</span>: {fmtMoneda(x.precio)} contra costo {fmtMoneda(x.costo)}{" "}
            <span className="text-amber-800">
              ({x.origen === "ESPECIFICO" ? "precio específico" : "descuento general"})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
