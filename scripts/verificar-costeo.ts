/**
 * Verificacion del motor de costeo contra numeros conocidos.
 *
 * Usa el MISMO codigo que corre la pantalla de carga de venta (`lib/costing.ts`),
 * asi que si esto pasa, lo que el cliente ve en el mockup es correcto.
 *
 *   npx tsx scripts/verificar-costeo.ts
 */
import { calcularMargen, costearLineaVenta, estadoPago, precioParaMargen, totalizarVenta } from "../src/lib/costing";
import { aMoneda, d, fmtMoneda, fmtNumero } from "../src/lib/money";

// Mismos valores que trae el seed (prisma/seed.ts).
const STICKER = { nombre: "Sticker en vinil 10x15 cm", precio: d(3500), iva: d(21), costo: d(1492) };
const CARTEL = { nombre: "Cartel en MDF 40x60 cm", precio: d(28000), iva: d(21), costo: d(5840) };

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

console.log("--- Linea: 200 stickers ---");
const stickers = costearLineaVenta({
  cantidad: d(200),
  precioUnitario: STICKER.precio,
  ivaPct: STICKER.iva,
  costoUnitario: STICKER.costo,
});
console.log(`  total ${fmtMoneda(stickers.subtotalBruto)} | costo ${fmtMoneda(stickers.costoTotalSnapshot)} | ganancia ${fmtMoneda(stickers.ganancia)}`);
comprobar("total stickers", stickers.subtotalBruto.toString(), "700000");
comprobar("costo stickers", stickers.costoTotalSnapshot.toString(), "298400");
comprobar("ganancia stickers", stickers.ganancia.toString(), "401600");

console.log("");
console.log("--- Linea: 6 carteles ---");
const carteles = costearLineaVenta({
  cantidad: d(6),
  precioUnitario: CARTEL.precio,
  ivaPct: CARTEL.iva,
  costoUnitario: CARTEL.costo,
});
console.log(`  total ${fmtMoneda(carteles.subtotalBruto)} | costo ${fmtMoneda(carteles.costoTotalSnapshot)} | ganancia ${fmtMoneda(carteles.ganancia)}`);
comprobar("total carteles", carteles.subtotalBruto.toString(), "168000");
comprobar("costo carteles", carteles.costoTotalSnapshot.toString(), "35040");

console.log("");
console.log("--- Venta completa: 200 stickers + 6 carteles ---");
const totales = totalizarVenta([stickers, carteles]);
console.log(`  neto   ${fmtMoneda(totales.totalNeto)}`);
console.log(`  IVA    ${fmtMoneda(totales.totalIVA)}`);
console.log(`  total  ${fmtMoneda(totales.totalBruto)}`);
console.log(`  costo  ${fmtMoneda(totales.costoTotal)}`);
console.log(`  ganar  ${fmtMoneda(totales.ganancia)}  (${fmtNumero(totales.margenPct)}%)`);
comprobar("total venta", totales.totalBruto.toString(), "868000");
comprobar("costo venta", totales.costoTotal.toString(), "333440");
comprobar("ganancia venta", totales.ganancia.toString(), "534560");
comprobar("margen venta", totales.margenPct.toString(), "61.59");

console.log("");
console.log("--- Cobro parcial: paga 400.000 de 868.000 ---");
const pagado = d(400000);
console.log(`  estado: ${estadoPago(totales.totalBruto, pagado)}`);
comprobar("estado de pago", estadoPago(totales.totalBruto, pagado), "PARCIAL");
comprobar("saldo", aMoneda(totales.totalBruto.minus(pagado)).toString(), "468000");

console.log("");
console.log("--- Cobro total ---");
comprobar("estado de pago", estadoPago(totales.totalBruto, totales.totalBruto), "PAGADA");

console.log("");
console.log("--- IVA: el 21% se separa y NO cuenta como ganancia ---");
const m = calcularMargen({ precioBruto: d(868000), costo: d(333440), ivaPct: d(21) });
console.log(`  neto ${fmtMoneda(m.precioNeto)} | IVA ${fmtMoneda(m.iva)} | ganancia ${fmtMoneda(m.ganancia)} | markup ${fmtNumero(m.markupPct)}%`);
comprobar("neto sin IVA", m.precioNeto.toString(), "717355.37");
comprobar("IVA", m.iva.toString(), "150644.63");

console.log("");
console.log("--- Precio necesario para la meta de 45% de margen (costo 1492) ---");
console.log(`  ${fmtMoneda(precioParaMargen(d(1492), d(45)))}`);
comprobar("precio para meta 45%", precioParaMargen(d(1492), d(45)).toString(), "2712.73");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
