import { aCosto, aMoneda, CERO, d, Dinero, porcentaje, sumar } from "./money";

export type TipoComponente = "MATERIAL" | "MAQUINA" | "MANO_OBRA";

/**
 * Componente de receta ya resuelto a valores planos. Esta forma la arma la capa
 * de datos; el motor de costeo no sabe nada de Prisma ni de la base, asi que es
 * trivial de testear y de razonar.
 */
export type ComponenteResuelto = {
  id: string;
  tipo: TipoComponente;
  etiqueta: string;
  cantidad: Dinero;
  costoUnitario: Dinero;
  costoUnitarioOverride: boolean;
  notas: string | null;
};

export type ComponenteCosteado = ComponenteResuelto & {
  costoTotal: Dinero;
};

export type ResultadoReceta = {
  costoTotal: Dinero;
  costoMateriales: Dinero;
  costoMaquinas: Dinero;
  costoManoObra: Dinero;
  componentes: ComponenteCosteado[];
  /** false = no hay receta o esta vacia: el costo real es desconocido. */
  confiable: boolean;
  /**
   * Componentes sin costo unitario resoluble. No es un error: es una
   * advertencia de que el costo real es mas alto que el estimado.
   */
  advertencias: string[];
};

/**
 * Costo de una receta: materiales + horas de maquina + horas de mano de obra.
 *
 * Puro y sin dependencias de infraestructura a proposito: es la funcion mas
 * importante del sistema y tiene que poder probarse sin levantar nada.
 */
export function costearReceta(
  componentes: ComponenteResuelto[],
  costoHoraManoObra: Dinero,
): ResultadoReceta {
  const advertencias: string[] = [];

  const costeados: ComponenteCosteado[] = componentes.map((c) => {
    if (c.costoUnitarioOverride) {
      if (c.costoUnitario.isZero()) {
        advertencias.push(
          `${c.etiqueta}: override de costo en 0, el costo real no se esta controlando.`,
        );
      }
    } else if (c.costoUnitario.isZero() && c.tipo !== "MANO_OBRA") {
      advertencias.push(`${c.etiqueta}: sin costo unitario cargado, se esta contando como 0.`);
    }

    return {
      ...c,
      costoTotal: aCosto(c.cantidad.times(c.costoUnitario)),
    };
  });

  const costoMateriales = sumar(
    ...costeados.filter((c) => c.tipo === "MATERIAL").map((c) => c.costoTotal),
  );
  const costoMaquinas = sumar(
    ...costeados.filter((c) => c.tipo === "MAQUINA").map((c) => c.costoTotal),
  );
  const costoManoObra = sumar(
    ...costeados.filter((c) => c.tipo === "MANO_OBRA").map((c) => c.costoTotal),
  );

  return {
    costoTotal: aCosto(costoMateriales.plus(costoMaquinas).plus(costoManoObra)),
    costoMateriales,
    costoMaquinas,
    costoManoObra,
    componentes: costeados,
    confiable: costeados.length > 0,
    advertencias,
  };
}

export type Margen = {
  precioBruto: Dinero;
  precioNeto: Dinero;
  iva: Dinero;
  ivaPct: Dinero;
  costo: Dinero;
  /** precioBruto - costo */
  ganancia: Dinero;
  /** ganancia / precioBruto. Medida de rentabilidad sobre la venta. */
  margenPct: Dinero;
  /** ganancia / costo. Cuanto se multiplica el dinero invertido. */
  markupPct: Dinero;
  /** El costo no se conoce con certeza: el margen es optimista. */
  costoConfiable: boolean;
};

/**
 * Descompone un precio con IVA y calcula la rentabilidad.
 *
 * `precioBruto` es lo que el cliente paga. El IVA se separa pero NO se cuenta
 * como ganancia: es un impuesto que se le devuelve a la AFIP. Por eso la
 * ganancia se mide contra el neto y el margen se calcula sobre el bruto.
 */
export function calcularMargen(params: {
  precioBruto: Dinero;
  costo: Dinero;
  ivaPct: Dinero;
  costoConfiable?: boolean;
}): Margen {
  const { precioBruto, costo, ivaPct } = params;

  // precioBruto = neto * (1 + iva)
  const precioNeto = precioBruto.div(d(1).plus(ivaPct.div(100)));
  const iva = precioBruto.minus(precioNeto);
  const ganancia = precioBruto.minus(costo);

  return {
    precioBruto: aMoneda(precioBruto),
    precioNeto: aMoneda(precioNeto),
    iva: aMoneda(iva),
    ivaPct,
    costo: aCosto(costo),
    ganancia: aMoneda(ganancia),
    margenPct: porcentaje(ganancia, precioBruto),
    markupPct: porcentaje(ganancia, costo),
    costoConfiable: params.costoConfiable ?? true,
  };
}

