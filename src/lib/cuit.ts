// CUIT / CUIL: 11 digitos, los dos primeros son el tipo, los ocho siguientes el
// numero y el ultimo un digito verificador (modulo 11 con pesos fijos).
//
// En la base se guarda normalizado: solo los 11 digitos, sin guiones ni
// espacios. Asi "30-71234567-1" y "30712345671" son el mismo CUIT para el
// indice unico. Para mostrarlo se vuelve a formatear con `formatearCuit`.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Prefijos que asigna ARCA: personas (20, 23, 24, 25, 26, 27), empresas
 * (30, 33, 34) y casos especiales (50, 51, 55).
 */
const PREFIJOS = new Set(["20", "23", "24", "25", "26", "27", "30", "33", "34", "50", "51", "55"]);

/**
 * Lo tipeado → 11 digitos, o null si no tiene forma de CUIT. Acepta guiones,
 * espacios, puntos y barras como separadores ("30-71234567-1", "30 71234567 1").
 * No valida el digito verificador: para eso, `validarCuit`.
 */
export function normalizarCuit(texto: string): string | null {
  const limpio = texto.trim();
  if (!/^[\d\s.\-/]+$/.test(limpio)) return null;
  const digitos = limpio.replace(/\D/g, "");
  return digitos.length === 11 ? digitos : null;
}

/**
 * Digito verificador de los primeros 10 digitos. Devuelve null cuando el
 * calculo da 10: ese numero no existe (ARCA cambia el prefijo a 23/33).
 */
export function digitoVerificadorCuit(primeros10: string): number | null {
  if (!/^\d{10}$/.test(primeros10)) throw new Error(`"${primeros10}" no son 10 dígitos`);
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(primeros10[i]) * PESOS[i]!;
  const resto = 11 - (suma % 11);
  if (resto === 11) return 0;
  if (resto === 10) return null;
  return resto;
}

export type ResultadoCuit = { ok: true; cuit: string } | { ok: false; error: string };

/** Valida forma, prefijo y digito verificador. Si esta bien, devuelve el CUIT normalizado. */
export function validarCuit(texto: string): ResultadoCuit {
  const cuit = normalizarCuit(texto);
  if (!cuit) return { ok: false, error: "El CUIT tiene que tener 11 dígitos (por ejemplo 30-71234567-1)." };
  if (!PREFIJOS.has(cuit.slice(0, 2))) {
    return { ok: false, error: `El CUIT no puede empezar con ${cuit.slice(0, 2)}.` };
  }
  const verificador = digitoVerificadorCuit(cuit.slice(0, 10));
  if (verificador === null || verificador !== Number(cuit[10])) {
    return { ok: false, error: "El CUIT no es válido: el dígito verificador no coincide. Revisá que esté bien tipeado." };
  }
  return { ok: true, cuit };
}

export function esCuitValido(texto: string): boolean {
  return validarCuit(texto).ok;
}

/** "30712345671" → "30-71234567-1". Si no tiene forma de CUIT, lo devuelve tal cual. */
export function formatearCuit(cuit: string | null | undefined): string {
  if (!cuit) return "";
  const n = normalizarCuit(cuit);
  return n ? `${n.slice(0, 2)}-${n.slice(2, 10)}-${n.slice(10)}` : cuit;
}
