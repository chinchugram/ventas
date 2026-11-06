import { costearLineaVenta } from "@/lib/costing";
import { validarCuit } from "@/lib/cuit";
import { aMoneda, CERO, d, fmtMoneda, fmtPorcentaje, sumar, type Dinero } from "@/lib/money";

// Reglas fiscales de un comprobante, puras (sin Prisma ni Next): que tipo le
// toca, codigos ARCA, receptor, e importes por alicuota conciliados contra la
// venta. Las usa src/lib/dominio/comprobantes.ts y las prueba
// `scripts/verificar-comprobantes.ts`. Las dudas para el contador estan en
// docs/fiscal-5.1-decisiones.md.

// ─── Tipos y codigos ARCA ─────────────────────────────────────────────────────

export const TIPOS_FACTURA = ["FACTURA_A", "FACTURA_B", "FACTURA_C"] as const;
export const TIPOS_NOTA_CREDITO = ["NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"] as const;
export type TipoFactura = (typeof TIPOS_FACTURA)[number];
export type TipoNotaCredito = (typeof TIPOS_NOTA_CREDITO)[number];
export type TipoComprobante = TipoFactura | TipoNotaCredito;
export type Letra = "A" | "B" | "C";

/** Codigo ARCA (tabla de tipos de comprobante de WSFE). */
export const CODIGO_ARCA: Record<TipoComprobante, number> = {
  FACTURA_A: 1,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_CREDITO_C: 13,
};

export const NOMBRE_TIPO: Record<TipoComprobante, string> = {
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
  NOTA_CREDITO_A: "Nota de crédito A",
  NOTA_CREDITO_B: "Nota de crédito B",
  NOTA_CREDITO_C: "Nota de crédito C",
};

export function letraDe(tipo: TipoComprobante): Letra {
  return tipo.slice(-1) as Letra;
}

export function esFactura(tipo: TipoComprobante): tipo is TipoFactura {
  return (TIPOS_FACTURA as readonly string[]).includes(tipo);
}

export function esNotaCredito(tipo: TipoComprobante): tipo is TipoNotaCredito {
  return (TIPOS_NOTA_CREDITO as readonly string[]).includes(tipo);
}

/** La C no discrimina IVA (emisor monotributista). */
export function discriminaIva(tipo: TipoComprobante): boolean {
  return letraDe(tipo) !== "C";
}

/** La nota de credito lleva la letra de la factura que anula. */
export function tipoNotaCredito(factura: TipoFactura): TipoNotaCredito {
  return `NOTA_CREDITO_${letraDe(factura)}` as TipoNotaCredito;
}

/** "0001-00000042": punto de venta (4 digitos, 5 si pasa de 9999) y numero (8 digitos). */
export function numeroFormateado(puntoVenta: number, numero: number): string {
  return `${String(puntoVenta).padStart(puntoVenta > 9999 ? 5 : 4, "0")}-${String(numero).padStart(8, "0")}`;
}

// ─── Condicion frente al IVA ──────────────────────────────────────────────────

export type CondicionIva = "CONSUMIDOR_FINAL" | "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" | "EXENTO";

/**
 * Codigo ARCA de la condicion frente al IVA del receptor (campo
 * `CondicionIVAReceptorId` de WSFE, obligatorio desde la RG 5616).
 */
export const CODIGO_CONDICION_IVA_RECEPTOR: Record<CondicionIva, number> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
};

/**
 * Que factura corresponde (contrato de la ola 5):
 *  - emisor monotributista → C, sea quien sea el receptor;
 *  - emisor responsable inscripto + receptor responsable inscripto con CUIT valido → A;
 *  - emisor responsable inscripto + cualquier otro receptor → B.
 * Un receptor RI SIN CUIT valido daria B: `validarReceptor` lo rechaza antes,
 * porque ese cliente necesita una A y el error esta en su ficha.
 */
export function tipoDeComprobante(
  emisor: { condicionIva: "RESPONSABLE_INSCRIPTO" | "MONOTRIBUTO" },
  receptor: { condicionIva: CondicionIva; cuit: string | null },
): TipoFactura {
  if (emisor.condicionIva === "MONOTRIBUTO") return "FACTURA_C";
  if (receptor.condicionIva === "RESPONSABLE_INSCRIPTO" && receptor.cuit && validarCuit(receptor.cuit).ok) return "FACTURA_A";
  return "FACTURA_B";
}

