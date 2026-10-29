import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { demoVentas } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { aMoneda, d, fmtFecha, type Dinero, sumar } from "@/lib/money";
import { estadoPago, type EstadoPago } from "@/lib/costing";

/** Una venta del listado, sin costo ni margen: lo que puede ver cualquier usuario con sesion. */
export type VentaListado = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  estado: "PENDIENTE" | "ENTREGADA" | "ANULADA";
  clienteNombre: string;
  clienteId: string;
  items: number;
  totalBruto: Dinero;
  pagado: Dinero;
  saldo: Dinero;
  estadoPago: EstadoPago;
};

/** Con costo y ganancia: solo para quien puede `verCostos` / `verMargenes`. */
export type VentaRow = VentaListado & {
  costoTotal: Dinero;
  ganancia: Dinero;
};

/** La fila trae costo y ganancia (solo las arma `getVentas`, nunca `getVentasSinCostos`). */
export function tieneGanancia(venta: VentaListado): venta is VentaRow {
  return "ganancia" in venta;
}

/**
 * Listado de ventas con margen y estado de pago.
 *
 * `pagos` y `items` se incluyen para poder resolver saldo y cantidad de lineas
 * en la misma query: son dos sub-consultas de longitud constante por venta, no
 * un N+1.
 */
export const getVentas = cache(
  (limite = 50): Promise<VentaRow[]> =>
    conRespaldo(
      () => ventasDesdeBase(limite),
      () => demoVentas(limite),
    ),
);

/**
 * Listado de ventas SIN costo ni ganancia, para quien no puede `verCostos`. A
 * diferencia de `getVentas`, ni siquiera lee `costoTotal` de la base: el dato
 * prohibido no llega a la memoria del servidor, menos a una pagina o un payload.
 */
export const getVentasSinCostos = cache(
  (limite = 50): Promise<VentaListado[]> =>
    conRespaldo(
      () => ventasSinCostosDesdeBase(limite),
      () => demoVentas(limite).map(sinCostos),
    ),
);

function sinCostos({ costoTotal: _costo, ganancia: _ganancia, ...venta }: VentaRow): VentaListado {
  return venta;
}

async function ventasSinCostosDesdeBase(limite: number): Promise<VentaListado[]> {
  const ventas = await prisma.venta.findMany({
    where: { estado: { not: "ANULADA" } },
    orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    take: limite,
    select: {
      id: true,
      numero: true,
      anio: true,
      fecha: true,
      estado: true,
      totalBruto: true,
      cliente: { select: { id: true, nombre: true } },
      pagos: { where: { anuladoEn: null }, select: { monto: true } },
      _count: { select: { items: true } },
    },
  });

  return ventas.map((v) => {
    const pagado = sumar(...v.pagos.map((p) => p.monto));
    return {
      id: v.id,
      numero: v.numero,
      anio: v.anio,
      fecha: v.fecha,
      estado: v.estado,
      clienteId: v.cliente.id,
      clienteNombre: v.cliente.nombre,
      items: v._count.items,
      totalBruto: v.totalBruto,
      pagado,
      saldo: aMoneda(v.totalBruto.minus(pagado)),
      estadoPago: estadoPago(v.totalBruto, pagado),
    };
  });
}

async function ventasDesdeBase(limite: number): Promise<VentaRow[]> {
  const ventas = await prisma.venta.findMany({
    where: { estado: { not: "ANULADA" } },
    orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    take: limite,
    include: {
      cliente: { select: { id: true, nombre: true } },
      // Los pagos anulados no cuentan en el saldo.
      pagos: { where: { anuladoEn: null }, select: { monto: true } },
      _count: { select: { items: true } },
    },
  });

  return ventas.map((v) => {
    const pagado = sumar(...v.pagos.map((p) => p.monto));
    return {
      id: v.id,
      numero: v.numero,
      anio: v.anio,
      fecha: v.fecha,
      estado: v.estado,
      clienteId: v.cliente.id,
      clienteNombre: v.cliente.nombre,
      items: v._count.items,
      totalBruto: v.totalBruto,
      costoTotal: v.costoTotal,
      ganancia: v.totalBruto.minus(v.costoTotal),
      pagado,
      saldo: aMoneda(v.totalBruto.minus(pagado)),
      estadoPago: estadoPago(v.totalBruto, pagado),
    };
  });
}

