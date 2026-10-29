import { fmtMoneda, type Dinero } from "@/lib/money";
import { diasDesde, tieneSaldo } from "@/lib/cobranzas";

// Logica pura de los recordatorios de cobranza ("a quien llamar hoy"): sin base
// ni Next. La usan la consulta (`src/lib/queries/recordatorios.ts`), la accion
// de `/cobranzas/hoy` y `scripts/verificar-recordatorios.ts`.
//
// Lo que NO hace: calcular el saldo ni la antiguedad de la deuda. Eso sale de
// `src/lib/cobranzas.ts` (ventas y pagos no anulados); aca solo se decide a
// quien conviene llamar y en que orden.

// ─── Tramos de antiguedad ────────────────────────────────────────────────────
// Antiguedad = dias desde la venta impaga mas vieja del cliente hasta hoy (en
// Argentina). Son tramos propios de los recordatorios, mas finos que los de
// `/cobranzas` (30/60/90), porque aca importa distinguir la deuda de esta
// semana de la de este mes.

export const TRAMOS_RECORDATORIO = [
  { clave: "HASTA_7", etiqueta: "0 a 7 días", hasta: 7 },
  { clave: "HASTA_30", etiqueta: "8 a 30 días", hasta: 30 },
  { clave: "HASTA_60", etiqueta: "31 a 60 días", hasta: 60 },
  { clave: "MAS_60", etiqueta: "Más de 60 días", hasta: Number.POSITIVE_INFINITY },
] as const;

export type TramoRecordatorio = (typeof TRAMOS_RECORDATORIO)[number]["clave"];

/**
 * Orden de atencion de los tramos: lo mas antiguo primero. Una deuda de mas de
 * 60 dias es la que mas riesgo tiene de no cobrarse, asi que se llama antes que
 * la de esta semana aunque sea mas chica. Dentro de cada tramo manda el monto.
 */
export const ORDEN_TRAMOS: readonly TramoRecordatorio[] = ["MAS_60", "HASTA_60", "HASTA_30", "HASTA_7"];

/** Tramo de una antiguedad en dias: 7 es "0 a 7", 8 es "8 a 30", 30/31, 60/61 igual. */
export function tramoRecordatorio(dias: number): TramoRecordatorio {
  return TRAMOS_RECORDATORIO.find((t) => dias <= t.hasta)!.clave;
}

export function etiquetaTramo(tramo: TramoRecordatorio): string {
  return TRAMOS_RECORDATORIO.find((t) => t.clave === tramo)!.etiqueta;
}

// ─── A quien llamar hoy ──────────────────────────────────────────────────────

/** Un contacto ya registrado con un cliente. Las fechas son `@db.Date` (medianoche UTC). */
export type ContactoRegistrado = {
  fecha: Date;
  nota: string;
  proximoContacto: Date | null;
  /** Desempata dos contactos del mismo dia: el ultimo que se cargo manda. */
  creadoEn: Date;
};

/** Cliente con deuda, tal como sale de ventas y pagos, mas su historial de contactos. */
export type Deudor = {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  /** Suma de los saldos de sus ventas impagas (ya calculada desde ventas y pagos). */
  saldo: Dinero;
  /** Fecha de la venta impaga mas antigua. */
  desde: Date;
  contactos: ContactoRegistrado[];
};

export type Recordatorio = {
  clienteId: string;
  nombre: string;
  telefono: string | null;
  saldo: Dinero;
  /** Dias desde la venta impaga mas antigua. */
  dias: number;
  tramo: TramoRecordatorio;
  /** El contacto mas reciente (cualquier fecha), para recordar de que se habló. */
  ultimoContacto: ContactoRegistrado | null;
};

/** El contacto mas reciente: por fecha y, a igual fecha, el ultimo cargado. */
export function ultimoContactoDe(contactos: ContactoRegistrado[]): ContactoRegistrado | null {
  let ultimo: ContactoRegistrado | null = null;
  for (const c of contactos) {
    if (
      !ultimo ||
      c.fecha.getTime() > ultimo.fecha.getTime() ||
      (c.fecha.getTime() === ultimo.fecha.getTime() && c.creadoEn.getTime() > ultimo.creadoEn.getTime())
    ) {
      ultimo = c;
    }
  }
  return ultimo;
}

