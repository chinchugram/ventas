import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  demoDeudas,
  demoGananciaPorProducto,
  demoPendienteTotal,
  demoResumenMes,
  demoUltimasVentas,
} from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { aMoneda, CERO, d, Dinero, sumar } from "@/lib/money";
import { estadoPago, EstadoPago } from "@/lib/costing";
import { getConfig, configNumero } from "./catalogo";

export type ResumenMes = {
  anio: number;
  mes: number;
  cantidadVentas: number;
  facturadoBruto: Dinero;
  facturadoNeto: Dinero;
  iva: Dinero;
  costoTotal: Dinero;
  ganancia: Dinero;
  margenPct: Dinero;
  cobrado: Dinero;
  pendienteCobro: Dinero;
  metaMargenPct: Dinero;
};

/**
 * Como va el mes. La pregunta que el dueño se hace todos los dias.
 *
 * Una sola agregacion server-side: traer las ventas del mes y sumar en JS seria
 * correcto pero wasteful, y el dia que haya que filtrar por cliente o por
 * articulo el costo se nota.
 */
export const getResumenMes = cache(
  (fechaReferencia = new Date()): Promise<ResumenMes> =>
    conRespaldo(
      () => resumenMesDesdeBase(fechaReferencia),
      () => demoResumenMes(fechaReferencia),
    ),
);

async function resumenMesDesdeBase(fechaReferencia: Date): Promise<ResumenMes> {
  const config = await getConfig();
  const metaMargenPct = configNumero(config, "margenObjetivo", "40");

  const anio = fechaReferencia.getFullYear();
  const mes = fechaReferencia.getMonth() + 1;

  const desde = new Date(Date.UTC(anio, mes - 1, 1));
  const hasta = new Date(Date.UTC(anio, mes, 1));

  const [agregado, cobrado] = await Promise.all([
    prisma.venta.aggregate({
      where: { fecha: { gte: desde, lt: hasta }, estado: { not: "ANULADA" } },
      _count: { _all: true },
      _sum: { totalBruto: true, totalNeto: true, totalIVA: true, costoTotal: true },
    }),
    prisma.pago.aggregate({
      where: { fecha: { gte: desde, lt: hasta } },
      _sum: { monto: true },
    }),
  ]);

  const facturadoBruto = aMoneda(d(agregado._sum.totalBruto));
  const facturadoNeto = aMoneda(d(agregado._sum.totalNeto));
  const iva = aMoneda(d(agregado._sum.totalIVA));
  const costoTotal = aMoneda(d(agregado._sum.costoTotal));
  const ganancia = aMoneda(facturadoBruto.minus(costoTotal));
  const cobradoMes = aMoneda(d(cobrado._sum.monto));
  const pendienteCobro = aMoneda(await pendienteTotal());

  return {
    anio,
    mes,
    cantidadVentas: agregado._count._all,
    facturadoBruto,
    facturadoNeto,
    iva,
    costoTotal,
    ganancia,
    margenPct: facturadoBruto.isZero() ? CERO : d(ganancia.div(facturadoBruto).times(100)),
    cobrado: cobradoMes,
    pendienteCobro,
    metaMargenPct,
  };
}

/**
 * Total que se le debe al negocio: todo lo facturado y no cobrado, de toda la
 * historia. Se calcula, no se guarda, asi que siempre cuadra con los pagos.
 */
export const pendienteTotal = cache(
  (): Promise<Dinero> =>
    conRespaldo(async () => {
      const [facturado, pagado] = await Promise.all([
        prisma.venta.aggregate({
          where: { estado: { not: "ANULADA" } },
          _sum: { totalBruto: true },
        }),
        prisma.pago.aggregate({ _sum: { monto: true } }),
      ]);

      const saldo = d(facturado._sum.totalBruto).minus(d(pagado._sum.monto));
      return saldo.isNegative() ? CERO : aMoneda(saldo);
    }, demoPendienteTotal),
);

export type VentaListada = {
  id: string;
  numero: number;
  anio: number;
  fecha: Date;
  estado: "PENDIENTE" | "ENTREGADA" | "ANULADA";
  cliente: { id: string; nombre: string };
  totalBruto: Dinero;
  costoTotal: Dinero;
  ganancia: Dinero;
  pagado: Dinero;
  saldo: Dinero;
  estadoPago: EstadoPago;
};

/** Últimas ventas con su estado de pago ya resuelto. */
export const getUltimasVentas = cache(
  (limite = 8): Promise<VentaListada[]> =>
    conRespaldo(
      () => ultimasVentasDesdeBase(limite),
      () => demoUltimasVentas(limite),
    ),
);

