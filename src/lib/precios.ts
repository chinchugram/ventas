import { aMoneda, CERO, d, type Dinero } from "@/lib/money";

/**
 * Precio de una linea de venta segun la lista de precios del cliente.
 *
 * Esta es la UNICA implementacion de la regla; la usan `registrarVentaEnTx`, la
 * pantalla de venta nueva (via una server action) y los scripts. Pura y sin
 * infraestructura: se prueba con `npm run test:precios`.
 *
 * Orden de resolucion:
 *   1. precio especifico del cliente para ese articulo (ListaPrecioItem)
 *   2. precio de catalogo menos el descuento general de la lista
 *   3. precio de catalogo
 * Una lista inactiva se ignora por completo (incluidos sus precios especificos).
 *
 * IVA: los precios de lista usan el mismo criterio que `Articulo.precioVenta`
 * (el valor que se multiplica por la cantidad para obtener el subtotal bruto en
 * `costearLineaVenta`). El IVA de la linea sigue siendo el del articulo.
 */

export type OrigenPrecio = "ESPECIFICO" | "DESCUENTO" | "CATALOGO";

export type ListaDePrecios = {
  activo: boolean;
  /** Porcentaje 0-100 que se descuenta del precio de catalogo. */
  descuentoPct: Dinero;
  /** articuloId → precio especifico. */
  precios: ReadonlyMap<string, Dinero>;
};

export type PrecioResuelto = { precio: Dinero; origen: OrigenPrecio };

/** Arma la lista pura desde una fila de la base (lista + sus items). */
export function listaDePrecios(fila: {
  activo: boolean;
  descuentoPct: Dinero | string | number;
  items: { articuloId: string; precio: Dinero | string | number }[];
}): ListaDePrecios {
  return {
    activo: fila.activo,
    descuentoPct: d(fila.descuentoPct),
    precios: new Map(fila.items.map((i) => [i.articuloId, d(i.precio)])),
  };
}

/** Precio de catalogo menos un porcentaje, redondeado a centavos (lo que se ve es lo que se cobra). */
export function precioConDescuento(precioCatalogo: Dinero, descuentoPct: Dinero): Dinero {
  if (descuentoPct.lt(0) || descuentoPct.gt(100)) {
    throw new RangeError(`Descuento fuera de rango (0-100): ${descuentoPct.toString()}`);
  }
  return aMoneda(precioCatalogo.times(d(100).minus(descuentoPct)).div(100));
}

export function resolverPrecio(params: {
  articuloId: string;
  /** `Articulo.precioVenta`. */
  precioCatalogo: Dinero;
  /** Lista del cliente, o null/undefined si no tiene. */
  lista: ListaDePrecios | null | undefined;
}): PrecioResuelto {
  const { articuloId, precioCatalogo, lista } = params;
  if (!lista || !lista.activo) return { precio: precioCatalogo, origen: "CATALOGO" };

  const especifico = lista.precios.get(articuloId);
  if (especifico !== undefined) return { precio: especifico, origen: "ESPECIFICO" };

  if (lista.descuentoPct.gt(CERO)) {
    return { precio: precioConDescuento(precioCatalogo, lista.descuentoPct), origen: "DESCUENTO" };
  }
  return { precio: precioCatalogo, origen: "CATALOGO" };
}

export type PrecioBajoCosto = {
  articuloId: string;
  nombre: string;
  precio: Dinero;
  costo: Dinero;
  /** De donde sale el precio que queda por debajo del costo. */
  origen: "ESPECIFICO" | "DESCUENTO";
};

/**
 * Articulos cuyo precio en esta lista (especifico o con el descuento general)
 * queda por debajo del costo de receta. El precio de catalogo sin tocar no se
 * revisa aca: eso es el margen del catalogo. Se evalua la lista como si
 * estuviera activa (es para avisar al editarla, incluso de baja). Los articulos
 * sin receta no se evaluan: su costo es desconocido, no cero.
 *
 * Misma vara que el margen del resto del sistema: precio de venta (con IVA)
 * contra costo, o sea ganancia negativa.
 *
 * Maneja costos: usar solo desde codigo de servidor del dueño.
 */
export function preciosBajoCosto(
  lista: ListaDePrecios,
  articulos: { id: string; nombre: string; precioCatalogo: Dinero; costo: Dinero; costoConfiable: boolean }[],
): PrecioBajoCosto[] {
  const evaluada: ListaDePrecios = { ...lista, activo: true };
  const salida: PrecioBajoCosto[] = [];
  for (const a of articulos) {
    if (!a.costoConfiable) continue;
    const { precio, origen } = resolverPrecio({ articuloId: a.id, precioCatalogo: a.precioCatalogo, lista: evaluada });
    if (origen === "CATALOGO") continue;
    if (precio.lt(a.costo)) salida.push({ articuloId: a.id, nombre: a.nombre, precio, costo: a.costo, origen });
  }
  return salida;
}