// ─── Receptor ─────────────────────────────────────────────────────────────────

/** Tipos de documento ARCA del receptor. */
export const DOC_TIPO = { CUIT: 80, DNI: 96, SIN_IDENTIFICAR: 99 } as const;
export type DocTipo = (typeof DOC_TIPO)[keyof typeof DOC_TIPO];

/** "12.345.678" → "12345678". 7 u 8 digitos; si no, null. */
export function normalizarDni(texto: string | null | undefined): string | null {
  const limpio = (texto ?? "").trim();
  if (!/^[\d\s.]+$/.test(limpio)) return null;
  const digitos = limpio.replace(/\D/g, "");
  return /^\d{7,8}$/.test(digitos) ? digitos : null;
}

export type ClienteReceptor = {
  nombre: string;
  cuit: string | null;
  dni: string | null;
  condicionIva: CondicionIva;
  direccion: string | null;
};

/** Foto del receptor que va al comprobante (y a ARCA). */
export type ReceptorFiscal = {
  nombre: string;
  docTipo: DocTipo;
  /** "0" si no esta identificado. */
  docNro: string;
  condicionIva: CondicionIva;
  domicilio: string | null;
};

export type ResultadoReceptor = { ok: true; receptor: ReceptorFiscal } | { ok: false; error: string };

/**
 * Valida al cliente como receptor y arma su foto.
 *  - Un CUIT o DNI cargado tiene que ser valido (nunca se ignora en silencio).
 *  - Responsable inscripto, monotributista o exento: CUIT obligatorio.
 *  - La A exige receptor RI con CUIT (lo garantiza `tipoDeComprobante`).
 *  - Consumidor final: CUIT (80) si lo tiene, si no DNI (96), si no "sin
 *    identificar" (99, numero 0). Sin identificar, el total tiene que ser menor
 *    a `umbral` (lo recibe de afuera: ver `UMBRAL_IDENTIFICACION_POR_DEFECTO`).
 */
export function validarReceptor(
  cliente: ClienteReceptor,
  contexto: { tipo: TipoComprobante; total: Dinero; umbral: Dinero },
): ResultadoReceptor {
  const nombre = cliente.nombre.trim();
  if (!nombre) return { ok: false, error: "El cliente no tiene nombre." };
  const domicilio = cliente.direccion?.trim() || null;

  let cuit: string | null = null;
  if (cliente.cuit && cliente.cuit.trim()) {
    const r = validarCuit(cliente.cuit);
    if (!r.ok) return { ok: false, error: `El CUIT del cliente no es válido: ${r.error} Corregilo en la ficha del cliente.` };
    cuit = r.cuit;
  }
  let dni: string | null = null;
  if (cliente.dni && cliente.dni.trim()) {
    dni = normalizarDni(cliente.dni);
    if (!dni) return { ok: false, error: "El DNI del cliente no es válido (7 u 8 dígitos). Corregilo en la ficha del cliente." };
  }

  const condicion = cliente.condicionIva;
  if (condicion !== "CONSUMIDOR_FINAL" && !cuit) {
    const etiqueta = { RESPONSABLE_INSCRIPTO: "responsable inscripto", MONOTRIBUTO: "monotributista", EXENTO: "exento" }[condicion];
    return {
      ok: false,
      error: `El cliente figura como ${etiqueta} pero no tiene CUIT: cargá su CUIT o cambiá su condición frente al IVA.`,
    };
  }
  if (letraDe(contexto.tipo) === "A" && (condicion !== "RESPONSABLE_INSCRIPTO" || !cuit)) {
    return { ok: false, error: "La factura A es solo para un responsable inscripto con CUIT válido." };
  }

  if (cuit) return { ok: true, receptor: { nombre, docTipo: DOC_TIPO.CUIT, docNro: cuit, condicionIva: condicion, domicilio } };
  if (dni) return { ok: true, receptor: { nombre, docTipo: DOC_TIPO.DNI, docNro: dni, condicionIva: condicion, domicilio } };
  if (contexto.total.gte(contexto.umbral)) {
    return {
      ok: false,
      error: `Desde ${fmtMoneda(contexto.umbral)} ARCA exige identificar al consumidor final: cargá el DNI o el CUIT del cliente.`,
    };
  }
  return { ok: true, receptor: { nombre, docTipo: DOC_TIPO.SIN_IDENTIFICAR, docNro: "0", condicionIva: condicion, domicilio } };
}

