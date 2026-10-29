import { prisma } from "@/lib/prisma";
import { demoMateriales } from "@/lib/demo-data";
import { conRespaldo } from "@/lib/respaldo";
import { CERO, d, type Dinero } from "@/lib/money";
import { ETIQUETA_UNIDAD } from "@/lib/unidades";
import {
  compararConsumo,
  consumoTeoricoPorMaterial,
  type MaterialParaConsumo,
  type ReporteConsumo,
} from "@/lib/consumo-teorico";
import {
  calcularRotacion,
  diasDelPeriodo,
  sinMovimiento,
  valorizarStock,
  type MaterialParaInmovilizado,
  type MaterialParaRotacion,
  type MaterialValorizable,
  type ReporteRotacion,
  type SinMovimiento,
  type Valorizacion,
} from "@/lib/stock-reporte";

/**
 * Consultas de los reportes de stock (valorizacion, rotacion y sin movimiento).
 * Toda la cuenta esta en `lib/stock-reporte.ts`; aca solo se leen los insumos.
 * Solo materiales activos. Los tipos del resultado se exportan para las
 * pantallas y para el reporte de consumo real vs teorico.
 */

export type MaterialStockReporte = {
  /** Unidad para mostrar ("m2", "u"). */
  unidad: string;
};

export type MaterialValorizado = MaterialValorizable & MaterialStockReporte;
export type MaterialRotacion = MaterialParaRotacion & MaterialStockReporte;
export type MaterialInmovilizado = MaterialParaInmovilizado & MaterialStockReporte;

export type ValorizacionStock = Valorizacion<MaterialValorizado>;
export type RotacionStock = ReporteRotacion<MaterialRotacion> & {
  /** Periodo pedido: desde inclusivo, hasta exclusivo. */
  desde: Date;
  hasta: Date;
};
export type StockSinMovimiento = SinMovimiento<MaterialInmovilizado> & { ahora: Date };

export type MaterialConsumo = MaterialParaConsumo & MaterialStockReporte;
export type ConsumoRealVsTeorico = ReporteConsumo<MaterialConsumo> & {
  /** Periodo pedido: desde inclusivo, hasta exclusivo. */
  desde: Date;
  hasta: Date;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

const SELECT_MATERIAL = {
  id: true,
  nombre: true,
  unidad: true,
  stockActual: true,
  costoUnitario: true,
  creadoEn: true,
} as const;

// ─── Valorizacion ─────────────────────────────────────────────────────────────

/** Valor del stock actual (cantidad × costo) por material y total. */
export function getValorizacionStock(): Promise<ValorizacionStock> {
  return conRespaldo(valorizacionDesdeBase, valorizacionDemo);
}

async function valorizacionDesdeBase(): Promise<ValorizacionStock> {
  const materiales = await prisma.material.findMany({ where: { activo: true }, select: SELECT_MATERIAL });
  return valorizarStock(
    materiales.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
      stockActual: d(m.stockActual),
      costoUnitario: d(m.costoUnitario),
    })),
  );
}

function valorizacionDemo(): ValorizacionStock {
  return valorizarStock(
    demoMateriales().map((m) => ({
      id: m.id,
      nombre: m.nombre,
      unidad: m.unidad,
      stockActual: m.stockActual,
      costoUnitario: m.costoUnitario,
    })),
  );
}

// ─── Rotacion ─────────────────────────────────────────────────────────────────

/**
 * Rotacion de cada material en [desde, hasta). La formula y los casos sin dato
 * estan en `lib/stock-reporte.ts`. Falla (no usa el respaldo) si el periodo es invalido.
 */
export function getRotacionStock(desde: Date, hasta: Date): Promise<RotacionStock> {
  const dias = diasDelPeriodo(desde, hasta);
  return conRespaldo(
    async () => ({ ...(await rotacionDesdeBase(desde, hasta, dias)), desde, hasta }),
    () => ({ ...rotacionDemo(dias), desde, hasta }),
  );
}

/** Suma de `cantidad` de los movimientos de todo tipo con `creadoEn >= instante`, por material. */
async function movimientosDesde(instante: Date): Promise<Map<string, Dinero>> {
  const filas = await prisma.movimientoStock.groupBy({
    by: ["materialId"],
    where: { creadoEn: { gte: instante } },
    _sum: { cantidad: true },
  });
  return new Map(filas.map((f) => [f.materialId, d(f._sum.cantidad)]));
}

