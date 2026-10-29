import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  DEMO_CONFIG,
  demoDeudas,
  demoGananciaPorProducto,
  demoPendienteTotal,
  demoResumenMes,
  demoUltimasVentas,
} from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { aMoneda, CERO, d, Dinero, sumar } from "@/lib/money";
import { estadoPago, EstadoPago } from "@/lib/costing";
import { hoyEnArgentina, rangoDeMes, type RangoFechas } from "@/lib/rango-fechas";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import { getConfig, configNumero } from "./catalogo";

/**
 * ─── Reportes: que se filtra por periodo y que es "a hoy" ───────────────────
 * Cada reporte es una funcion exportada que recibe el rango (`RangoFechas` de
 * `lib/rango-fechas.ts`: `fecha >= desde AND fecha < hasta`) y devuelve DATOS,
 * no JSX, para que la pantalla y el export a CSV (3.1c) usen la misma consulta.
 *
 *   1. Resumen            getResumenPeriodo(rango)       POR PERIODO. Ventas no
 *                         anuladas con `fecha` en el rango; "cobrado" son los
 *                         pagos vigentes con `fecha` en el rango. Excepcion
 *                         explicita: `pendienteCobro` es a hoy (ver abajo).
 *   2. Ganancia/producto  getGananciaPorProducto(rango)  POR PERIODO (por `venta.fecha`).
 *   3. Deuda por cliente  getDeudas()                    A HOY. Es el saldo vivo
 *                         de toda la historia: una deuda de enero sigue
 *                         existiendo en marzo, y filtrarla por fecha de venta
 *                         daria un "Nadie debe nada" falso. No recibe rango.
 *   4. Consumo materiales getConsumoMateriales(rango)    POR PERIODO. Salidas de
 *                         stock tipo VENTA de ventas con `fecha` en el rango.
 *   5. Top productos      primeros N de getGananciaPorProducto(rango) (ya viene
 *                         ordenado por ganancia).
 *
 * Criterio de "en el periodo": siempre la fecha de la VENTA (dia calendario),
 * nunca el instante en que se cargo, para que todos los reportes cuadren entre si.
 */

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

/** Resumen de un periodo cualquiera. `anio`/`mes` son los del primer dia del rango. */
export type ResumenPeriodo = ResumenMes & {
  etiqueta: string;
  desde: Date;
  hasta: Date;
};

/**
 * Como va el mes. La pregunta que el dueño se hace todos los dias.
 *
 * Es `getResumenPeriodo` aplicado al mes de `fechaReferencia`. El mes se decide
 * en hora Argentina (no con getMonth() del servidor, que es UTC: el ultimo dia
 * del mes de noche ya diria el mes siguiente).
 */
export const getResumenMes = cache((fechaReferencia = new Date()): Promise<ResumenMes> => {
  const hoy = hoyEnArgentina(fechaReferencia);
  return getResumenPeriodo(rangoDeMes(hoy.anio, hoy.mes));
});

/**
 * Reporte 1, POR PERIODO: ventas, facturado, costo, ganancia y cobrado del rango.
 *
 * Una sola agregacion server-side: traer las ventas y sumar en JS seria
 * correcto pero wasteful, y el dia que haya que filtrar por cliente o por
 * articulo el costo se nota.
 *
 * `pendienteCobro` NO depende del rango: es la deuda total a hoy (`pendienteTotal`).
 */
export function getResumenPeriodo(
  rango: Pick<RangoFechas, "desde" | "hasta" | "etiqueta" | "tipo">,
): Promise<ResumenPeriodo> {
  return conRespaldo(
    () => resumenPeriodoDesdeBase(rango),
    () => resumenPeriodoDemo(rango),
  );
}

/**
 * Sin base. Un mes entero sale del resumen demo de siempre; un rango libre se
 * arma con la lista de ventas demo (neto/IVA se estiman al 21 %, que es lo
 * unico que usa el juego de demostracion).
 */
function resumenPeriodoDemo(rango: Pick<RangoFechas, "desde" | "hasta" | "etiqueta" | "tipo">): ResumenPeriodo {
  const marco = { etiqueta: rango.etiqueta, desde: rango.desde, hasta: rango.hasta };
  const anio = rango.desde.getUTCFullYear();
  const mes = rango.desde.getUTCMonth() + 1;

  if (rango.tipo === "mes") {
    return { ...demoResumenMes(new Date(anio, mes - 1, 15)), ...marco };
  }

  const ventas = demoUltimasVentas(100_000).filter(
    (v) => v.estado !== "ANULADA" && v.fecha >= rango.desde && v.fecha < rango.hasta,
  );
  const facturadoBruto = aMoneda(sumar(...ventas.map((v) => v.totalBruto)));
  const costoTotal = aMoneda(sumar(...ventas.map((v) => v.costoTotal)));
  const facturadoNeto = aMoneda(facturadoBruto.div("1.21"));
  const ganancia = aMoneda(facturadoBruto.minus(costoTotal));
  return {
    anio,
    mes,
    ...marco,
    cantidadVentas: ventas.length,
    facturadoBruto,
    facturadoNeto,
    iva: aMoneda(facturadoBruto.minus(facturadoNeto)),
    costoTotal,
    ganancia,
    margenPct: facturadoBruto.isZero() ? CERO : d(ganancia.div(facturadoBruto).times(100)),
    cobrado: aMoneda(sumar(...ventas.map((v) => v.pagado))),
    pendienteCobro: demoPendienteTotal(),
    metaMargenPct: d(DEMO_CONFIG.margenObjetivo),
  };
}