/**
 * Hay que llamarlo hoy si:
 *  1. tiene saldo (mas de 1 centavo, como el resto de cobranzas);
 *  2. no tiene una promesa futura: el proximo contacto del ULTIMO contacto no
 *     es posterior a hoy (si es hoy o ya paso, toca llamar; si no hay, toca).
 *     Manda el ultimo contacto: asi un contacto nuevo sin fecha cancela una
 *     promesa anterior;
 *  3. no se lo contacto hoy (cualquier contacto con fecha de hoy lo saca de la
 *     lista, aunque no haya prometido nada).
 */
export function hayQueLlamarHoy(deudor: Deudor, hoy: Date): boolean {
  if (!tieneSaldo(deudor.saldo)) return false;
  if (deudor.contactos.some((c) => c.fecha.getTime() === hoy.getTime())) return false;
  const promesa = ultimoContactoDe(deudor.contactos)?.proximoContacto ?? null;
  if (promesa && promesa.getTime() > hoy.getTime()) return false;
  return true;
}

/**
 * Orden de la lista: tramo de antiguedad (el mas viejo primero, ver
 * `ORDEN_TRAMOS`), luego monto de mayor a menor y, por ultimo, nombre, para que
 * dos deudores iguales salgan siempre en el mismo orden.
 */
export function compararRecordatorios(a: Recordatorio, b: Recordatorio): number {
  return (
    ORDEN_TRAMOS.indexOf(a.tramo) - ORDEN_TRAMOS.indexOf(b.tramo) ||
    b.saldo.cmp(a.saldo) ||
    a.nombre.localeCompare(b.nombre, "es")
  );
}

/** La lista de "a quien llamar hoy", ya filtrada y ordenada. `hoy` es la fecha de Argentina. */
export function recordatoriosDeHoy(deudores: Deudor[], hoy: Date): Recordatorio[] {
  return deudores
    .filter((x) => hayQueLlamarHoy(x, hoy))
    .map((x) => {
      const dias = diasDesde(x.desde, hoy);
      return {
        clienteId: x.clienteId,
        nombre: x.nombre,
        telefono: x.telefono,
        saldo: x.saldo,
        dias,
        tramo: tramoRecordatorio(dias),
        ultimoContacto: ultimoContactoDe(x.contactos),
      };
    })
    .sort(compararRecordatorios);
}

/**
 * El proximo contacto prometido no puede estar en el pasado (se compara con
 * hoy en Argentina, ambos "AAAA-MM-DD"). Hoy mismo si se acepta.
 */
export function validarProximoContacto(proximoISO: string, hoyISO: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proximoISO) || Number.isNaN(Date.parse(`${proximoISO}T00:00:00Z`))) {
    return "Fecha inválida";
  }
  if (proximoISO < hoyISO) return "El próximo contacto no puede ser una fecha pasada.";
  return null;
}

// ─── Telefonos argentinos y WhatsApp ─────────────────────────────────────────

export type TelefonoNormalizado =
  | {
      valido: true;
      /** Con codigo de pais y el 9 de celular, solo digitos: "5493514556677". */
      numero: string;
    }
  | { valido: false; motivo: string };

const invalido = (motivo: string): TelefonoNormalizado => ({ valido: false, motivo });

/** Largo de caracteristica + abonado en Argentina: siempre 10 digitos (ej. 351 + 4556677). */
const LARGO_NACIONAL = 10;

/**
 * Lleva un telefono tipeado a mano al formato de WhatsApp para Argentina
 * (`549` + caracteristica + abonado, 13 digitos). Entiende espacios, guiones,
 * puntos, parentesis, "+54" o "0054", el 0 inicial de la caracteristica, el 15
 * de celular y el 9. Ejemplos que dan `5493514556677`:
 *
 *   351 455-6677 · (0351) 455 6677 · 0351 15 455-6677 · +54 9 351 455-6677
 *   54 351 15 4556677 · 0054 9 351 4556677 · 9 351 4556677
 *
 * Ante la duda NO inventa nada y devuelve `valido: false` con el motivo:
 * vacio, caracteres raros (letras, "/", "int."), sin caracteristica (7 u 8
 * digitos), largo incorrecto, "+" que no esta al principio, otro pais o una
 * caracteristica imposible (las de Argentina empiezan con 11, 2 o 3).
 */