// ─── Alicuotas ────────────────────────────────────────────────────────────────

/** Alicuotas de IVA que acepta ARCA, con su codigo (tabla de alicuotas de WSFE). */
export const ALICUOTAS_ARCA: readonly { pct: string; codigo: number }[] = [
  { pct: "0", codigo: 3 },
  { pct: "2.5", codigo: 9 },
  { pct: "5", codigo: 8 },
  { pct: "10.5", codigo: 4 },
  { pct: "21", codigo: 5 },
  { pct: "27", codigo: 6 },
];

/** Codigo ARCA de una alicuota, o null si ARCA no la tiene. */
export function codigoAlicuota(pct: Dinero): number | null {
  return ALICUOTAS_ARCA.find((a) => d(a.pct).eq(pct))?.codigo ?? null;
}

// ─── Importes ─────────────────────────────────────────────────────────────────

/** Linea de venta tal como esta guardada (`VentaItem`): precio CON IVA incluido. */
export type LineaVentaFiscal = {
  descripcion: string;
  cantidad: Dinero;
  precioUnitario: Dinero;
  ivaPct: Dinero;
  subtotalNeto: Dinero;
  subtotalIVA: Dinero;
  subtotalBruto: Dinero;
};

export type TotalesVentaFiscal = { totalNeto: Dinero; totalIVA: Dinero; totalBruto: Dinero };

export type ImporteAlicuota = { pct: Dinero; codigo: number; base: Dinero; importe: Dinero };

export type LineaComprobante = {
  orden: number;
  descripcion: string;
  cantidad: Dinero;
  precioUnitario: Dinero;
  ivaPct: Dinero;
  subtotalNeto: Dinero;
  subtotalIva: Dinero;
  subtotalBruto: Dinero;
};

export type ImportesComprobante = {
  /** Neto gravado (en la C, el total). */
  neto: Dinero;
  /** IVA (0 en la C). */
  iva: Dinero;
  total: Dinero;
  /** Una por alicuota presente, de menor a mayor. Vacio en la C. */
  alicuotas: ImporteAlicuota[];
  lineas: LineaComprobante[];
  /** Avisos que no frenan la emision pero hay que mostrar. */
  advertencias: string[];
};

export type ResultadoImportes = { ok: true; importes: ImportesComprobante } | { ok: false; error: string };

const pesos = (v: Dinero) => fmtMoneda(v);

/**
 * Importes del comprobante a partir de las lineas de la venta, CONCILIADOS con
 * tolerancia cero: si algo no cierra por un centavo se rechaza con un error
 * claro, nunca se ajusta.
 *
 * Usa exactamente el calculo de la venta (`costearLineaVenta`: el bruto de la
 * linea es cantidad × precio con IVA, redondeado; el neto es bruto / (1 + IVA),
 * redondeado por linea; el IVA es la diferencia) y verifica:
 *  1. cada linea guardada coincide con ese calculo;
 *  2. la suma de las lineas es el total de la venta (neto, IVA y bruto);
 *  3. cada alicuota existe en ARCA.
 * Las alicuotas se agrupan sumando los netos e IVA YA redondeados de cada linea:
 * asi el comprobante suma exactamente lo mismo que la venta. Si el IVA de una
 * alicuota difiere en mas de un centavo de base × alicuota (pasa con muchas
 * lineas), se avisa (ver docs/fiscal-5.1-decisiones.md).
 *
 * Factura C: no discrimina IVA. Neto = total, IVA 0, sin alicuotas; si la venta
 * tiene IVA, se avisa (el monotributista deberia cargar sus articulos con IVA 0).
 */