/**
 * Consumo REAL de cada material en [desde, hasta): salidas tipo VENTA del libro,
 * netas de anulaciones, con signo positivo (= cantidad que salio). Puede dar
 * negativo si se anulo en el periodo una venta de uno anterior; cada reporte
 * decide que hacer con eso. Lo usan la rotacion y el consumo real vs teorico.
 */
async function consumoRealPorMaterial(desde: Date, hasta: Date): Promise<Map<string, Dinero>> {
  const ventas = await prisma.movimientoStock.groupBy({
    by: ["materialId"],
    where: { tipo: "VENTA", creadoEn: { gte: desde, lt: hasta } },
    _sum: { cantidad: true },
  });
  // Las ventas descuentan con signo negativo y las anulaciones devuelven en positivo.
  return new Map(ventas.map((v) => [v.materialId, d(v._sum.cantidad).neg()]));
}

async function rotacionDesdeBase(desde: Date, hasta: Date, dias: Dinero): Promise<ReporteRotacion<MaterialRotacion>> {
  const [materiales, desdeDesde, desdeHasta, consumo] = await Promise.all([
    prisma.material.findMany({ where: { activo: true }, select: SELECT_MATERIAL }),
    movimientosDesde(desde),
    movimientosDesde(hasta),
    consumoRealPorMaterial(desde, hasta),
  ]);

  return calcularRotacion(
    materiales.map((m): MaterialRotacion => {
      const actual = d(m.stockActual);
      return {
        id: m.id,
        nombre: m.nombre,
        unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
        costoUnitario: d(m.costoUnitario),
        // Stock en el instante T = stock actual − lo que se movio desde T hasta hoy.
        // No depende del orden de movimientos que comparten marca de tiempo.
        stockInicial: actual.minus(desdeDesde.get(m.id) ?? CERO),
        stockFinal: actual.minus(desdeHasta.get(m.id) ?? CERO),
        consumo: consumo.get(m.id) ?? CERO,
      };
    }),
    dias,
  );
}

/** Consumo de ejemplo cada 30 dias (la demo no tiene libro de movimientos). */
const CONSUMO_DEMO_30D: Record<string, string> = { m1: "12", m2: "10", m3: "0", m4: "2", m5: "1" };

function rotacionDemo(dias: Dinero): ReporteRotacion<MaterialRotacion> {
  return calcularRotacion(
    demoMateriales().map((m): MaterialRotacion => {
      const consumo = d(CONSUMO_DEMO_30D[m.id] ?? "0").times(dias).div(30).toDecimalPlaces(3);
      return {
        id: m.id,
        nombre: m.nombre,
        unidad: m.unidad,
        costoUnitario: m.costoUnitario,
        // Sin compras en el periodo: lo que habia al empezar es lo de hoy mas lo consumido.
        stockInicial: m.stockActual.plus(consumo),
        stockFinal: m.stockActual,
        consumo,
      };
    }),
    dias,
  );
}

// ─── Sin movimiento ───────────────────────────────────────────────────────────

/**
 * Materiales sin ningun movimiento (compra, venta o ajuste) hace `dias` dias o
 * mas, con la plata que tienen parada. `ahora` es parametro para poder probar.
 * Los materiales sin stock se omiten (no hay nada inmovilizado).
 */
export function getStockSinMovimiento(dias: number, ahora: Date = new Date()): Promise<StockSinMovimiento> {
  if (!Number.isInteger(dias) || dias < 0) throw new Error("Los dias tienen que ser un entero mayor o igual a 0.");
  return conRespaldo(
    async () => ({ ...(await sinMovimientoDesdeBase(dias, ahora)), ahora }),
    () => ({ ...sinMovimientoDemo(dias, ahora), ahora }),
  );
}

async function sinMovimientoDesdeBase(dias: number, ahora: Date): Promise<SinMovimiento<MaterialInmovilizado>> {
  const [materiales, ultimos] = await Promise.all([
    prisma.material.findMany({ where: { activo: true }, select: SELECT_MATERIAL }),
    prisma.movimientoStock.groupBy({ by: ["materialId"], _max: { creadoEn: true } }),
  ]);
  const ultimo = new Map(ultimos.map((u) => [u.materialId, u._max.creadoEn]));

  return sinMovimiento(
    materiales.map((m): MaterialInmovilizado => ({
      id: m.id,
      nombre: m.nombre,
      unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
      stockActual: d(m.stockActual),
      costoUnitario: d(m.costoUnitario),
      ultimoMovimiento: ultimo.get(m.id) ?? null,
      creadoEn: m.creadoEn,
    })),
    dias,
    ahora,
  );
}