async function resumenPeriodoDesdeBase(
  rango: Pick<RangoFechas, "desde" | "hasta" | "etiqueta">,
): Promise<ResumenPeriodo> {
  const config = await getConfig();
  const metaMargenPct = configNumero(config, "margenObjetivo", "40");
  const { desde, hasta } = rango;

  const [agregado, cobrado] = await Promise.all([
    prisma.venta.aggregate({
      where: { fecha: { gte: desde, lt: hasta }, estado: { not: "ANULADA" } },
      _count: { _all: true },
      _sum: { totalBruto: true, totalNeto: true, totalIVA: true, costoTotal: true },
    }),
    prisma.pago.aggregate({
      where: { fecha: { gte: desde, lt: hasta }, anuladoEn: null, venta: { estado: { not: "ANULADA" } } },
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
    anio: desde.getUTCFullYear(),
    mes: desde.getUTCMonth() + 1,
    etiqueta: rango.etiqueta,
    desde,
    hasta,
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
        // Solo pagos vigentes de ventas vigentes: lo cobrado de una venta anulada
        // no descuenta deuda de las demas.
        prisma.pago.aggregate({
          where: { anuladoEn: null, venta: { estado: { not: "ANULADA" } } },
          _sum: { monto: true },
        }),
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
      pagos: { where: { anuladoEn: null }, select: { monto: true } },
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

/**
 * Reporte 3, A HOY: quién debe, cuánto y desde cuándo. La pregunta del dia a dia del dueño.
 * No recibe rango a proposito: es el saldo vivo de toda la historia (ver cabecera del archivo).
 */
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
      pagos: { where: { anuladoEn: null }, select: { monto: true } },
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
 * Reporte 2, POR PERIODO: ganancia por producto, ordenada de mayor a menor ganancia
 * (el reporte 5, "mas rentables", son sus primeros N).
 *
 * Se agrega en SQL por articulo. Traer los items y agrupar en JS multiplicaria
 * por N el trabajo de red sin agregar nada.
 */
export function getGananciaPorProducto(rango: Pick<RangoFechas, "desde" | "hasta">): Promise<TopProducto[]> {
  const { desde, hasta } = rango;
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

export type ConsumoMaterial = {
  materialId: string;
  nombre: string;
  unidad: string;
  /** Cantidad que salio del stock por ventas del periodo (positiva, en `unidad`). */
  cantidad: Dinero;
  /** `cantidad` x costo unitario ACTUAL del material (el libro de stock no guarda costo). */
  costoEstimado: Dinero;
  /** Stock de hoy, como contexto. */
  stockActual: Dinero;
};

/**
 * Reporte 4, POR PERIODO: materiales consumidos por las ventas del rango.
 *
 * Suma los movimientos de stock tipo VENTA de ventas con `fecha` en el rango. Las
 * salidas son negativas y una anulacion deja un movimiento VENTA positivo que las
 * compensa, asi que la suma ya es neta; ademas se excluyen las ventas anuladas
 * para coincidir con el resto de los reportes. Ajustes manuales y compras no son
 * consumo y no entran.
 *
 * Ordenado por costo estimado, de mayor a menor. Sin base no hay libro de stock
 * de demostracion: devuelve lista vacia.
 */
export function getConsumoMateriales(rango: Pick<RangoFechas, "desde" | "hasta">): Promise<ConsumoMaterial[]> {
  const { desde, hasta } = rango;
  return conRespaldo(() => consumoMaterialesDesdeBase(desde, hasta), () => []);
}

async function consumoMaterialesDesdeBase(desde: Date, hasta: Date): Promise<ConsumoMaterial[]> {
  const filas = await prisma.movimientoStock.groupBy({
    by: ["materialId"],
    where: {
      tipo: "VENTA",
      venta: { fecha: { gte: desde, lt: hasta }, estado: { not: "ANULADA" } },
    },
    _sum: { cantidad: true },
  });
  if (filas.length === 0) return [];

  const materiales = await prisma.material.findMany({
    where: { id: { in: filas.map((f) => f.materialId) } },
    select: { id: true, nombre: true, unidad: true, costoUnitario: true, stockActual: true },
  });
  const porId = new Map(materiales.map((m) => [m.id, m]));

  return filas
    .map((f) => {
      const m = porId.get(f.materialId);
      const cantidad = d(f._sum.cantidad).neg();
      return {
        materialId: f.materialId,
        nombre: m?.nombre ?? "Material eliminado",
        unidad: m ? (ETIQUETA_UNIDAD[m.unidad] ?? m.unidad) : "",
        cantidad,
        costoEstimado: aMoneda(cantidad.times(d(m?.costoUnitario))),
        stockActual: d(m?.stockActual),
      };
    })
    .filter((c) => !c.cantidad.isZero())
    .sort((a, b) => b.costoEstimado.cmp(a.costoEstimado));
}
