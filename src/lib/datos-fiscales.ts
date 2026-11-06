import { validarCuit } from "@/lib/cuit";
import { d, type Dinero } from "@/lib/money";
import { hoyArgentinaISO } from "@/lib/acciones";

// Datos fiscales del negocio (el EMISOR de los comprobantes). Logica pura: sin
// Prisma ni Next. La usan la emision (src/lib/dominio/comprobantes.ts), la
// pantalla de configuracion fiscal (5.1b) y `scripts/verificar-datos-fiscales.ts`.
//
// Se guardan como claves de `Configuracion` (texto), igual que el resto de la
// configuracion: sin migracion, con upsert la primera vez. Se guardan ya
// normalizados (`validarDatosFiscales` devuelve los valores a guardar).

export const CLAVES_FISCALES = {
  razonSocial: "fiscalRazonSocial",
  cuit: "fiscalCuit",
  condicionIva: "fiscalCondicionIva",
  domicilio: "fiscalDomicilio",
  inicioActividades: "fiscalInicioActividades",
  iibb: "fiscalIibb",
  puntoVenta: "fiscalPuntoVenta",
  /** Opcional: si no esta, vale `UMBRAL_IDENTIFICACION_POR_DEFECTO`. */
  umbralIdentificacion: "fiscalUmbralIdentificacion",
} as const;

export type CampoFiscal = keyof typeof CLAVES_FISCALES;

export const ETIQUETAS_FISCALES: Record<CampoFiscal, string> = {
  razonSocial: "Razón social",
  cuit: "CUIT",
  condicionIva: "Condición frente al IVA",
  domicilio: "Domicilio fiscal",
  inicioActividades: "Fecha de inicio de actividades",
  iibb: "Número de ingresos brutos",
  puntoVenta: "Punto de venta",
  umbralIdentificacion: "Monto desde el que se identifica al consumidor final",
};

/** Condiciones posibles del EMISOR. Exento no factura con este sistema. */
export const CONDICIONES_IVA_EMISOR = ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO"] as const;
export type CondicionIvaEmisor = (typeof CONDICIONES_IVA_EMISOR)[number];
export const CONDICION_IVA_EMISOR_POR_DEFECTO: CondicionIvaEmisor = "RESPONSABLE_INSCRIPTO";

export const ETIQUETA_CONDICION_IVA: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable inscripto",
  MONOTRIBUTO: "Monotributo",
  CONSUMIDOR_FINAL: "Consumidor final",
  EXENTO: "IVA exento",
};

/**
 * Monto (total del comprobante, IVA incluido) a partir del cual ARCA exige
 * identificar al consumidor final con CUIT o DNI. Cambia con el tiempo por
 * resolucion general: VERIFICAR CON EL CONTADOR antes de facturar en serio.
 * Valor de referencia: $ 10.000.000 (RG 5700/2025, a confirmar). Se puede pisar sin tocar
 * codigo con la clave `fiscalUmbralIdentificacion` de `Configuracion`.
 */
export const UMBRAL_IDENTIFICACION_POR_DEFECTO = "10000000";

export const PUNTO_VENTA_MAXIMO = 99999;
const LARGO_MAXIMO_TEXTO = 200;
const LARGO_MAXIMO_IIBB = 30;
/** Antes de esto no hay inicio de actividades creible: casi seguro un error de tipeo. */
const INICIO_ACTIVIDADES_MINIMO = "1900-01-01";

export type DatosFiscales = {
  razonSocial: string;
  /** 11 digitos, sin guiones. */
  cuit: string;
  condicionIva: CondicionIvaEmisor;
  domicilio: string;
  /** Fecha a medianoche UTC (como un `@db.Date`). */
  inicioActividades: Date;
  iibb: string | null;
  puntoVenta: number;
  /** Ver `UMBRAL_IDENTIFICACION_POR_DEFECTO`. */
  umbralIdentificacion: Dinero;
};

type Validacion<T> = { ok: true; valor: T } | { ok: false; error: string };

const bien = <T>(valor: T): Validacion<T> => ({ ok: true, valor });
const mal = <T>(error: string): Validacion<T> => ({ ok: false, error });
const limpio = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");

// ─── Validacion de cada campo ─────────────────────────────────────────────────
// Cada uno recibe lo tipeado (o lo guardado) y devuelve el valor normalizado o
// un mensaje para mostrar al lado del campo.

export function validarRazonSocial(texto: string | null | undefined): Validacion<string> {
  const v = limpio(texto);
  if (!v) return mal("Falta la razón social.");
  if (v.length > LARGO_MAXIMO_TEXTO) return mal(`La razón social admite hasta ${LARGO_MAXIMO_TEXTO} caracteres.`);
  return bien(v);
}

