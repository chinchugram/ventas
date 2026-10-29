import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { conRespaldo } from "@/lib/respaldo";
import { hoyArgentina } from "@/lib/acciones";
import { d, type Dinero } from "@/lib/money";
import {
  diasRestantes,
  estadoCalculado,
  subtotalLinea,
  totalizarPresupuesto,
  validoHasta,
  type EstadoCalculado,
  type EstadoGuardado,
  type TotalesPresupuesto,
} from "@/lib/presupuestos";

// Lecturas de presupuestos. NUNCA devuelven costos ni margenes: un presupuesto
// solo tiene precios. Sin base (modo demo) todo viene vacio y las pantallas
// muestran el aviso: los presupuestos no existen en el juego de demostracion.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FILTROS_PRESUPUESTO = ["todos", "abierto", "vencido", "convertido", "anulado"] as const;
export type FiltroPresupuesto = (typeof FILTROS_PRESUPUESTO)[number];

export function filtroValido(valor: string | undefined): FiltroPresupuesto {
  return FILTROS_PRESUPUESTO.find((f) => f === valor) ?? "todos";
}

const ESTADO_DE_FILTRO: Record<Exclude<FiltroPresupuesto, "todos">, EstadoCalculado> = {
  abierto: "ABIERTO",
  vencido: "VENCIDO",
  convertido: "CONVERTIDO",
  anulado: "ANULADO",
};

// ─── Listado ──────────────────────────────────────────────────────────────────

export type PresupuestoListado = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  validoHasta: Date;
  clienteId: string;
  clienteNombre: string;
  estado: EstadoCalculado;
  lineas: number;
  total: Dinero;
};

/** Mas recientes primero. El estado "vencido" se calcula aca, con la fecha de hoy en Argentina. */
export const getPresupuestos = cache(
  (filtro: FiltroPresupuesto = "todos"): Promise<PresupuestoListado[]> =>
    conRespaldo(
      async () => {
        const hoy = hoyArgentina();
        const filas = await prisma.presupuesto.findMany({
          orderBy: [{ fecha: "desc" }, { numero: "desc" }],
          take: 300,
          include: {
            cliente: { select: { nombre: true } },
            items: { select: { cantidad: true, precioUnitario: true, ivaPct: true } },
          },
        });
        const todos = filas.map<PresupuestoListado>((p) => ({
          id: p.id,
          numero: p.numero,
          anio: p.anio,
          fecha: p.fecha,
          validoHasta: validoHasta(p.fecha, p.validezDias),
          clienteId: p.clienteId,
          clienteNombre: p.cliente.nombre,
          estado: estadoCalculado(p.estado as EstadoGuardado, p.fecha, p.validezDias, hoy),
          lineas: p.items.length,
          total: totalizarPresupuesto(
            p.items.map((i) => ({ cantidad: d(i.cantidad), precioUnitario: d(i.precioUnitario), ivaPct: d(i.ivaPct) })),
          ).totalBruto,
        }));
        return filtro === "todos" ? todos : todos.filter((p) => p.estado === ESTADO_DE_FILTRO[filtro]);
      },
      () => [],
    ),
);

// ─── Detalle ──────────────────────────────────────────────────────────────────

export type PresupuestoDetalle = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  validezDias: number;
  validoHasta: Date;
  /** Dias hasta el ultimo dia valido (negativo = vencido). */
  diasRestantes: number;
  observaciones: string | null;
  estadoGuardado: EstadoGuardado;
  estado: EstadoCalculado;
  cliente: { id: string; nombre: string; telefono: string | null; activo: boolean };
  items: {
    id: string;
    articuloId: string;
    descripcion: string;
    cantidad: Dinero;
    precioUnitario: Dinero;
    ivaPct: Dinero;
    subtotal: Dinero;
  }[];
  totales: TotalesPresupuesto;
  venta: { id: string; numero: number; anio: number; anulada: boolean } | null;
  duplicadoDe: { id: string; numero: number; anio: number } | null;
};

export const getPresupuesto = cache(
  (id: string): Promise<PresupuestoDetalle | null> =>
    conRespaldo(
      async () => {
        if (!UUID.test(id)) return null;
        const p = await prisma.presupuesto.findUnique({
          where: { id },
          include: {
            cliente: { select: { id: true, nombre: true, telefono: true, activo: true } },
            items: { orderBy: { id: "asc" } },
            venta: { select: { id: true, numero: true, anio: true, estado: true } },
            duplicadoDe: { select: { id: true, numero: true, anio: true } },
          },
        });
        if (!p) return null;
        const hoy = hoyArgentina();
        const items = p.items.map((i) => {
          const linea = { cantidad: d(i.cantidad), precioUnitario: d(i.precioUnitario), ivaPct: d(i.ivaPct) };
          return { id: i.id, articuloId: i.articuloId, descripcion: i.descripcion, ...linea, subtotal: subtotalLinea(linea) };
        });
        return {
          id: p.id,
          numero: p.numero,
          anio: p.anio,
          fecha: p.fecha,
          validezDias: p.validezDias,
          validoHasta: validoHasta(p.fecha, p.validezDias),
          diasRestantes: diasRestantes(p.fecha, p.validezDias, hoy),
          observaciones: p.observaciones,
          estadoGuardado: p.estado as EstadoGuardado,
          estado: estadoCalculado(p.estado as EstadoGuardado, p.fecha, p.validezDias, hoy),
          cliente: p.cliente,
          items,
          totales: totalizarPresupuesto(items),
          venta: p.venta ? { id: p.venta.id, numero: p.venta.numero, anio: p.venta.anio, anulada: p.venta.estado === "ANULADA" } : null,
          duplicadoDe: p.duplicadoDe,
        };
      },
      () => null,
    ),
);

// ─── Para el formulario ───────────────────────────────────────────────────────
// Solo lo necesario para elegir cliente y articulos: sin costos, recetas ni
// margenes (a diferencia de `getArticulosConMargen`).

export type ClienteParaPresupuesto = { id: string; nombre: string; cuit: string | null };
export type ArticuloParaPresupuesto = { id: string; nombre: string; precioVenta: Dinero; ivaPct: Dinero };

export const getClientesParaPresupuesto = cache(
  (): Promise<ClienteParaPresupuesto[]> =>
    conRespaldo(
      () =>
        prisma.cliente.findMany({
          where: { activo: true },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true, cuit: true },
        }),
      () => [],
    ),
);

export const getArticulosParaPresupuesto = cache(
  (): Promise<ArticuloParaPresupuesto[]> =>
    conRespaldo(
      () =>
        prisma.articulo.findMany({
          where: { activo: true },
          orderBy: { nombre: "asc" },
          select: { id: true, nombre: true, precioVenta: true, ivaPct: true },
        }),
      () => [],
    ),
);