async function ultimasVentasDesdeBase(limite: number): Promise<VentaListada[]> {
  const ventas = await prisma.venta.findMany({
    where: { estado: { not: "ANULADA" } },
    orderBy: [{ fecha: "desc" }, { numero: "desc" }],
    take: limite,
    include: {
      cliente: { select: { id: true, nombre: true } },
      pagos: { select: { monto: true } },
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
      cliente: v.cliente,
      totalBruto: v.totalBruto,
      costoTotal: v.costoTotal,
      // La ganancia no se persiste: se deriva de los dos campos de arriba. Si se
      // guardara, un cambio futuro de criterio obligaria a recalcular el historico.
      ganancia: aMoneda(v.totalBruto.minus(v.costoTotal)),
      pagado,
      saldo: aMoneda(v.totalBruto.minus(pagado)),
      estadoPago: estadoPago(v.totalBruto, pagado),
    };
  });
}

export type DeudaCliente = {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  saldo: Dinero;
  ventasPendientes: number;
  masAntigua: Date | null;
};

/** Quién debe, cuánto y desde cuándo. La pregunta del dia a dia del dueño. */
export const getDeudas = cache(
  (): Promise<DeudaCliente[]> => conRespaldo(deudasDesdeBase, demoDeudas),
);

async function deudasDesdeBase(): Promise<DeudaCliente[]> {
  const ventas = await prisma.venta.findMany({
    where: { estado: { not: "ANULADA" } },
    select: {
      clienteId: true,
      fecha: true,
      totalBruto: true,
      cliente: { select: { nombre: true, telefono: true } },
      pagos: { select: { monto: true } },
    },
    orderBy: { fecha: "asc" },
  });

  const porCliente = new Map<string, DeudaCliente>();

  for (const v of ventas) {
    const pagado = sumar(...v.pagos.map((p) => p.monto));
    const saldo = aMoneda(v.totalBruto.minus(pagado));
    if (saldo.lte(d("0.01"))) continue;

    const actual = porCliente.get(v.clienteId);
    if (actual) {
      actual.saldo = aMoneda(actual.saldo.plus(saldo));
      actual.ventasPendientes += 1;
    } else {
      porCliente.set(v.clienteId, {
        clienteId: v.clienteId,
        nombre: v.cliente.nombre,
        telefono: v.cliente.telefono,
        saldo,
        ventasPendientes: 1,
        masAntigua: v.fecha,
      });
    }
  }

  return [...porCliente.values()].sort((a, b) => b.saldo.cmp(a.saldo));
}

export type Alerta = {
  tipo: "STOCK_BAJO" | "SIN_RECETA" | "BAJO_MARGEN";
  severidad: "critica" | "aviso";
  mensaje: string;
  detalle: string;
};

export type TopProducto = {
  articuloId: string;
  nombre: string;
  unidades: Dinero;
  facturado: Dinero;
  costo: Dinero;
  ganancia: Dinero;
  margenPct: Dinero;
};

/**
 * Reporte 2: ganancia por producto, en el rango de fechas pedido.
 *
 * Se agrega en SQL por articulo. Traer los items y agrupar en JS multiplicaria
 * por N el trabajo de red sin agregar nada.
 */
export function getGananciaPorProducto(desde: Date, hasta: Date): Promise<TopProducto[]> {
  return conRespaldo(
    () => gananciaPorProductoDesdeBase(desde, hasta),
    () => demoGananciaPorProducto(desde, hasta),
  );
}

async function gananciaPorProductoDesdeBase(desde: Date, hasta: Date): Promise<TopProducto[]> {
  const filas = await prisma.ventaItem.groupBy({
    by: ["articuloId"],
    where: {
      venta: { fecha: { gte: desde, lt: hasta }, estado: { not: "ANULADA" } },
    },
    _sum: {
      cantidad: true,
      subtotalBruto: true,
      costoTotalSnapshot: true,
    },
  });

  if (filas.length === 0) return [];

  const articulos = await prisma.articulo.findMany({
    where: { id: { in: filas.map((f) => f.articuloId) } },
    select: { id: true, nombre: true },
  });
  const nombrePor = new Map(articulos.map((a) => [a.id, a.nombre]));

  return filas
    .map((f) => {
      const facturado = aMoneda(d(f._sum.subtotalBruto));
      const costo = aMoneda(d(f._sum.costoTotalSnapshot));
      const ganancia = aMoneda(facturado.minus(costo));
      return {
        articuloId: f.articuloId,
        nombre: nombrePor.get(f.articuloId) ?? "Articulo eliminado",
        unidades: d(f._sum.cantidad),
        facturado,
        costo,
        ganancia,
        margenPct: facturado.isZero() ? CERO : d(ganancia.div(facturado).times(100)),
      };
    })
    .sort((a, b) => b.ganancia.cmp(a.ganancia));
}
