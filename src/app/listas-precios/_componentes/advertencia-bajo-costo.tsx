import { fmtMoneda } from "@/lib/money";
import { getPreciosBajoCosto } from "@/lib/queries/listas-precios";

/**
 * SOLO DUEÑO (ola 4)
 *
 * Avisa cuando algun precio de la lista (especifico o con el descuento general)
 * queda por debajo del costo de receta. Es un Server Component: el costo se
 * calcula aca y nunca viaja a un componente cliente. Cuando llegue la ola 4,
 * la pantalla lo muestra solo si el usuario es el dueño.
 */
export async function AdvertenciaBajoCosto({ listaId }: { listaId: string }) {
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