export const ETIQUETA_ESTADO_PAGO: Record<EstadoPago, string> = {
  AL_DIA: "Al día",
  PARCIAL: "Parcial",
  PENDIENTE: "Sin cobrar",
  PAGADA: "Pagada",
};

export const ESTILO_ESTADO_PAGO: Record<EstadoPago, string> = {
  AL_DIA: "bg-emerald-50 text-emerald-700",
  PARCIAL: "bg-amber-50 text-amber-700",
  PENDIENTE: "bg-red-50 text-red-700",
  PAGADA: "bg-emerald-50 text-emerald-700",
};

export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

/** Rango del mes pedido, en UTC, para comparar contra `ventas.fecha`. */
export function rangoMes(anio: number, mes: number): { desde: Date; hasta: Date } {
  return {
    desde: new Date(Date.UTC(anio, mes - 1, 1)),
    hasta: new Date(Date.UTC(anio, mes, 1)),
  };
}

export { d };

export type VentaDetalle = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  estado: "PENDIENTE" | "ENTREGADA" | "ANULADA";
  clienteId: string;
  clienteNombre: string;
  observaciones: string | null;
  totalNeto: Dinero;
  totalIVA: Dinero;
  totalBruto: Dinero;
  pagado: Dinero;
  saldo: Dinero;
  estadoPago: EstadoPago;
  items: { id: string; descripcion: string; cantidad: Dinero; precioUnitario: Dinero; subtotalBruto: Dinero }[];
  /** Todos los pagos, tambien los anulados (se muestran tachados y no cuentan). */
  pagos: {
    id: string;
    fecha: Date;
    monto: Dinero;
    metodo: string;
    notas: string | null;
    anuladoEn: Date | null;
    motivoAnulacion: string | null;
  }[];
};

/**
 * Una venta con sus items y pagos. Sin base no hay detalle: las ventas demo no se abren.
 *
 * Nunca trae costo ni ganancia (ni de la venta ni de sus items): la pantalla de
 * detalle la ven todos los roles, y el costo congelado no se lee de la base.
 */
export const getVenta = cache(
  (id: string): Promise<VentaDetalle | null> =>
    conRespaldo(
      async () => {
        const v = await prisma.venta.findUnique({
          where: { id },
          omit: { costoTotal: true },
          include: {
            cliente: { select: { id: true, nombre: true } },
            items: {
              orderBy: { id: "asc" },
              select: { id: true, descripcion: true, cantidad: true, precioUnitario: true, subtotalBruto: true },
            },
            pagos: { orderBy: [{ fecha: "asc" }, { creadoEn: "asc" }] },
          },
        });
        if (!v) return null;
        const pagado = sumar(...v.pagos.filter((p) => p.anuladoEn === null).map((p) => p.monto));
        return {
          id: v.id,
          numero: v.numero,
          anio: v.anio,
          fecha: v.fecha,
          estado: v.estado,
          clienteId: v.cliente.id,
          clienteNombre: v.cliente.nombre,
          observaciones: v.observaciones,
          totalNeto: v.totalNeto,
          totalIVA: v.totalIVA,
          totalBruto: v.totalBruto,
          pagado,
          saldo: aMoneda(v.totalBruto.minus(pagado)),
          estadoPago: estadoPago(v.totalBruto, pagado),
          items: v.items.map((i) => ({
            id: i.id,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            precioUnitario: i.precioUnitario,
            subtotalBruto: i.subtotalBruto,
          })),
          pagos: v.pagos.map((p) => ({
            id: p.id,
            fecha: p.fecha,
            monto: p.monto,
            metodo: p.metodo,
            notas: p.notas,
            anuladoEn: p.anuladoEn,
            motivoAnulacion: p.motivoAnulacion,
          })),
        };
      },
      () => null,
    ),
);