export function calcularImportes(
  lineasVenta: readonly LineaVentaFiscal[],
  venta: TotalesVentaFiscal,
  tipo: TipoComprobante,
): ResultadoImportes {
  if (lineasVenta.length === 0) return { ok: false, error: "La venta no tiene artículos." };
  const advertencias: string[] = [];

  const lineas: LineaComprobante[] = [];
  for (const [i, l] of lineasVenta.entries()) {
    const nombre = `La línea ${i + 1} ("${l.descripcion}")`;
    if (l.cantidad.lte(0)) return { ok: false, error: `${nombre} tiene cantidad 0 o negativa.` };
    if (l.precioUnitario.lt(0)) return { ok: false, error: `${nombre} tiene un precio negativo.` };
    if (codigoAlicuota(l.ivaPct) === null) {
      return {
        ok: false,
        error: `${nombre} tiene IVA ${fmtPorcentaje(l.ivaPct)}, que ARCA no admite (0, 2,5, 5, 10,5, 21 o 27%).`,
      };
    }
    const cal = costearLineaVenta({ cantidad: l.cantidad, precioUnitario: l.precioUnitario, ivaPct: l.ivaPct, costoUnitario: CERO });
    if (!cal.subtotalBruto.eq(l.subtotalBruto) || !cal.subtotalNeto.eq(l.subtotalNeto) || !cal.subtotalIVA.eq(l.subtotalIVA)) {
      return {
        ok: false,
        error:
          `${nombre} no cierra: guardada dice neto ${pesos(l.subtotalNeto)} + IVA ${pesos(l.subtotalIVA)} = ${pesos(l.subtotalBruto)}, ` +
          `pero cantidad × precio da neto ${pesos(cal.subtotalNeto)} + IVA ${pesos(cal.subtotalIVA)} = ${pesos(cal.subtotalBruto)}. ` +
          "No se factura una venta con importes inconsistentes.",
      };
    }
    lineas.push({
      orden: i + 1,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      ivaPct: l.ivaPct,
      subtotalNeto: cal.subtotalNeto,
      subtotalIva: cal.subtotalIVA,
      subtotalBruto: cal.subtotalBruto,
    });
  }

  const neto = sumar(...lineas.map((l) => l.subtotalNeto));
  const iva = sumar(...lineas.map((l) => l.subtotalIva));
  const total = sumar(...lineas.map((l) => l.subtotalBruto));
  const diferencias = [
    ["neto", neto, venta.totalNeto],
    ["IVA", iva, venta.totalIVA],
    ["total", total, venta.totalBruto],
  ] as const;
  for (const [nombre, calculado, guardado] of diferencias) {
    if (!calculado.eq(guardado)) {
      return {
        ok: false,
        error:
          `El ${nombre} de la venta (${pesos(guardado)}) no coincide con la suma de sus líneas (${pesos(calculado)}). ` +
          "No se factura: revisá la venta.",
      };
    }
  }
  if (total.lte(0)) return { ok: false, error: "No se factura una venta de $ 0." };

  if (!discriminaIva(tipo)) {
    if (iva.gt(0)) {
      advertencias.push(
        `La venta tiene ${pesos(iva)} de IVA, pero la factura C no discrimina IVA: sale por el total (${pesos(total)}). ` +
          "Como monotributista, cargá tus artículos con IVA 0.",
      );
    }
    return { ok: true, importes: { neto: total, iva: CERO, total, alicuotas: [], lineas, advertencias } };
  }

  const grupos = new Map<string, ImporteAlicuota>();
  for (const l of lineas) {
    const clave = l.ivaPct.toString();
    const g = grupos.get(clave) ?? { pct: l.ivaPct, codigo: codigoAlicuota(l.ivaPct)!, base: CERO, importe: CERO };
    grupos.set(clave, { ...g, base: g.base.plus(l.subtotalNeto), importe: g.importe.plus(l.subtotalIva) });
  }
  const alicuotas = [...grupos.values()].sort((a, b) => a.pct.comparedTo(b.pct));
  for (const a of alicuotas) {
    const esperado = aMoneda(a.base.times(a.pct).div(100));
    if (a.importe.minus(esperado).abs().gt("0.01")) {
      advertencias.push(
        `IVA ${fmtPorcentaje(a.pct)}: la suma por línea da ${pesos(a.importe)} y base × alícuota da ${pesos(esperado)}. ` +
          "Se informa la suma por línea (la de la venta); si ARCA lo objeta, consultá al contador.",
      );
    }
  }
  return { ok: true, importes: { neto, iva, total, alicuotas, lineas, advertencias } };
}
