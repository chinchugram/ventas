import Decimal from "decimal.js";
import { ErrorDeNegocio, esDecimal, normalizarDecimal } from "@/lib/acciones";
import { CERO, d, fmtNumero, type Dinero } from "@/lib/money";

// Estimacion de tiempos de un pedido (ola 6, tarea 6.3): cuantas horas de maquina
// y de mano de obra lleva, segun lo que tardaron los trabajos YA cargados del
// MISMO articulo. Logica pura, sin base ni Next: la usan la consulta
// (`src/lib/queries/estimacion-tiempos.ts`), la pantalla `/produccion/estimar` y
// `scripts/verificar-estimacion-tiempos.ts`.
//
// Reglas:
//  - Cada trabajo se normaliza a minutos POR UNIDAD (minutos / cantidad de la linea
//    de venta), asi un trabajo de 10 piezas sirve para estimar uno de 3.
//  - La estimacion es la MEDIANA de los ultimos `N_TRABAJOS_MUESTRA` trabajos
//    (la mediana no se deja arrastrar por un trabajo raro). Con cantidad par de
//    muestras es el promedio de las dos centrales.
//  - Con menos de `MIN_MUESTRAS` muestras NO se estima: se devuelve "sin datos
//    suficientes" con cuantas hay. Nunca se inventa un numero.
//  - Solo tiempos: sin costos ni margenes (lo puede ver el empleado).
//  - Todo en Decimal. Los minutos NO se redondean aca: se redondea al mostrar.

/** Cuantos trabajos (los mas recientes) respaldan una estimacion. */
export const N_TRABAJOS_MUESTRA = 10;

/** Minimo de muestras para dar un numero. Por debajo: "sin datos suficientes". */
export const MIN_MUESTRAS = 3;

/** Tope de lineas por consulta (evita pedidos absurdos). */
export const MAX_LINEAS = 50;

/** Tope de cantidad por linea. */
export const MAX_CANTIDAD = new Decimal(1_000_000);

export type OpcionesEstimacion = {
  /** Trabajos mas recientes que entran en la mediana (por defecto `N_TRABAJOS_MUESTRA`). */
  n?: number;
  /** Muestras minimas para estimar (por defecto `MIN_MUESTRAS`). */
  minMuestras?: number;
};

// ─── Mediana ─────────────────────────────────────────────────────────────────

/** Mediana en Decimal; con cantidad par, el promedio de las dos centrales. Lanza si no hay valores. */
export function mediana(valores: readonly Dinero[]): Dinero {
  if (valores.length === 0) throw new Error("La mediana necesita al menos un valor");
  const orden = [...valores].sort((a, b) => a.comparedTo(b));
  const medio = orden.length >> 1;
  return orden.length % 2 === 1 ? orden[medio]! : orden[medio - 1]!.plus(orden[medio]!).div(2);
}

// ─── Historial ───────────────────────────────────────────────────────────────

export type TiempoMaquina = { maquinaId: string; maquinaNombre: string; minutos: Dinero };

/**
 * Un trabajo vigente ya cargado, tal como sale de la base: `cantidad` es la de la
 * linea de venta que se produjo; los minutos son los del trabajo completo.
 */
export type TrabajoHistorico = {
  cantidad: Dinero;
  minutosManoObra: Dinero;
  tiempos: TiempoMaquina[];
};

/** Estimacion de un tiempo (maquina, total de maquinas o mano de obra) para una cantidad. */
export type Estimacion =
  | {
      suficiente: true;
      /** Muestras que la respaldan (trabajos con ese dato, hasta N). */
      muestras: number;
      minutosPorUnidad: Dinero;
      /** Mediana por unidad × cantidad pedida. */
      minutos: Dinero;
      /** Rango (minimo y maximo por unidad × cantidad) de las muestras. */
      minutosMin: Dinero;
      minutosMax: Dinero;
    }
  | {
      suficiente: false;
      /** Cuantas muestras hay (menos que `minimoRequerido`). */
      muestras: number;
      minimoRequerido: number;
    };

export type EstimacionMaquina = Estimacion & { maquinaId: string; maquinaNombre: string };

export type LineaEstimada = {
  articuloId: string;
  nombre: string;
  cantidad: Dinero;
  /** Trabajos vigentes del articulo que respaldan la linea (hasta N). */
  trabajos: number;
  /** Suma de todas las maquinas de cada trabajo, normalizada por unidad. */
  maquinaTotal: Estimacion;
  /** Mediana por maquina; vacio si el articulo no tiene datos suficientes. */
  maquinas: EstimacionMaquina[];
  manoObra: Estimacion;
};

