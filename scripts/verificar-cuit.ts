/**
 * Verificacion de la validacion de CUIT contra numeros conocidos.
 *
 *   npx tsx scripts/verificar-cuit.ts
 */
import { digitoVerificadorCuit, esCuitValido, formatearCuit, normalizarCuit, validarCuit } from "../src/lib/cuit";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

console.log("--- Normalizacion ---");
comprobar("con guiones", String(normalizarCuit("30-71234567-1")), "30712345671");
comprobar("con espacios alrededor", String(normalizarCuit("  30 71234567 1 ")), "30712345671");
comprobar("con puntos", String(normalizarCuit("30.71234567.1")), "30712345671");
comprobar("solo digitos", String(normalizarCuit("30712345671")), "30712345671");
comprobar("10 digitos", String(normalizarCuit("3071234567")), "null");
comprobar("12 digitos", String(normalizarCuit("307123456711")), "null");
comprobar("con letras", String(normalizarCuit("30-7123456A-1")), "null");
comprobar("vacio", String(normalizarCuit("")), "null");

console.log("--- Digito verificador ---");
// ARCA (ex AFIP): 33-69345023-9.
comprobar("ARCA 33-69345023", String(digitoVerificadorCuit("3369345023")), "9");
comprobar("20-12345678", String(digitoVerificadorCuit("2012345678")), "6");
comprobar("30-71234567", String(digitoVerificadorCuit("3071234567")), "1");
comprobar("resto 11 → 0", String(digitoVerificadorCuit("2000000006")), "0");
comprobar("resto 10 → no existe", String(digitoVerificadorCuit("2000000001")), "null");

console.log("--- Validacion completa ---");
comprobar("ARCA valido", String(esCuitValido("33-69345023-9")), "true");
comprobar("persona valida", String(esCuitValido("20-12345678-6")), "true");
comprobar("verificador 0", String(esCuitValido("20-00000006-0")), "true");
comprobar("verificador equivocado", String(esCuitValido("20-12345678-7")), "false");
comprobar("los del seed viejo no validan", String(esCuitValido("30712345678")), "false");
comprobar("resto 10 nunca valida", String(esCuitValido("20-00000001-0")), "false");
comprobar("prefijo inexistente", String(esCuitValido("12-12345678-6")), "false");
comprobar("prefijo inexistente: mensaje", validarCuit("12-12345678-6").ok ? "ok" : "rechazado", "rechazado");
const r = validarCuit(" 30-71234567-1 ");
comprobar("devuelve normalizado", r.ok ? r.cuit : r.error, "30712345671");
const corto = validarCuit("123");
comprobar("corto: mensaje", corto.ok ? "ok" : String(corto.error.includes("11 dígitos")), "true");

console.log("--- Formato para mostrar ---");
comprobar("formatea", formatearCuit("30712345671"), "30-71234567-1");
comprobar("ya formateado", formatearCuit("30-71234567-1"), "30-71234567-1");
comprobar("null", formatearCuit(null), "");
comprobar("basura queda igual", formatearCuit("abc"), "abc");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