/** Dias desde el ultimo movimiento de cada material de ejemplo. */
const DIAS_SIN_MOVER_DEMO: Record<string, number> = { m1: 3, m2: 12, m3: 75, m4: 41, m5: 20 };

function sinMovimientoDemo(dias: number, ahora: Date): SinMovimiento<MaterialInmovilizado> {
  return sinMovimiento(
    demoMateriales().map((m): MaterialInmovilizado => ({
      id: m.id,
      nombre: m.nombre,
      unidad: m.unidad,
      stockActual: m.stockActual,
      costoUnitario: m.costoUnitario,
      ultimoMovimiento: new Date(ahora.getTime() - (DIAS_SIN_MOVER_DEMO[m.id] ?? 0) * MS_POR_DIA),
      creadoEn: new Date(ahora.getTime() - 365 * MS_POR_DIA),
    })),
    dias,
    ahora,
  );
}

// ─── Consumo real vs teorico ──────────────────────────────────────────────────

/**
 * Por material: lo que deberia haber salido segun las recetas de lo vendido en
 * [desde, hasta) contra lo que salio del libro de stock. La cuenta, la receta
 * que se usa y los motivos de desvio estan en `lib/consumo-teorico.ts`.
 * Falla (no usa el respaldo) si el periodo es invalido.
 */
export function getConsumoRealVsTeorico(desde: Date, hasta: Date): Promise<ConsumoRealVsTeorico> {
  const dias = diasDelPeriodo(desde, hasta); // valida el periodo
  return conRespaldo(
    async () => ({ ...(await consumoDesdeBase(desde, hasta)), desde, hasta }),
    () => ({ ...consumoDemo(dias), desde, hasta }),
  );
}

async function consumoDesdeBase(desde: Date, hasta: Date): Promise<ReporteConsumo<MaterialConsumo>> {
  // El teorico se ubica por Venta.fecha (dia calendario); el real, por la hora del movimiento.
  const items = await prisma.ventaItem.findMany({
    where: { venta: { estado: { not: "ANULADA" }, fecha: { gte: desde, lt: hasta } } },
    select: { ventaId: true, articuloId: true, cantidad: true },
  });
  const idsArticulo = [...new Set(items.map((i) => i.articuloId))];

  const [articulos, real] = await Promise.all([
    prisma.articulo.findMany({
      where: { id: { in: idsArticulo } },
      select: {
        id: true,
        esServicio: true,
        receta: { select: { componentes: { select: { tipo: true, materialId: true, cantidad: true } } } },
      },
    }),
    consumoRealPorMaterial(desde, hasta),
  ]);

  const teorico = consumoTeoricoPorMaterial(
    items.map((i) => ({ ventaId: i.ventaId, articuloId: i.articuloId, cantidad: d(i.cantidad) })),
    articulos.map((a) => ({
      id: a.id,
      esServicio: a.esServicio,
      componentes: (a.receta?.componentes ?? []).map((c) => ({
        tipo: c.tipo,
        materialId: c.materialId,
        cantidad: d(c.cantidad),
      })),
    })),
  );

  // Sin filtrar por activo: una receta o un movimiento pueden apuntar a un material dado de baja.
  const ids = [...new Set([...teorico.keys(), ...real.keys()])];
  const materiales = await prisma.material.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, unidad: true, costoUnitario: true },
  });
  return compararConsumo(
    materiales.map((m): MaterialConsumo => ({
      id: m.id,
      nombre: m.nombre,
      unidad: ETIQUETA_UNIDAD[m.unidad] ?? m.unidad,
      costoUnitario: d(m.costoUnitario),
    })),
    teorico,
    real,
  );
}

/** La demo no tiene libro ni ventas con recetas: real = teorico (sin desvio) con el consumo de ejemplo. */
function consumoDemo(dias: Dinero): ReporteConsumo<MaterialConsumo> {
  const consumo = new Map(
    demoMateriales().map((m) => [m.id, d(CONSUMO_DEMO_30D[m.id] ?? "0").times(dias).div(30).toDecimalPlaces(3)]),
  );
  return compararConsumo(
    demoMateriales().map((m): MaterialConsumo => ({
      id: m.id,
      nombre: m.nombre,
      unidad: m.unidad,
      costoUnitario: m.costoUnitario,
    })),
    consumo,
    consumo,
  );
}
