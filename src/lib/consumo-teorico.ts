/**
 * Consumo real vs teorico de materiales.
 *
 * Logica pura (sin base): la consulta esta en `queries/stock.ts`
 * (`getConsumoRealVsTeorico`), que arma estos insumos.
 *
 * Teorico
 * -------
 * Lo que DEBERIA haber salido de stock por las ventas del periodo si todo se
 * hubiera hecho segun receta. Es exactamente la cuenta de `registrarVentaEnTx`
 * (`lib/dominio/ventas.ts`) al descontar stock:
 *
 *   - Solo cuentan los componentes de tipo MATERIAL con material (maquina y
 *     mano de obra no consumen stock) de articulos que NO son servicio.
 *   - consumo de la linea = cantidad del componente × cantidad vendida.
 *   - No hay merma ni factor de desperdicio en el modelo: `costoUnitarioOverride`
 *     solo cambia el COSTO del componente, nunca la cantidad que se descuenta.
 *     La nota "descontar 10% por merma" es texto libre y no afecta el stock.
 *   - Las lineas de una misma venta se suman por material y RECIEN ahi se
 *     redondea a 3 decimales: la venta escribe UN movimiento por material, y la
 *     columna `MovimientoStock.cantidad` es decimal(14,3). Se redondea igual
 *     (mitad hacia arriba) para que, sin ajustes, teorico y real coincidan al
 *     milesimo y no aparezcan desvios fantasma. El teorico del periodo es la
 *     suma de esas cantidades por venta.
 *
 * Receta: el modelo NO congela la receta en la venta (solo el costo, en
 * `costoUnitarioSnapshot`). Se usa la receta ACTUAL del articulo. Si se la
 * edito despues de vender, el teorico cambia y aparece un desvio contra el real
 * (que refleja lo que salio de verdad); es el desvio "por cambio de receta".
 *
 * Real
 * ----
 * Salidas tipo VENTA del libro `MovimientoStock` en el periodo, netas de
 * anulaciones (misma definicion que el consumo de la rotacion en 3.2a). Se
 * entrega ya con signo positivo (= cantidad que salio). NO se recorta en 0: si
 * en el periodo se anulo una venta de un periodo anterior, el neto puede ser
 * negativo y se muestra tal cual (el libro lo dice).
 *
 * Por que real y teorico pueden diferir (todo esto es desvio legitimo)
 * ---------------------------------------------------------------------
 *   - Faltaba stock al vender: la venta descuenta solo lo que habia (real < teorico).
 *   - Receta editada despues de la venta (arriba).
 *   - Venta anulada despues del periodo (el real del periodo la incluye; el
 *     teorico no, porque ya esta ANULADA) o anulada en otro periodo.
 *   - Venta con fecha distinta del dia en que se cargo: el teorico se ubica por
 *     `Venta.fecha`; el real, por la hora del movimiento (`creadoEn`).
 *
 * Desvio
 * ------
 *   diferencia      = real − teorico    (positivo: salio MAS de lo previsto)
 *   diferenciaPct   = diferencia / teorico × 100, 2 decimales; teorico 0 → null
 *                     (no se inventa un porcentaje: ni Infinity ni NaN)
 *   valorDiferencia = diferencia × costo actual del material, a centavos
 *                     (sin costo historico en el libro, igual que en 3.2a)
 *   Orden: mayor |valorDiferencia| primero; a igual valor, mayor |diferencia|;
 *   despues por nombre. Se omiten materiales con teorico 0 y real 0.
 *
 * Cantidades y dinero en `Decimal`; nunca `number`.
 */
import Decimal from "decimal.js";
import { aMoneda, CERO, type Dinero, sumar } from "@/lib/money";

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

/** Decimales de `MovimientoStock.cantidad`. */
const DECIMALES_MOVIMIENTO = 3;

// ─── Teorico ──────────────────────────────────────────────────────────────────

export type ComponenteConsumo = {
  tipo: "MATERIAL" | "MAQUINA" | "MANO_OBRA";
  materialId: string | null;
  cantidad: Dinero;
};

export type ArticuloConReceta = {
  id: string;
  esServicio: boolean;
  /** Componentes de la receta actual (puede estar vacio o no haber receta). */
  componentes: ComponenteConsumo[];
};

export type LineaVendida = {
  ventaId: string;
  articuloId: string;
  cantidad: Dinero;
};

/**
 * Consumo teorico por material de las lineas de venta dadas (ventas ya
 * filtradas: no anuladas y del periodo). Misma cuenta que `registrarVentaEnTx`;
 * ver la cabecera del archivo.
 */
