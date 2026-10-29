import { ErrorDeNegocio } from "@/lib/acciones";
import type { Dinero } from "@/lib/money";
import { listaDePrecios, resolverPrecio, type ListaDePrecios, type PrecioResuelto } from "@/lib/precios";
import type { Tx } from "./tx";

export type DatosLista = {
  nombre: string;
  /** Porcentaje 0-100 (2 decimales). */
  descuentoPct: Dinero;
};

async function leerListaDeCliente(tx: Tx, clienteId: string, articuloIds: string[]) {
  const cliente = await tx.cliente.findUnique({
    where: { id: clienteId },
    select: {
      listaPrecio: {
        select: {
          nombre: true,
          activo: true,
          descuentoPct: true,
          items: { where: { articuloId: { in: articuloIds } }, select: { articuloId: true, precio: true } },
        },
      },
    },
  });
  return cliente?.listaPrecio ?? null;
}

/**
 * Lista de precios del cliente con los precios especificos de `articuloIds`,
 * lista para `resolverPrecio`. Devuelve null si el cliente no tiene lista.
 * Una lista inactiva se devuelve igual (con `activo: false`) y la ignora el
 * resolvedor: asi hay un solo lugar donde se decide que "inactiva = no aplica".
 */
export async function cargarListaDeCliente(
  tx: Tx,
  clienteId: string,
  articuloIds: string[],
): Promise<ListaDePrecios | null> {
  const fila = await leerListaDeCliente(tx, clienteId, articuloIds);
  return fila ? listaDePrecios(fila) : null;
}

export type PreciosDeCliente = {
  /** Lista del cliente, si tiene una activa (la de baja no se aplica y no se informa). */
  lista: { nombre: string; descuentoPct: Dinero } | null;
  /** articuloId → precio que se le cobraria hoy a ese cliente. */
  precios: Map<string, PrecioResuelto>;
};

/**
 * Precios que se le cobrarian a un cliente por estos articulos, para mostrarlos
 * al cargar una venta. Solo precios de venta: nunca costos. El que manda sigue
 * siendo `registrarVentaEnTx`, que recalcula al confirmar.
 */
export async function preciosDeClienteEnTx(tx: Tx, clienteId: string, articuloIds: string[]): Promise<PreciosDeCliente> {
  const fila = await leerListaDeCliente(tx, clienteId, articuloIds);
  const lista = fila ? listaDePrecios(fila) : null;
  const articulos = await tx.articulo.findMany({
    where: { id: { in: articuloIds }, activo: true },
    select: { id: true, precioVenta: true },
  });
  return {
    lista: fila && fila.activo ? { nombre: fila.nombre, descuentoPct: fila.descuentoPct } : null,
    precios: new Map(
      articulos.map((a) => [a.id, resolverPrecio({ articuloId: a.id, precioCatalogo: a.precioVenta, lista })]),
    ),
  };
}

/** El nombre es unico sin distinguir mayusculas; la base es la garantia final (indice unico). */
async function verificarNombreLibre(tx: Tx, nombre: string, excepto?: string) {
  const otra = await tx.listaPrecio.findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" }, ...(excepto ? { id: { not: excepto } } : {}) },
    select: { activo: true },
  });
  if (otra) throw new ErrorDeNegocio(`Ya hay una lista llamada "${nombre}"${otra.activo ? "" : " (dada de baja)"}.`);
}

function verificarDescuento(descuentoPct: Dinero) {
  if (descuentoPct.lt(0) || descuentoPct.gt(100)) throw new ErrorDeNegocio("El descuento tiene que estar entre 0 y 100.");
}

/** `usuarioId` es quien la crea (null = sin usuario): queda fijo, editar no lo cambia. */
export async function crearListaEnTx(tx: Tx, datos: DatosLista, usuarioId?: string | null): Promise<{ id: string }> {
  const nombre = datos.nombre.trim();
  verificarDescuento(datos.descuentoPct);
  await verificarNombreLibre(tx, nombre);
  return tx.listaPrecio.create({
    data: { nombre, descuentoPct: datos.descuentoPct, usuarioId: usuarioId ?? null },
    select: { id: true },
  });
}

export async function editarListaEnTx(tx: Tx, id: string, datos: DatosLista): Promise<void> {
  const nombre = datos.nombre.trim();
  verificarDescuento(datos.descuentoPct);
  const actual = await tx.listaPrecio.findUnique({ where: { id }, select: { id: true } });
  if (!actual) throw new ErrorDeNegocio("La lista no existe.");
  await verificarNombreLibre(tx, nombre, id);
  await tx.listaPrecio.update({ where: { id }, data: { nombre, descuentoPct: datos.descuentoPct } });
}

/**
 * Baja logica (`activo = false`) o reactivacion. Una lista nunca se borra: los
 * clientes que la tienen asignada la conservan, pero mientras este de baja sus
 * precios no se aplican (ver `resolverPrecio`).
 */
export async function cambiarActivoListaEnTx(tx: Tx, id: string, activo: boolean): Promise<void> {
  const r = await tx.listaPrecio.updateMany({ where: { id }, data: { activo } });
  if (r.count === 0) throw new ErrorDeNegocio("La lista no existe.");
}

/** Alta o edicion del precio especifico de un articulo en una lista (uno por par). */
export async function guardarPrecioListaEnTx(tx: Tx, listaId: string, articuloId: string, precio: Dinero): Promise<void> {
  if (precio.lt(0)) throw new ErrorDeNegocio("El precio no puede ser negativo.");
  const lista = await tx.listaPrecio.findUnique({ where: { id: listaId }, select: { id: true } });
  if (!lista) throw new ErrorDeNegocio("La lista no existe.");
  const articulo = await tx.articulo.findFirst({ where: { id: articuloId, activo: true }, select: { id: true } });
  if (!articulo) throw new ErrorDeNegocio("El artículo no existe o está dado de baja.");
  await tx.listaPrecioItem.upsert({
    where: { listaPrecioId_articuloId: { listaPrecioId: listaId, articuloId } },
    create: { listaPrecioId: listaId, articuloId, precio },
    update: { precio },
  });
}

/**
 * Quita el precio especifico: el articulo vuelve a la regla general de la lista.
 * Es configuracion, no historia (las ventas ya hechas guardan el precio que se uso).
 */
export async function quitarPrecioListaEnTx(tx: Tx, listaId: string, articuloId: string): Promise<void> {
  await tx.listaPrecioItem.deleteMany({ where: { listaPrecioId: listaId, articuloId } });
}