function estimar(muestrasPorUnidad: readonly Dinero[], cantidad: Dinero, minMuestras: number): Estimacion {
  if (muestrasPorUnidad.length < minMuestras) {
    return { suficiente: false, muestras: muestrasPorUnidad.length, minimoRequerido: minMuestras };
  }
  const porUnidad = mediana(muestrasPorUnidad);
  const ordenadas = [...muestrasPorUnidad].sort((a, b) => a.comparedTo(b));
  return {
    suficiente: true,
    muestras: muestrasPorUnidad.length,
    minutosPorUnidad: porUnidad,
    minutos: porUnidad.times(cantidad),
    minutosMin: ordenadas[0]!.times(cantidad),
    minutosMax: ordenadas[ordenadas.length - 1]!.times(cantidad),
  };
}

function opcionesResueltas(o: OpcionesEstimacion = {}) {
  const n = o.n ?? N_TRABAJOS_MUESTRA;
  const minMuestras = o.minMuestras ?? MIN_MUESTRAS;
  if (!Number.isInteger(n) || n < 1) throw new Error("N de trabajos invalido");
  if (!Number.isInteger(minMuestras) || minMuestras < 1) throw new Error("Minimo de muestras invalido");
  return { n, minMuestras };
}

/**
 * Estima una linea (articulo × cantidad) con su historial, ordenado del trabajo
 * MAS RECIENTE al mas viejo. Los trabajos con cantidad <= 0 no sirven para normalizar
 * y se ignoran (no cuentan como muestra). Se toman los primeros N validos.
 *
 * Por maquina: la muestra de una maquina son los trabajos donde se uso (una maquina
 * que no figura en un trabajo no se uso ahi, no cuenta como 0). El total de
 * maquinas, en cambio, es la mediana de la suma de cada trabajo (un trabajo sin
 * maquinas es una muestra valida de 0 min), no la suma de medianas.
 */
export function estimarLinea(
  entrada: { articuloId: string; nombre: string; cantidad: Dinero },
  historial: readonly TrabajoHistorico[],
  opciones?: OpcionesEstimacion,
): LineaEstimada {
  const { n, minMuestras } = opcionesResueltas(opciones);
  const { cantidad } = entrada;
  if (!cantidad.gt(0)) throw new ErrorDeNegocio("La cantidad tiene que ser mayor a 0.");

  const ventana = historial.filter((t) => t.cantidad.gt(0)).slice(0, n);
  const manoObra = estimar(
    ventana.map((t) => t.minutosManoObra.div(t.cantidad)),
    cantidad,
    minMuestras,
  );
  const maquinaTotal = estimar(
    ventana.map((t) => t.tiempos.reduce<Dinero>((acc, x) => acc.plus(x.minutos), CERO).div(t.cantidad)),
    cantidad,
    minMuestras,
  );

  const maquinas: EstimacionMaquina[] = [];
  if (ventana.length >= minMuestras) {
    const porMaquina = new Map<string, { nombre: string; muestras: Dinero[] }>();
    for (const t of ventana) {
      // Si una maquina figurara dos veces en el mismo trabajo (la base lo impide), se suman.
      const delTrabajo = new Map<string, { nombre: string; minutos: Dinero }>();
      for (const x of t.tiempos) {
        const previo = delTrabajo.get(x.maquinaId);
        delTrabajo.set(x.maquinaId, { nombre: x.maquinaNombre, minutos: (previo?.minutos ?? CERO).plus(x.minutos) });
      }
      for (const [id, x] of delTrabajo) {
        const acc = porMaquina.get(id) ?? { nombre: x.nombre, muestras: [] };
        acc.muestras.push(x.minutos.div(t.cantidad));
        porMaquina.set(id, acc);
      }
    }
    for (const [maquinaId, { nombre, muestras }] of porMaquina) {
      maquinas.push({ maquinaId, maquinaNombre: nombre, ...estimar(muestras, cantidad, minMuestras) });
    }
    maquinas.sort((a, b) => a.maquinaNombre.localeCompare(b.maquinaNombre, "es") || a.maquinaId.localeCompare(b.maquinaId));
  }

  return {
    articuloId: entrada.articuloId,
    nombre: entrada.nombre,
    cantidad,
    trabajos: ventana.length,
    maquinaTotal,
    maquinas,
    manoObra,
  };
}

// ─── Total del pedido ────────────────────────────────────────────────────────

export type Subtotal = { minutos: Dinero; minutosMin: Dinero; minutosMax: Dinero };

export type TotalMaquina = Subtotal & { maquinaId: string; maquinaNombre: string; completo: boolean };

export type TotalPedido = {
  lineasConDatos: number;
  lineasSinDatos: number;
  /** true si TODAS las lineas tienen datos suficientes: el total es el del pedido entero. */
  completo: boolean;
  /** Suma de las lineas con datos; `null` si ninguna tiene (no se muestra un 0 inventado). */
  maquinaTotal: Subtotal | null;
  manoObra: Subtotal | null;
  /** Por maquina, solo con lo que tiene datos; `completo` dice si falta algo (otra linea sin datos o la maquina con pocas muestras). */
  porMaquina: TotalMaquina[];
};

