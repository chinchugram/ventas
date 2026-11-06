import { aMoneda, aCosto, CERO, d, sumar, type Dinero } from "@/lib/money";

/**
 * Registro de produccion (ola 6, 6.1). Logica pura, sin base ni Next: la usan la
 * accion, las pantallas (para los avisos en vivo) y los scripts de prueba.
 *
 * Que es un trabajo: lo que de verdad se uso para UNA linea de venta. Minutos por
 * maquina, minutos de mano de obra y materiales realmente consumidos.
 *
 * Unidades de la receta (`RecetaComponente.cantidad`):
 *   - MATERIAL: cantidad del material, en su unidad, POR UNIDAD de articulo.
 *   - MAQUINA y MANO_OBRA: HORAS por unidad de articulo (el costo es $/hora). Por eso
 *     el minuto sugerido es `cantidad × 60 × cantidad de la linea`.
 *
 * Redondeos como la base: minutos a 2 decimales (`Decimal(10,2)`), materiales a
 * 3 (`Decimal(14,3)`), redondeando RECIEN sobre la suma (igual que
 * `consumo-teorico.ts`, que replica lo que descuenta `registrarVentaEnTx`).
 */

export const MINUTOS_POR_HORA = 60;
export const MAX_MINUTOS = d("99999.99");
export const MAX_CANTIDAD = d("99999999.999");

export type TipoComponente = "MATERIAL" | "MAQUINA" | "MANO_OBRA";

/** Componente de receta plano: sin costos (la produccion de taller no los maneja). */
export type ComponenteReceta = {
  tipo: TipoComponente;
  materialId: string | null;
  maquinaId: string | null;
  cantidad: Dinero;
};

export type TiempoMaquina = { maquinaId: string; minutos: Dinero };
export type ConsumoMaterial = { materialId: string; cantidad: Dinero };

export type SugerenciaProduccion = {
  maquinas: TiempoMaquina[];
  minutosManoObra: Dinero;
  materiales: ConsumoMaterial[];
};

const redondeoMinutos = (v: Dinero) => aMoneda(v);
const redondeoCantidad = (v: Dinero) => v.toDecimalPlaces(3);

/** Suma por clave y devuelve ordenado por clave (resultado estable). */
function sumarPorClave(pares: { clave: string; valor: Dinero }[]): { clave: string; valor: Dinero }[] {
  const acumulado = new Map<string, Dinero>();
  for (const { clave, valor } of pares) acumulado.set(clave, (acumulado.get(clave) ?? CERO).plus(valor));
  return [...acumulado].sort(([a], [b]) => a.localeCompare(b)).map(([clave, valor]) => ({ clave, valor }));
}

/**
 * Lo que la receta preve para `cantidadLinea` unidades: la sugerencia con la que se
 * precarga la pantalla. Un componente repetido (el mismo material dos veces) se suma.
 * Un articulo sin receta no sugiere nada.
 */
export function sugerirDesdeReceta(componentes: ComponenteReceta[], cantidadLinea: Dinero | string): SugerenciaProduccion {
  const cantidad = d(cantidadLinea);
  const aMinutos = (c: ComponenteReceta) => c.cantidad.times(MINUTOS_POR_HORA).times(cantidad);

  const maquinas = sumarPorClave(
    componentes.filter((c) => c.tipo === "MAQUINA" && c.maquinaId).map((c) => ({ clave: c.maquinaId!, valor: aMinutos(c) })),
  ).map(({ clave, valor }) => ({ maquinaId: clave, minutos: redondeoMinutos(valor) }));

  const minutosManoObra = redondeoMinutos(sumar(...componentes.filter((c) => c.tipo === "MANO_OBRA").map(aMinutos)));

  const materiales = sumarPorClave(
    componentes.filter((c) => c.tipo === "MATERIAL" && c.materialId).map((c) => ({ clave: c.materialId!, valor: c.cantidad.times(cantidad) })),
  ).map(({ clave, valor }) => ({ materialId: clave, cantidad: redondeoCantidad(valor) }));

  return { maquinas, minutosManoObra, materiales };
}

/**
 * Lo que la venta descuento de stock por receta para esa linea: los materiales de la
 * receta × la cantidad vendida. Un articulo que es servicio no descuenta stock (igual
 * que `registrarVentaEnTx`), aunque su receta tenga materiales.
 */
