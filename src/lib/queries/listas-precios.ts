import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { conRespaldo } from "@/lib/respaldo";
import type { Dinero } from "@/lib/money";
import { listaDePrecios, preciosBajoCosto, type PrecioBajoCosto } from "@/lib/precios";
import { getArticulosConMargen } from "@/lib/queries/catalogo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Las listas no existen en el juego de demostracion: sin base todo viene vacio.

// ─── Listado ──────────────────────────────────────────────────────────────────

export type ListaListado = {
  id: string;
  nombre: string;
  descuentoPct: Dinero;
  activo: boolean;
  /** Cantidad de articulos con precio especifico. */
  preciosEspecificos: number;
  /** Clientes (activos o no) que la tienen asignada. */
  clientes: number;
};

export const getListasPrecios = cache(
  (): Promise<ListaListado[]> =>
    conRespaldo(
      async () => {
        const listas = await prisma.listaPrecio.findMany({
          orderBy: { nombre: "asc" },
          include: { _count: { select: { items: true, clientes: true } } },
        });
        return listas.map((l) => ({
          id: l.id,
          nombre: l.nombre,
          descuentoPct: l.descuentoPct,
          activo: l.activo,
          preciosEspecificos: l._count.items,
          clientes: l._count.clientes,
        }));
      },
      () => [],
    ),
);

// ─── Detalle ──────────────────────────────────────────────────────────────────

export type PrecioDeLista = {
  articuloId: string;
  nombre: string;
  /** Precio de catalogo, solo como referencia al lado del precio de la lista. */
  precioCatalogo: Dinero;
  precio: Dinero;
};

export type ListaDetalle = {
  id: string;
  nombre: string;
  descuentoPct: Dinero;
  activo: boolean;
  clientes: number;
  precios: PrecioDeLista[];
  /** Nombre para mostrar de quien la creo; null = historica o sin usuario ("—"). */
  creadaPor: string | null;
};

export const getListaPrecio = cache(
  (id: string): Promise<ListaDetalle | null> =>
    conRespaldo(
      async () => {
        // Un id que no es uuid haria fallar la consulta: es un 404.
        if (!UUID.test(id)) return null;
        const l = await prisma.listaPrecio.findUnique({
          where: { id },
          include: {
            _count: { select: { clientes: true } },
            // Solo el nombre para mostrar: nunca el hash ni datos de sesion.
            usuario: { select: { nombre: true } },
            items: { include: { articulo: { select: { nombre: true, precioVenta: true, activo: true } } } },
          },
        });
        if (!l) return null;
        return {
          id: l.id,
          nombre: l.nombre,
          descuentoPct: l.descuentoPct,
          activo: l.activo,
          clientes: l._count.clientes,
          precios: l.items
            .map((i) => ({
              articuloId: i.articuloId,
              nombre: i.articulo.activo ? i.articulo.nombre : `${i.articulo.nombre} (de baja)`,
              precioCatalogo: i.articulo.precioVenta,
              precio: i.precio,
            }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
          creadaPor: l.usuario?.nombre ?? null,
        };
      },
      () => null,
    ),
);

export type ArticuloParaLista = { id: string; nombre: string; precioCatalogo: Dinero };

/** Articulos activos (sin costos) para elegir a cual ponerle precio especifico. */
export const getArticulosParaLista = cache(
  (): Promise<ArticuloParaLista[]> =>
    conRespaldo(
      async () => {
        const articulos = await prisma.articulo.findMany({
          where: { activo: true },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true, precioVenta: true },
        });
        return articulos.map((a) => ({ id: a.id, nombre: a.nombre, precioCatalogo: a.precioVenta }));
      },
      () => [],
    ),
);

// ─── Lista de un cliente (formulario y ficha) ─────────────────────────────────

export type ListaOpcion = { id: string; nombre: string; descuentoPct: Dinero; activo: boolean };

/**
 * Listas que se pueden elegir para un cliente: las activas, mas la que ya tiene
 * asignada aunque este de baja (para mostrarla y no perderla al editar).
 */
export const getListasParaElegir = cache(
  (incluirId: string | null): Promise<ListaOpcion[]> =>
    conRespaldo(
      () =>
        prisma.listaPrecio.findMany({
          where: { OR: [{ activo: true }, ...(incluirId ? [{ id: incluirId }] : [])] },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true, descuentoPct: true, activo: true },
        }),
      () => [],
    ),
);

/** Lista asignada a un cliente, o null. */
export const getListaDeCliente = cache(
  (clienteId: string): Promise<ListaOpcion | null> =>
    conRespaldo(
      async () => {
        if (!UUID.test(clienteId)) return null;
        const c = await prisma.cliente.findUnique({
          where: { id: clienteId },
          select: { listaPrecio: { select: { id: true, nombre: true, descuentoPct: true, activo: true } } },
        });
        return c?.listaPrecio ?? null;
      },
      () => null,
    ),
);

// ─── Solo con `verCostos` ─────────────────────────────────────────────────────

/**
 * Precios de la lista por debajo del costo de receta. Usa costos, asi que solo
 * lo consume el componente de servidor `AdvertenciaBajoCosto`, que verifica
 * `verCostos` antes de llamarla; nada de esto viaja a componentes cliente.
 */
export async function getPreciosBajoCosto(listaId: string): Promise<PrecioBajoCosto[]> {
  return conRespaldo(
    async () => {
      if (!UUID.test(listaId)) return [];
      const l = await prisma.listaPrecio.findUnique({
        where: { id: listaId },
        select: { activo: true, descuentoPct: true, items: { select: { articuloId: true, precio: true } } },
      });
      if (!l) return [];
      const articulos = await getArticulosConMargen();
      return preciosBajoCosto(
        listaDePrecios(l),
        articulos.map((a) => ({
          id: a.id,
          nombre: a.nombre,
          precioCatalogo: a.precioVenta,
          costo: a.receta.costoTotal,
          costoConfiable: a.receta.confiable,
        })),
      );
    },
    () => [],
  );
}