export function validarCuitEmisor(texto: string | null | undefined): Validacion<string> {
  const v = limpio(texto);
  if (!v) return mal("Falta el CUIT del negocio.");
  const r = validarCuit(v);
  return r.ok ? bien(r.cuit) : mal(r.error);
}

/** Vacio = valor por defecto (responsable inscripto). Otro valor desconocido: error. */
export function validarCondicionIvaEmisor(texto: string | null | undefined): Validacion<CondicionIvaEmisor> {
  const v = limpio(texto).toUpperCase();
  if (!v) return bien(CONDICION_IVA_EMISOR_POR_DEFECTO);
  return (CONDICIONES_IVA_EMISOR as readonly string[]).includes(v)
    ? bien(v as CondicionIvaEmisor)
    : mal("La condición frente al IVA tiene que ser responsable inscripto o monotributo.");
}

export function validarDomicilio(texto: string | null | undefined): Validacion<string> {
  const v = limpio(texto);
  if (!v) return mal("Falta el domicilio fiscal.");
  if (v.length > LARGO_MAXIMO_TEXTO) return mal(`El domicilio admite hasta ${LARGO_MAXIMO_TEXTO} caracteres.`);
  return bien(v);
}

/**
 * Acepta "2020-03-15" (lo que manda un `<input type="date">`) y "15/03/2020".
 * Devuelve el ISO. No puede ser una fecha inexistente (31/02), ni futura (contra
 * hoy en Argentina), ni anterior a 1900.
 */
export function validarInicioActividades(texto: string | null | undefined, hoy: Date = new Date()): Validacion<string> {
  const v = limpio(texto);
  if (!v) return mal("Falta la fecha de inicio de actividades.");
  let iso: string | null = null;
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m1) iso = `${m1[1]}-${m1[2]}-${m1[3]}`;
  else if (m2) iso = `${m2[3]}-${m2[2]!.padStart(2, "0")}-${m2[1]!.padStart(2, "0")}`;
  if (!iso) return mal("La fecha de inicio de actividades no es válida (usá dd/mm/aaaa).");
  const fecha = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== iso) {
    return mal("La fecha de inicio de actividades no existe.");
  }
  if (iso < INICIO_ACTIVIDADES_MINIMO) return mal("La fecha de inicio de actividades es demasiado antigua.");
  if (iso > hoyArgentinaISO(hoy)) return mal("La fecha de inicio de actividades no puede ser futura.");
  return bien(iso);
}

/**
 * Opcional. El formato depende de la provincia (o es el CUIT en convenio
 * multilateral), asi que solo se limita el largo y los caracteres.
 */
export function validarIibb(texto: string | null | undefined): Validacion<string | null> {
  const v = limpio(texto);
  if (!v) return bien(null);
  if (v.length > LARGO_MAXIMO_IIBB) return mal(`Ingresos brutos admite hasta ${LARGO_MAXIMO_IIBB} caracteres.`);
  if (!/^[0-9A-Za-zÁÉÍÓÚáéíóúÑñ .\-/]+$/.test(v)) return mal("Ingresos brutos tiene caracteres no válidos.");
  return bien(v);
}

/** Entero de 1 a 99999 ("0001" vale 1). Ni decimales ni signos. */
export function validarPuntoVenta(texto: string | null | undefined): Validacion<number> {
  const v = limpio(texto);
  if (!v) return mal("Falta el punto de venta.");
  if (!/^\d{1,5}$/.test(v)) return mal(`El punto de venta es un número entero de 1 a ${PUNTO_VENTA_MAXIMO}.`);
  const n = Number(v);
  if (n < 1 || n > PUNTO_VENTA_MAXIMO) return mal(`El punto de venta es un número entero de 1 a ${PUNTO_VENTA_MAXIMO}.`);
  return bien(n);
}

/** Opcional: vacio = el valor por defecto. Pesos, 0 o mas, hasta 2 decimales. */
export function validarUmbralIdentificacion(texto: string | null | undefined): Validacion<Dinero> {
  const v = limpio(texto).replace(",", ".");
  if (!v) return bien(d(UMBRAL_IDENTIFICACION_POR_DEFECTO));
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return mal("El monto de identificación tiene que ser un importe en pesos (hasta 2 decimales).");
  return bien(d(v));
}

// ─── Todos juntos ─────────────────────────────────────────────────────────────

export type EntradaFiscal = Partial<Record<CampoFiscal, string | null | undefined>>;

export type ResultadoDatosFiscales =
  | {
      ok: true;
      datos: DatosFiscales;
      /** Clave de `Configuracion` → valor normalizado a guardar ("" = borrar la clave opcional). */
      valores: Record<string, string>;
    }
  | { ok: false; errores: Partial<Record<CampoFiscal, string>> };