export function consumoDeRecetaEnStock(componentes: ComponenteReceta[], cantidadLinea: Dinero | string, esServicio: boolean): ConsumoMaterial[] {
  if (esServicio) return [];
  return sugerirDesdeReceta(componentes, cantidadLinea).materiales;
}

// ─── Validacion de la carga ───────────────────────────────────────────────────

export type CargaDeTrabajo = {
  minutosManoObra: Dinero;
  tiempos: TiempoMaquina[];
  consumos: ConsumoMaterial[];
};

function repetidos(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/**
 * Reglas de la carga que no dependen de la base (las que si dependen, como que la
 * maquina exista y este activa, las verifica el dominio). Devuelve el mensaje para el
 * usuario, o null si esta bien.
 */
export function validarCarga(carga: CargaDeTrabajo): string | null {
  if (carga.minutosManoObra.lt(0)) return "Los minutos de mano de obra no pueden ser negativos.";
  if (carga.minutosManoObra.gt(MAX_MINUTOS)) return "Los minutos de mano de obra son demasiados.";
  for (const t of carga.tiempos) {
    if (t.minutos.lt(0)) return "Los minutos de una máquina no pueden ser negativos.";
    if (t.minutos.gt(MAX_MINUTOS)) return "Los minutos de una máquina son demasiados.";
  }
  for (const c of carga.consumos) {
    if (c.cantidad.lt(0)) return "La cantidad de un material no puede ser negativa.";
    if (c.cantidad.gt(MAX_CANTIDAD)) return "La cantidad de un material es demasiado grande.";
  }
  if (repetidos(carga.tiempos.map((t) => t.maquinaId))) return "Hay una máquina repetida: cargá una sola fila por máquina.";
  if (repetidos(carga.consumos.map((c) => c.materialId))) return "Hay un material repetido: cargá una sola fila por material.";
  if (carga.tiempos.length === 0 && carga.consumos.length === 0 && carga.minutosManoObra.isZero()) {
    return "Cargá al menos un tiempo de máquina, mano de obra o un material.";
  }
  return null;
}

// ─── Ajuste de stock por la diferencia contra la receta ───────────────────────

/**
 * Marca que identifica en el motivo de un movimiento AJUSTE a la linea de venta que lo
 * origino. El modelo no tiene una columna para esto (y es cerrado), asi que el libro de
 * movimientos es la fuente de verdad de lo ya ajustado: sirve para no descontar dos
 * veces, tambien despues de anular y recargar el trabajo de la misma linea.
 */
export function marcaDeLinea(ventaItemId: string): string {
  return `ref:${ventaItemId}`;
}

/** Motivo del movimiento AJUSTE que deja el ajuste de un trabajo. */
export function motivoDeAjusteProduccion(venta: { numero: number; anio: number }, ventaItemId: string): string {
  return `Producción de la venta #${venta.numero}/${venta.anio}: consumo real contra receta (${marcaDeLinea(ventaItemId)})`;
}

export type FilaAjuste = {
  materialId: string;
  /** Lo que la receta preveia (y la venta descontó). */
  receta: Dinero;
  /** Lo realmente usado. */
  real: Dinero;
  /** real − receta: positivo = se uso de mas. */
  diferencia: Dinero;
  /** Lo que ya se ajusto antes por esta linea (suma de movimientos AJUSTE, con signo de stock). */
  yaAjustado: Dinero;
  /** Movimiento de stock a registrar ahora (con signo): −diferencia − yaAjustado. 0 = nada que hacer. */
  movimiento: Dinero;
};

/**
 * Cuanto hay que mover el stock de cada material cargado para que, junto con lo que la
 * venta ya desconto por receta, el stock refleje el consumo REAL.
 *
 * El objetivo es −(real − receta) en total para la linea; se resta lo ya ajustado, asi
 * el ajuste es idempotente: repetirlo (o recargar el trabajo y ajustar otra vez) nunca
 * descuenta dos veces. Solo cuentan los materiales cargados en el trabajo: un material
 * que la receta trae y no se cargo no se toca (para decir "no se uso", cargarlo en 0).
 */
export function calcularAjusteDeStock(args: {
  receta: ConsumoMaterial[];
  real: ConsumoMaterial[];
  yaAjustado: ConsumoMaterial[];
}): FilaAjuste[] {
  const porId = (xs: ConsumoMaterial[]) => new Map(sumarPorClave(xs.map((x) => ({ clave: x.materialId, valor: x.cantidad }))).map((x) => [x.clave, x.valor]));
  const receta = porId(args.receta);
  const yaAjustado = porId(args.yaAjustado);
  return sumarPorClave(args.real.map((x) => ({ clave: x.materialId, valor: x.cantidad }))).map(({ clave, valor }) => {
    const r = receta.get(clave) ?? CERO;
    const ya = yaAjustado.get(clave) ?? CERO;
    const real = redondeoCantidad(valor);
    const diferencia = real.minus(r);
    return {
      materialId: clave,
      receta: r,
      real,
      diferencia,
      yaAjustado: ya,
      movimiento: diferencia.neg().minus(ya).toDecimalPlaces(3),
    };
  });
}

// ─── Costo real (solo dueño: lo usa 6.2, aca queda la formula en un solo lugar) ──

/**
 * Costo real de un trabajo = Σ cantidad × costoUnitarioSnapshot + Σ minutos/60 × costoHoraSnapshot
 * + minutosManoObra/60 × costoHoraManoObraSnapshot. Usa los costos CONGELADOS al cargar.
 * Las pantallas del empleado nunca llaman a esto.
 */
export function costoRealDeTrabajo(t: {
  tiempos: { minutos: Dinero; costoHoraSnapshot: Dinero }[];
  consumos: { cantidad: Dinero; costoUnitarioSnapshot: Dinero }[];
  minutosManoObra: Dinero;
  costoHoraManoObraSnapshot: Dinero;
}): Dinero {
  const horas = (min: Dinero) => min.div(MINUTOS_POR_HORA);
  return aMoneda(
    sumar(
      ...t.consumos.map((c) => aCosto(c.cantidad.times(c.costoUnitarioSnapshot))),
      ...t.tiempos.map((x) => aCosto(horas(x.minutos).times(x.costoHoraSnapshot))),
      aCosto(horas(t.minutosManoObra).times(t.costoHoraManoObraSnapshot)),
    ),
  );
}

// ─── Listado ──────────────────────────────────────────────────────────────────

export const FILTROS_PRODUCCION = ["pendientes", "cargadas", "todas"] as const;
export type FiltroProduccion = (typeof FILTROS_PRODUCCION)[number];

export const ETIQUETA_FILTRO: Record<FiltroProduccion, string> = {
  pendientes: "Sin cargar",
  cargadas: "Cargadas",
  todas: "Todas",
};

/** Filtro de la URL: cualquier cosa rara vuelve al que se muestra por defecto. */
export function parsearFiltro(valor: string | string[] | undefined): FiltroProduccion {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (FILTROS_PRODUCCION as readonly string[]).includes(v ?? "") ? (v as FiltroProduccion) : "pendientes";
}

/** Texto de busqueda de la URL: sin espacios sobrantes y acotado. */
export function parsearBusqueda(valor: string | string[] | undefined): string {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (v ?? "").trim().slice(0, 60);
}

/** "5" o "5/2026" o "#5" → numero de venta; si no parece un numero, null. */
export function numeroDeVentaEnBusqueda(texto: string): number | null {
  const m = /^#?(\d{1,9})(?:\/\d{4})?$/.exec(texto.trim());
  return m ? Number(m[1]) : null;
}

/** Minutos para mostrar: "90 min" o "1 h 30 min". Los decimales se muestran con coma. */
export function fmtMinutos(minutos: Dinero | string): string {
  const m = d(minutos);
  const entero = m.floor();
  const decimales = m.minus(entero);
  const h = entero.div(MINUTOS_POR_HORA).floor();
  const resto = entero.minus(h.times(MINUTOS_POR_HORA)).plus(decimales);
  const txt = (v: Dinero) => v.toDecimalPlaces(2).toString().replace(".", ",");
  if (h.isZero()) return `${txt(m)} min`;
  return resto.isZero() ? `${h.toString()} h` : `${h.toString()} h ${txt(resto)} min`;
}