function sumarSubtotales(lista: readonly { minutos: Dinero; minutosMin: Dinero; minutosMax: Dinero }[]): Subtotal {
  return {
    minutos: lista.reduce<Dinero>((a, x) => a.plus(x.minutos), CERO),
    minutosMin: lista.reduce<Dinero>((a, x) => a.plus(x.minutosMin), CERO),
    minutosMax: lista.reduce<Dinero>((a, x) => a.plus(x.minutosMax), CERO),
  };
}

/** Suma las lineas que tienen datos suficientes; las otras quedan afuera y se cuentan. */
export function totalizarPedido(lineas: readonly LineaEstimada[]): TotalPedido {
  const conDatos = lineas.filter((l) => l.maquinaTotal.suficiente && l.manoObra.suficiente);
  const lineasSinDatos = lineas.length - conDatos.length;

  const maquinaTotal = conDatos.length
    ? sumarSubtotales(conDatos.flatMap((l) => (l.maquinaTotal.suficiente ? [l.maquinaTotal] : [])))
    : null;
  const manoObra = conDatos.length
    ? sumarSubtotales(conDatos.flatMap((l) => (l.manoObra.suficiente ? [l.manoObra] : [])))
    : null;

  const porMaquina = new Map<string, { nombre: string; aportes: Subtotal[]; completo: boolean }>();
  for (const l of conDatos) {
    for (const m of l.maquinas) {
      const acc = porMaquina.get(m.maquinaId) ?? { nombre: m.maquinaNombre, aportes: [], completo: lineasSinDatos === 0 };
      if (m.suficiente) acc.aportes.push(m);
      else acc.completo = false;
      porMaquina.set(m.maquinaId, acc);
    }
  }
  const totalesMaquina: TotalMaquina[] = [...porMaquina]
    .filter(([, x]) => x.aportes.length > 0)
    .map(([maquinaId, x]) => ({ maquinaId, maquinaNombre: x.nombre, completo: x.completo, ...sumarSubtotales(x.aportes) }))
    .sort((a, b) => a.maquinaNombre.localeCompare(b.maquinaNombre, "es") || a.maquinaId.localeCompare(b.maquinaId));

  return {
    lineasConDatos: conDatos.length,
    lineasSinDatos,
    completo: lineas.length > 0 && lineasSinDatos === 0,
    maquinaTotal,
    manoObra,
    porMaquina: totalesMaquina,
  };
}

// ─── Validacion de la entrada ────────────────────────────────────────────────

export type LineaPedida = { articuloId: string; cantidad: Dinero };

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esIdValido(id: string): boolean {
  return PATRON_UUID.test(id);
}

/**
 * Valida lo que viene del formulario o de la URL (todo texto). Devuelve TODOS los
 * errores juntos, con mensaje claro, en vez de cortar en el primero. No consulta la
 * base: que el articulo exista lo verifica la consulta.
 */
export function validarPedido(
  entradas: readonly { articuloId: string; cantidad: string }[],
): { ok: true; lineas: LineaPedida[] } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  if (entradas.length === 0) errores.push("Agregá al menos un artículo.");
  if (entradas.length > MAX_LINEAS) errores.push(`Son demasiadas líneas: el máximo es ${MAX_LINEAS}.`);

  const lineas: LineaPedida[] = [];
  entradas.slice(0, MAX_LINEAS).forEach((e, i) => {
    const n = i + 1;
    if (!esIdValido(e.articuloId)) {
      errores.push(`Línea ${n}: el artículo no es válido.`);
      return;
    }
    const texto = e.cantidad.trim();
    if (!esDecimal(texto)) {
      errores.push(`Línea ${n}: la cantidad "${texto}" no es un número válido.`);
      return;
    }
    const cantidad = d(normalizarDecimal(texto));
    if (!cantidad.gt(0)) {
      errores.push(`Línea ${n}: la cantidad tiene que ser mayor a 0.`);
      return;
    }
    if (cantidad.gt(MAX_CANTIDAD)) {
      errores.push(`Línea ${n}: la cantidad es demasiado grande (máximo ${fmtNumero(MAX_CANTIDAD)}).`);
      return;
    }
    lineas.push({ articuloId: e.articuloId, cantidad });
  });

  return errores.length ? { ok: false, errores } : { ok: true, lineas };
}

// ─── Formato ─────────────────────────────────────────────────────────────────

/** "12,5 min" (hasta un decimal; la precision interna no se pierde, solo se muestra redondeada). */
export function fmtMinutos(minutos: Dinero): string {
  return `${fmtNumero(minutos.toDecimalPlaces(1, Decimal.ROUND_HALF_UP))} min`;
}

/** Minutos en formato h:mm ("1:05"), redondeando al minuto mas cercano (59,5 → "1:00"). */
export function fmtHorasMinutos(minutos: Dinero): string {
  const total = minutos.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const horas = total.div(60).floor();
  const resto = total.minus(horas.times(60));
  return `${horas.toFixed(0)}:${resto.toFixed(0).padStart(2, "0")}`;
}