/**
 * Precio de venta necesario para alcanzar un margen objetivo.
 *
 * margen = (bruto - costo) / bruto  =>  bruto = costo / (1 - margen)
 *
 * A diferencia del markup, el margen objetivo es el que el dueño puede leer en
 * una cuenta: "quiero ganar el 40% de lo que facturo".
 */
export function precioParaMargen(costo: Dinero, margenObjetivoPct: Dinero): Dinero {
  const margen = d(margenObjetivoPct).div(100);
  // Con margen >= 100% el precio no existe; devolver Infinity seria propagar NaN
  // a toda la interfaz, asi que se documenta el limite con un tope.
  if (margen.gte(1)) return aMoneda(costo.times(10));
  return aMoneda(costo.div(d(1).minus(margen)));
}

/**
 * Linea de venta: precio, IVA y costo congelado. Devuelve los numeros que se
 * guardan en `venta_items` para que el historico no cambie nunca.
 */
export function costearLineaVenta(params: {
  cantidad: Dinero;
  precioUnitario: Dinero;
  ivaPct: Dinero;
  costoUnitario: Dinero;
}): {
  subtotalBruto: Dinero;
  subtotalNeto: Dinero;
  subtotalIVA: Dinero;
  costoUnitarioSnapshot: Dinero;
  costoTotalSnapshot: Dinero;
  ganancia: Dinero;
} {
  const { cantidad, precioUnitario, ivaPct, costoUnitario } = params;

  const subtotalBruto = aMoneda(cantidad.times(precioUnitario));
  const factor = d(1).plus(ivaPct.div(100));
  const subtotalNeto = aMoneda(subtotalBruto.div(factor));
  const subtotalIVA = aMoneda(subtotalBruto.minus(subtotalNeto));
  const costoUnitarioSnapshot = aCosto(costoUnitario);
  const costoTotalSnapshot = aMoneda(cantidad.times(costoUnitarioSnapshot));

  return {
    subtotalBruto,
    subtotalNeto,
    subtotalIVA,
    costoUnitarioSnapshot,
    costoTotalSnapshot,
    ganancia: aMoneda(subtotalBruto.minus(costoTotalSnapshot)),
  };
}

/** Header de una venta: totales, costo y ganancia. */
export type TotalesVenta = {
  totalNeto: Dinero;
  totalIVA: Dinero;
  totalBruto: Dinero;
  costoTotal: Dinero;
  ganancia: Dinero;
  margenPct: Dinero;
};

export function totalizarVenta(
  lineas: { subtotalNeto: Dinero; subtotalIVA: Dinero; subtotalBruto: Dinero; costoTotalSnapshot: Dinero }[],
): TotalesVenta {
  const totalBruto = sumar(...lineas.map((l) => l.subtotalBruto));
  const totalNeto = sumar(...lineas.map((l) => l.subtotalNeto));
  const totalIVA = sumar(...lineas.map((l) => l.subtotalIVA));
  const costoTotal = sumar(...lineas.map((l) => l.costoTotalSnapshot));
  const ganancia = totalBruto.minus(costoTotal);

  return {
    totalNeto: aMoneda(totalNeto),
    totalIVA: aMoneda(totalIVA),
    totalBruto: aMoneda(totalBruto),
    costoTotal: aMoneda(costoTotal),
    ganancia: aMoneda(ganancia),
    margenPct: porcentaje(ganancia, totalBruto),
  };
}

/**
 * Estado de pago de una venta. Nunca se persiste: se calcula, para que el saldo
 * no pueda desincronizarse de los comprobantes.
 */
export type EstadoPago = "AL_DIA" | "PARCIAL" | "PENDIENTE" | "PAGADA";

export function estadoPago(totalBruto: Dinero, pagado: Dinero): EstadoPago {
  // Tolerancia de 1 centavo: por redondeo de una parte y otra, una venta
  // totalmente pagada puede dar 0.99 pendiente. Marcarlo como deuda seria
  // una molestia falsa.
  const diferencia = totalBruto.minus(pagado);
  const tolerancia = d("0.01");

  if (diferencia.lte(tolerancia)) return "PAGADA";
  if (pagado.gt(tolerancia)) return "PARCIAL";
  if (totalBruto.gt(CERO)) return "PENDIENTE";
  return "AL_DIA";
}