/**
 * Valida y normaliza todos los datos fiscales. Para el formulario (5.1b): da un
 * error por campo. Para emitir: `datosFiscalesDesdeConfiguracion`.
 */
export function validarDatosFiscales(entrada: EntradaFiscal, hoy: Date = new Date()): ResultadoDatosFiscales {
  const razonSocial = validarRazonSocial(entrada.razonSocial);
  const cuit = validarCuitEmisor(entrada.cuit);
  const condicionIva = validarCondicionIvaEmisor(entrada.condicionIva);
  const domicilio = validarDomicilio(entrada.domicilio);
  const inicioActividades = validarInicioActividades(entrada.inicioActividades, hoy);
  const iibb = validarIibb(entrada.iibb);
  const puntoVenta = validarPuntoVenta(entrada.puntoVenta);
  const umbral = validarUmbralIdentificacion(entrada.umbralIdentificacion);

  const errores: Partial<Record<CampoFiscal, string>> = {};
  const campos = { razonSocial, cuit, condicionIva, domicilio, inicioActividades, iibb, puntoVenta, umbralIdentificacion: umbral };
  for (const [campo, r] of Object.entries(campos) as [CampoFiscal, Validacion<unknown>][]) {
    if (!r.ok) errores[campo] = r.error;
  }
  if (
    !razonSocial.ok || !cuit.ok || !condicionIva.ok || !domicilio.ok ||
    !inicioActividades.ok || !iibb.ok || !puntoVenta.ok || !umbral.ok
  ) {
    return { ok: false, errores };
  }

  const datos: DatosFiscales = {
    razonSocial: razonSocial.valor,
    cuit: cuit.valor,
    condicionIva: condicionIva.valor,
    domicilio: domicilio.valor,
    inicioActividades: new Date(`${inicioActividades.valor}T00:00:00Z`),
    iibb: iibb.valor,
    puntoVenta: puntoVenta.valor,
    umbralIdentificacion: umbral.valor,
  };
  const umbralTipeado = limpio(entrada.umbralIdentificacion) !== "";
  return {
    ok: true,
    datos,
    valores: {
      [CLAVES_FISCALES.razonSocial]: datos.razonSocial,
      [CLAVES_FISCALES.cuit]: datos.cuit,
      [CLAVES_FISCALES.condicionIva]: datos.condicionIva,
      [CLAVES_FISCALES.domicilio]: datos.domicilio,
      [CLAVES_FISCALES.inicioActividades]: inicioActividades.valor,
      [CLAVES_FISCALES.iibb]: datos.iibb ?? "",
      [CLAVES_FISCALES.puntoVenta]: String(datos.puntoVenta),
      [CLAVES_FISCALES.umbralIdentificacion]: umbralTipeado ? datos.umbralIdentificacion.toString() : "",
    },
  };
}

/** Las claves de `Configuracion` (como las devuelve la base) → la entrada de `validarDatosFiscales`. */
export function entradaDesdeConfiguracion(config: Readonly<Record<string, string | undefined>>): EntradaFiscal {
  const entrada: EntradaFiscal = {};
  for (const [campo, clave] of Object.entries(CLAVES_FISCALES) as [CampoFiscal, string][]) {
    entrada[campo] = config[clave];
  }
  return entrada;
}

/** Lee los datos fiscales guardados. Si falta algo o algo es invalido, devuelve los errores. */
export function datosFiscalesDesdeConfiguracion(
  config: Readonly<Record<string, string | undefined>>,
  hoy: Date = new Date(),
): ResultadoDatosFiscales {
  return validarDatosFiscales(entradaDesdeConfiguracion(config), hoy);
}

/**
 * Que falta (o esta mal) para poder emitir, en el orden del formulario. Vacio =
 * se puede emitir. Cada linea se puede mostrar tal cual.
 */
export function faltantesParaEmitir(
  config: Readonly<Record<string, string | undefined>>,
  hoy: Date = new Date(),
): string[] {
  const r = datosFiscalesDesdeConfiguracion(config, hoy);
  if (r.ok) return [];
  return (Object.keys(CLAVES_FISCALES) as CampoFiscal[]).flatMap((campo) => (r.errores[campo] ? [r.errores[campo]!] : []));
}

/** Mensaje unico para el usuario cuando no se puede emitir por los datos fiscales. */
export function mensajeFaltantes(faltantes: readonly string[]): string {
  if (faltantes.length === 0) return "";
  return `No se puede facturar todavía: completá los datos fiscales del negocio en Configuración. ${faltantes.join(" ")}`;
}
