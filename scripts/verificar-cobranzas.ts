/**
 * Verificacion de la logica pura de cobranzas: saldo, estado de pago, monto
 * contra saldo, fecha del pago y antiguedad de la deuda. No usa base.
 *
 *   npx tsx scripts/verificar-cobranzas.ts
 */
import { d } from "../src/lib/money";
import {
  agruparPorAntiguedad,
  agruparPorCliente,
  diasDesde,
  estadoDePago,
  montoSugerido,
  pagadoDe,
  saldoDeVenta,
  tieneSaldo,
  tramoDe,
  validarFechaPago,
  validarMontoContraSaldo,
  type VentaConSaldo,
} from "../src/lib/cobranzas";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const f = (iso: string) => new Date(`${iso}T00:00:00Z`);
const anulado = new Date("2026-01-01T12:00:00Z");

console.log("--- Saldo y estado de pago ---");
const pagos = [
  { monto: d(300), anuladoEn: null },
  { monto: d(200), anuladoEn: anulado },
  { monto: d("150.50"), anuladoEn: null },
];
comprobar("pagado ignora anulados", pagadoDe(pagos).toFixed(2), "450.50");
comprobar("sin pagos", pagadoDe([]).toFixed(2), "0.00");
comprobar("saldo", saldoDeVenta(d(1000), d("450.50")).toFixed(2), "549.50");
comprobar("saldo nunca negativo", saldoDeVenta(d(100), d("100.01")).toFixed(2), "0.00");
comprobar("estado parcial", estadoDePago(d(1000), pagos), "PARCIAL");
comprobar("estado sin cobrar (solo anulados)", estadoDePago(d(1000), [{ monto: d(1000), anuladoEn: anulado }]), "PENDIENTE");
comprobar("estado pagada", estadoDePago(d(1000), [{ monto: d(1000), anuladoEn: null }]), "PAGADA");
comprobar("pagada con 1 centavo de diferencia", estadoDePago(d("1000.01"), [{ monto: d(1000), anuladoEn: null }]), "PAGADA");
comprobar("1 centavo no es deuda", String(tieneSaldo(d("0.01"))), "false");
comprobar("2 centavos es deuda", String(tieneSaldo(d("0.02"))), "true");

console.log("--- Monto contra saldo ---");
const ok = (v: string | null) => v ?? "ok";
comprobar("parcial", ok(validarMontoContraSaldo(d(100), d(500))), "ok");
comprobar("exacto", ok(validarMontoContraSaldo(d(500), d(500))), "ok");
comprobar("1 centavo de mas (tolerancia)", ok(validarMontoContraSaldo(d("500.01"), d(500))), "ok");
comprobar("2 centavos de mas", String(validarMontoContraSaldo(d("500.02"), d(500))?.includes("supera el saldo")), "true");
comprobar("cero", String(validarMontoContraSaldo(d(0), d(500))?.includes("mayor a 0")), "true");
comprobar("negativo", String(validarMontoContraSaldo(d(-5), d(500))?.includes("mayor a 0")), "true");
comprobar("tres decimales", String(validarMontoContraSaldo(d("10.005"), d(500))?.includes("2 decimales")), "true");
comprobar("venta saldada", String(validarMontoContraSaldo(d(1), d(0))?.includes("ya está saldada")), "true");
comprobar("saldo de 1 centavo cuenta como saldada", String(validarMontoContraSaldo(d("0.01"), d("0.01"))?.includes("saldada")), "true");

console.log("--- Fecha del pago ---");
comprobar("hoy", ok(validarFechaPago("2026-03-15", "2026-03-15")), "ok");
comprobar("pasado", ok(validarFechaPago("2025-12-31", "2026-03-15")), "ok");
comprobar("futuro", String(validarFechaPago("2026-03-16", "2026-03-15")?.includes("posterior a hoy")), "true");
comprobar("invalida", ok(validarFechaPago("2026-13-40", "2026-03-15")), "Fecha inválida");
comprobar("formato", ok(validarFechaPago("15/03/2026", "2026-03-15")), "Fecha inválida");

console.log("--- Antiguedad ---");
comprobar("dias", String(diasDesde(f("2026-01-01"), f("2026-03-01"))), "59");
comprobar("misma fecha", String(diasDesde(f("2026-03-01"), f("2026-03-01"))), "0");
comprobar("fecha futura no es negativa", String(diasDesde(f("2026-03-02"), f("2026-03-01"))), "0");
comprobar("tramo 0", tramoDe(0), "HASTA_30");
comprobar("tramo 30", tramoDe(30), "HASTA_30");
comprobar("tramo 31", tramoDe(31), "HASTA_60");
comprobar("tramo 90", tramoDe(90), "HASTA_90");
comprobar("tramo 91", tramoDe(91), "MAS_90");

console.log("--- Agrupaciones ---");
const hoy = f("2026-06-30");
function venta(id: string, cliente: string, fecha: string, saldo: string): VentaConSaldo {
  return {
    id,
    numero: Number(id),
    anio: 2026,
    fecha: f(fecha),
    estado: "ENTREGADA",
    clienteId: cliente,
    clienteNombre: `Cliente ${cliente}`,
    clienteTelefono: null,
    totalBruto: d(saldo),
    pagado: d(0),
    saldo: d(saldo),
    estadoPago: "PENDIENTE",
    dias: diasDesde(f(fecha), hoy),
  };
}
const ventas = [
  venta("1", "A", "2026-06-20", "100"),
  venta("2", "B", "2026-01-10", "50"),
  venta("3", "A", "2026-04-15", "300"),
  venta("4", "C", "2026-05-20", "400"),
];
const porCliente = agruparPorCliente(ventas);
comprobar("clientes, el que mas debe primero", porCliente.map((c) => `${c.clienteId}:${c.saldo.toFixed(0)}`).join(" "), "A:400 C:400 B:50");
const a = porCliente.find((c) => c.clienteId === "A")!;
comprobar("A: ventas, la mas vieja primero", a.ventas.map((v) => v.id).join(","), "3,1");
comprobar("A: desde", a.desde.toISOString().slice(0, 10), "2026-04-15");
comprobar("A: dias de la mas vieja", String(a.diasMax), "76");
const tramos = agruparPorAntiguedad(ventas);
comprobar("cuatro tramos", String(tramos.length), "4");
comprobar(
  "saldo por tramo",
  tramos.map((t) => t.saldo.toFixed(0)).join(","),
  "100,400,300,50",
);
comprobar("mas de 90", tramos[3]!.ventas.map((v) => v.id).join(","), "2");
comprobar("dentro del tramo, la mas vieja primero", agruparPorAntiguedad([venta("5", "A", "2026-06-29", "1"), venta("6", "B", "2026-06-10", "1")])[0]!.ventas.map((v) => v.id).join(","), "6,5");
comprobar("suma de tramos = suma por cliente", tramos.reduce((s, t) => s.plus(t.saldo), d(0)).toFixed(2), porCliente.reduce((s, c) => s.plus(c.saldo), d(0)).toFixed(2));

console.log("--- Monto sugerido ---");
comprobar("con coma", montoSugerido(d("1234.5")), "1234,50");
comprobar("redondeado", montoSugerido(d("10.005")), "10,01");

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