export function consumoTeoricoPorMaterial(
  lineas: LineaVendida[],
  articulos: ArticuloConReceta[],
): Map<string, Dinero> {
  const porId = new Map(articulos.map((a) => [a.id, a]));
  // ventaId → (materialId → consumo sin redondear)
  const porVenta = new Map<string, Map<string, Dinero>>();

  for (const linea of lineas) {
    const articulo = porId.get(linea.articuloId);
    if (!articulo) throw new Error(`Falta el articulo ${linea.articuloId} para calcular el consumo teorico.`);
    if (articulo.esServicio) continue;

    let consumos = porVenta.get(linea.ventaId);
    if (!consumos) {
      consumos = new Map();
      porVenta.set(linea.ventaId, consumos);
    }
    for (const c of articulo.componentes) {
      if (c.tipo !== "MATERIAL" || !c.materialId) continue;
      consumos.set(c.materialId, (consumos.get(c.materialId) ?? CERO).plus(c.cantidad.times(linea.cantidad)));
    }
  }

  const total = new Map<string, Dinero>();
  for (const consumos of porVenta.values()) {
    for (const [materialId, consumo] of consumos) {
      const registrado = consumo.toDecimalPlaces(DECIMALES_MOVIMIENTO, Decimal.ROUND_HALF_UP);
      total.set(materialId, (total.get(materialId) ?? CERO).plus(registrado));
    }
  }
  return total;
}

// ─── Comparacion real vs teorico ─────────────────────────────────────────────

export type MaterialParaConsumo = {
  id: string;
  nombre: string;
  costoUnitario: Dinero;
};

export type LineaConsumo<T extends MaterialParaConsumo = MaterialParaConsumo> = T & {
  teorico: Dinero;
  real: Dinero;
  /** real − teorico. */
  diferencia: Dinero;
  /** diferencia / teorico × 100 (2 decimales); null si el teorico es 0. */
  diferenciaPct: Dinero | null;
  /** teorico × costo actual, a centavos. */
  valorTeorico: Dinero;
  /** real × costo actual, a centavos. */
  valorReal: Dinero;
  /** diferencia × costo actual, a centavos (con signo). */
  valorDiferencia: Dinero;
};

export type ReporteConsumo<T extends MaterialParaConsumo = MaterialParaConsumo> = {
  /** Mayor desvio en valor (absoluto) primero. */
  lineas: LineaConsumo<T>[];
  /** Suma de los valores ya redondeados de cada linea. */
  totalValorTeorico: Dinero;
  totalValorReal: Dinero;
  totalValorDiferencia: Dinero;
};

/** Desvio porcentual sobre el teorico; null (no 0, no Infinity) si el teorico es 0. */
export function diferenciaPorcentual(diferencia: Dinero, teorico: Dinero): Dinero | null {
  if (teorico.isZero()) return null;
  return diferencia.div(teorico).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Cruza teorico y real por material. `teorico` y `real` son mapas
 * materialId → cantidad (real con signo positivo = salio). Un id que no figura
 * en `materiales` es un error de armado, no se descarta en silencio.
 */
export function compararConsumo<T extends MaterialParaConsumo>(
  materiales: T[],
  teorico: Map<string, Dinero>,
  real: Map<string, Dinero>,
): ReporteConsumo<T> {
  const conocidos = new Set(materiales.map((m) => m.id));
  for (const id of [...teorico.keys(), ...real.keys()]) {
    if (!conocidos.has(id)) throw new Error(`Falta el material ${id} para comparar el consumo.`);
  }

  const lineas: LineaConsumo<T>[] = [];
  for (const m of materiales) {
    const t = teorico.get(m.id) ?? CERO;
    const r = real.get(m.id) ?? CERO;
    if (t.isZero() && r.isZero()) continue;
    const diferencia = r.minus(t);
    lineas.push({
      ...m,
      teorico: t,
      real: r,
      diferencia,
      diferenciaPct: diferenciaPorcentual(diferencia, t),
      valorTeorico: aMoneda(t.times(m.costoUnitario)),
      valorReal: aMoneda(r.times(m.costoUnitario)),
      valorDiferencia: aMoneda(diferencia.times(m.costoUnitario)),
    });
  }

  lineas.sort(
    (a, b) =>
      b.valorDiferencia.abs().comparedTo(a.valorDiferencia.abs()) ||
      b.diferencia.abs().comparedTo(a.diferencia.abs()) ||
      comparar(a.nombre, b.nombre),
  );

  return {
    lineas,
    totalValorTeorico: sumar(...lineas.map((l) => l.valorTeorico)),
    totalValorReal: sumar(...lineas.map((l) => l.valorReal)),
    totalValorDiferencia: sumar(...lineas.map((l) => l.valorDiferencia)),
  };
}