export function normalizarTelefono(texto: string | null | undefined): TelefonoNormalizado {
  const crudo = (texto ?? "").trim();
  if (!crudo) return invalido("Falta el teléfono.");
  if (!/^[\d\s\-().+]+$/.test(crudo)) return invalido("El teléfono tiene caracteres que no son de un número.");
  if (crudo.lastIndexOf("+") > 0 || (crudo.match(/\+/g) ?? []).length > 1) return invalido("El + solo va al principio.");

  const conMas = crudo.startsWith("+");
  let digitos = crudo.replace(/\D/g, "");
  if (digitos.length < 8) return invalido("El número es demasiado corto: falta la característica.");
  if (digitos.length > 15) return invalido("El número es demasiado largo.");

  // Codigo de pais: "+54…", "0054…" o "54…" a secas (ninguna caracteristica argentina empieza con 54).
  if (!conMas && digitos.startsWith("00")) {
    digitos = digitos.slice(2);
    if (!digitos.startsWith("54")) return invalido("Solo se aceptan teléfonos de Argentina.");
  }
  if (conMas && !digitos.startsWith("54")) return invalido("Solo se aceptan teléfonos de Argentina.");
  if (digitos.startsWith("54")) {
    digitos = digitos.slice(2);
  }

  // 0 de la caracteristica ("0351…") y 9 de celular (ningun codigo de area empieza con 9).
  if (digitos.startsWith("0")) digitos = digitos.slice(1);
  if (digitos.startsWith("9")) digitos = digitos.slice(1);
  if (digitos.startsWith("0") || digitos.startsWith("9")) return invalido("El número no tiene un formato argentino.");

  // 15 de celular entre la caracteristica y el abonado: caracteristica(2-4) + 15 + abonado = 10 + 2 digitos.
  if (digitos.length === LARGO_NACIONAL + 2) {
    const posiciones = digitos.startsWith("11") ? [2] : [3, 4];
    const pos = posiciones.find((p) => digitos.slice(p, p + 2) === "15");
    if (pos === undefined) return invalido("El número no tiene un formato argentino.");
    digitos = digitos.slice(0, pos) + digitos.slice(pos + 2);
  }

  if (digitos.length !== LARGO_NACIONAL) {
    return invalido(
      digitos.length < LARGO_NACIONAL
        ? "Faltan dígitos: tiene que llevar la característica (ej. 351) y el número."
        : "Sobran dígitos para un teléfono argentino.",
    );
  }
  // Caracteristicas argentinas: 11 (Buenos Aires), 2xx y 3xx.
  const primero = digitos[0];
  if (!(digitos.startsWith("11") || primero === "2" || primero === "3")) {
    return invalido("La característica no es de Argentina.");
  }
  return { valido: true, numero: `549${digitos}` };
}

export type EnlaceWhatsApp =
  | { valido: true; numero: string; url: string }
  | { valido: false; motivo: string };

/** Enlace `https://wa.me/549…` con el mensaje precargado, o `valido: false` si el telefono es dudoso. */
export function enlaceWhatsApp(telefono: string | null | undefined, mensaje: string): EnlaceWhatsApp {
  const t = normalizarTelefono(telefono);
  if (!t.valido) return t;
  return { valido: true, numero: t.numero, url: `https://wa.me/${t.numero}?text=${encodeURIComponent(mensaje)}` };
}

/**
 * Mensaje precargado: saludo, nombre y saldo. Nada mas del negocio (ni numero
 * de venta, ni detalle, ni datos de pago): lo que haga falta lo escribe quien manda.
 */
export function mensajeWhatsApp(nombre: string, saldo: Dinero): string {
  return `Hola ${nombre.trim()}, ¿cómo estás? Te escribo por un saldo pendiente de ${fmtMoneda(saldo)}. ¡Gracias!`;
}
