/**
 * Verificacion de las cuentas de compras y stock contra numeros conocidos.
 *
 *   npx tsx scripts/verificar-stock.ts
 */
import { diferenciaDeConteo, faltanteParaMinimo, subtotalCompra, totalizarCompra } from "../src/lib/stock";
import { d } from "../src/lib/money";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

console.log("--- Compra: 20 m2 de vinil a $4.200 + 6 m2 de transportador a $1.400 ---");
comprobar("subtotal vinil", subtotalCompra("20", "4200").toString(), "84000");
comprobar(
  "total",
  totalizarCompra([
    { cantidad: "20", costoUnitario: "4200" },
    { cantidad: "6", costoUnitario: "1400" },
  ]).toString(),
  "92400",
);

console.log("--- Redondeo: el total suma subtotales ya redondeados a centavos ---");
comprobar("0,333 x 10,005", subtotalCompra("0.333", "10.005").toString(), "3.33");
comprobar(
  "dos lineas de 0,005",
  totalizarCompra([
    { cantidad: "1", costoUnitario: "0.005" },
    { cantidad: "1", costoUnitario: "0.005" },
  ]).toString(),
  "0.02",
);

console.log("--- Faltante para el minimo ---");
comprobar("2,4 de minimo 3", faltanteParaMinimo(d("2.4"), d("3")).toString(), "0.6");
comprobar("sobre el minimo", faltanteParaMinimo(d("38"), d("10")).toString(), "0");
comprobar("sin minimo cargado", faltanteParaMinimo(d("0"), d("0")).toString(), "0");

console.log("--- Conteo fisico ---");
comprobar("sobran 2", diferenciaDeConteo(d("10"), d("12")).toString(), "2");
comprobar("faltan 1,5", diferenciaDeConteo(d("10"), d("8.5")).toString(), "-1.5");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
