/**
 * Verificacion de la logica pura de presupuestos: vencimiento y sus bordes de
 * fecha (incluido el cambio de dia en Argentina), totales con el motor de la
 * venta, consolidacion de lineas, que precio le toca a cada linea al editar,
 * cantidades y mensaje de WhatsApp. No usa base.
 *
 *   npm run test:presupuestos
 */
import { d, fmtFecha, fmtMoneda } from "../src/lib/money";
import { hoyArgentina } from "../src/lib/acciones";
import { costearLineaVenta, totalizarVenta } from "../src/lib/costing";
import { enlaceWhatsApp } from "../src/lib/recordatorios-cobranza";
import {
  consolidarLineas,
  decidirPrecio,
  diasRestantes,
  estadoCalculado,
  estaVencido,
  mensajeWhatsAppPresupuesto,
  motivoNoAbierto,
  numeroPresupuesto,
  problemaDeCantidad,
  subtotalLinea,
  textoPlazo,
  totalizarPresupuesto,
  validoHasta,
  type LineaPrevia,
} from "../src/lib/presupuestos";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const f = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (fecha: Date) => fecha.toISOString().slice(0, 10);

console.log("--- Vencimiento: bordes de fecha ---");
{
  const fecha = f("2026-10-01");
  comprobar("válido hasta = fecha + validez (15 días)", iso(validoHasta(fecha, 15)), "2026-10-16");
  comprobar("el día anterior al último: no vencido", String(estaVencido(fecha, 15, f("2026-10-15"))), "false");
  comprobar("el último día todavía vale", String(estaVencido(fecha, 15, f("2026-10-16"))), "false");
  comprobar("el día siguiente: vencido", String(estaVencido(fecha, 15, f("2026-10-17"))), "true");
  comprobar("el mismo día de emisión: no vencido", String(estaVencido(fecha, 15, fecha)), "false");
  comprobar("validez de 1 día: vale hoy y mañana", String(estaVencido(fecha, 1, f("2026-10-02"))), "false");
  comprobar("validez de 1 día: pasado mañana vencido", String(estaVencido(fecha, 1, f("2026-10-03"))), "true");
  comprobar("cruza fin de mes", iso(validoHasta(f("2026-10-25"), 15)), "2026-11-09");
  comprobar("cruza fin de año", iso(validoHasta(f("2026-12-20"), 15)), "2027-01-04");
  comprobar("año bisiesto (29/02)", iso(validoHasta(f("2028-02-20"), 9)), "2028-02-29");
  comprobar("año bisiesto: cruza a marzo", iso(validoHasta(f("2028-02-20"), 10)), "2028-03-01");
  comprobar("año no bisiesto: 28/02 + 1", iso(validoHasta(f("2027-02-28"), 1)), "2027-03-01");
}

console.log("--- Vencimiento: 'hoy' es el día calendario de Argentina ---");
{
  const fecha = f("2026-10-01"); // último día válido: 16/10
  // 16/10 23:59:59 en Argentina (UTC-3) = 17/10 02:59:59Z: todavía es el último día.
  const finDelUltimoDia = hoyArgentina(new Date("2026-10-17T02:59:59Z"));
  comprobar("23:59:59 AR del último día: hoy", iso(finDelUltimoDia), "2026-10-16");
  comprobar("...y no está vencido", String(estaVencido(fecha, 15, finDelUltimoDia)), "false");
  // 17/10 00:00:00 AR = 17/10 03:00:00Z: ya cambió el día.
  const inicioDelSiguiente = hoyArgentina(new Date("2026-10-17T03:00:00Z"));
  comprobar("00:00:00 AR del día siguiente: hoy", iso(inicioDelSiguiente), "2026-10-17");
  comprobar("...y ya está vencido", String(estaVencido(fecha, 15, inicioDelSiguiente)), "true");
  // A las 01:00Z del 17/10 en UTC ya es 17/10, pero en Argentina todavía es 16/10 (22:00).
  comprobar("01:00Z del 17/10 sigue siendo 16/10 en AR", String(estaVencido(fecha, 15, hoyArgentina(new Date("2026-10-17T01:00:00Z")))), "false");
}

console.log("--- Estado calculado y plazo ---");
{
  const fecha = f("2026-10-01");
  const hoy = f("2026-10-16");
  comprobar("abierto vigente", estadoCalculado("ABIERTO", fecha, 15, hoy), "ABIERTO");
  comprobar("abierto vencido", estadoCalculado("ABIERTO", fecha, 15, f("2026-10-17")), "VENCIDO");
  comprobar("convertido vencido sigue convertido", estadoCalculado("CONVERTIDO", fecha, 15, f("2027-01-01")), "CONVERTIDO");
  comprobar("anulado vigente sigue anulado", estadoCalculado("ANULADO", fecha, 15, hoy), "ANULADO");
  comprobar("días restantes el último día", String(diasRestantes(fecha, 15, hoy)), "0");
  comprobar("días restantes antes", String(diasRestantes(fecha, 15, f("2026-10-10"))), "6");
  comprobar("días restantes vencido", String(diasRestantes(fecha, 15, f("2026-10-19"))), "-3");
  comprobar("plazo: hoy", textoPlazo("ABIERTO", 0) ?? "", "Vence hoy");
  comprobar("plazo: 1 día", textoPlazo("ABIERTO", 1) ?? "", "Quedan 1 día");
  comprobar("plazo: varios", textoPlazo("ABIERTO", 6) ?? "", "Quedan 6 días");
  comprobar("plazo: vencido", textoPlazo("VENCIDO", -3) ?? "", "Venció hace 3 días");
  comprobar("plazo: convertido no tiene", String(textoPlazo("CONVERTIDO", -30)), "null");
  comprobar("número", numeroPresupuesto(12, 2026), "12/2026");
}

console.log("--- Se puede editar / convertir ---");
{
  const base = { fecha: f("2026-10-01"), validezDias: 15 };
  const hoy = f("2026-10-10");
  comprobar("abierto vigente: sí", String(motivoNoAbierto({ ...base, estado: "ABIERTO" }, hoy, "convertir")), "null");
  comprobar(
    "vencido: no, y explica que se duplica",
    String(motivoNoAbierto({ ...base, estado: "ABIERTO" }, f("2026-10-17"), "convertir")?.includes("duplicalo")),
    "true",
  );
  comprobar(
    "vencido al editar",
    String(motivoNoAbierto({ ...base, estado: "ABIERTO" }, f("2026-10-17"), "editar")?.includes("editar")),
    "true",
  );
  comprobar(
    "convertido: no, con el número de la venta",
    motivoNoAbierto({ ...base, estado: "CONVERTIDO", ventaNumero: "7/2026" }, hoy, "convertir") ?? "",
    "Este presupuesto ya se convirtió en venta (#7/2026).",
  );
  comprobar("anulado: no", motivoNoAbierto({ ...base, estado: "ANULADO" }, hoy, "editar") ?? "", "Este presupuesto está anulado.");
}

console.log("--- Totales: mismo motor que la venta, sin costos ---");
{
  const lineas = [
    { cantidad: d(3), precioUnitario: d("333.3333"), ivaPct: d(21) },
    { cantidad: d("1.5"), precioUnitario: d("100.10"), ivaPct: d("10.5") },
  ];
  const t = totalizarPresupuesto(lineas);
  comprobar("línea 1 subtotal (3 × 333,3333)", subtotalLinea(lineas[0]!).toString(), "1000");
  comprobar("línea 2 subtotal (1,5 × 100,10)", subtotalLinea(lineas[1]!).toString(), "150.15");
  comprobar("total bruto", t.totalBruto.toString(), "1150.15");
  comprobar("total neto (IVA acumulado por línea)", t.totalNeto.toString(), "962.33");
  comprobar("total IVA", t.totalIVA.toString(), "187.82");
  comprobar("neto + IVA = bruto", t.totalNeto.plus(t.totalIVA).toString(), t.totalBruto.toString());
  comprobar("solo neto, IVA y bruto (sin costo ni margen)", Object.keys(t).sort().join(","), "totalBruto,totalIVA,totalNeto");

  // Es exactamente lo que calcula la venta con las mismas líneas.
  const venta = totalizarVenta(lineas.map((l) => costearLineaVenta({ ...l, costoUnitario: d(123) })));
  comprobar("bruto igual al de la venta", t.totalBruto.toString(), venta.totalBruto.toString());
  comprobar("neto igual al de la venta", t.totalNeto.toString(), venta.totalNeto.toString());
  comprobar("IVA igual al de la venta", t.totalIVA.toString(), venta.totalIVA.toString());
  comprobar("sin líneas: todo cero", totalizarPresupuesto([]).totalBruto.toString(), "0");
  comprobar("precio 0 es válido (regalo)", totalizarPresupuesto([{ cantidad: d(2), precioUnitario: d(0), ivaPct: d(21) }]).totalBruto.toString(), "0");
}

console.log("--- Consolidar líneas repetidas ---");
{
  const r = consolidarLineas([
    { articuloId: "a", cantidad: d(1) },
    { articuloId: "b", cantidad: d(2) },
    { articuloId: "a", cantidad: d("0.5") },
  ]);
  comprobar("un renglón por artículo", String(r.length), "2");
  comprobar("suma las cantidades del repetido", r.find((x) => x.articuloId === "a")!.cantidad.toString(), "1.5");
  comprobar("conserva el orden", r.map((x) => x.articuloId).join(","), "a,b");
}

console.log("--- Qué precio le toca a cada línea al editar ---");
{
  const previas = new Map<string, LineaPrevia>([
    ["a", { articuloId: "a", descripcion: "A", precioUnitario: d(100), ivaPct: d(21) }],
  ]);
  comprobar("artículo que ya estaba, mismo cliente: congelado", decidirPrecio({ articuloId: "a", previas, clienteCambio: false }).tipo, "CONGELADO");
  comprobar("artículo nuevo: se resuelve", decidirPrecio({ articuloId: "b", previas, clienteCambio: false }).tipo, "RESOLVER");
  comprobar("cambió el cliente: se reprecia todo", decidirPrecio({ articuloId: "a", previas, clienteCambio: true }).tipo, "RESOLVER");
  comprobar("alta (sin previas): se resuelve", decidirPrecio({ articuloId: "a", previas: new Map(), clienteCambio: true }).tipo, "RESOLVER");
}

console.log("--- Cantidades ---");
{
  comprobar("1 sirve", String(problemaDeCantidad(d(1))), "null");
  comprobar("0,001 sirve", String(problemaDeCantidad(d("0.001"))), "null");
  comprobar("0 no", String(problemaDeCantidad(d(0)) !== null), "true");
  comprobar("negativa no", String(problemaDeCantidad(d(-1)) !== null), "true");
  comprobar("4 decimales no (la base guarda 3)", problemaDeCantidad(d("1.2345")) ?? "", "La cantidad admite hasta 3 decimales.");
  comprobar("enorme no", String(problemaDeCantidad(d("1e12")) !== null), "true");
}

console.log("--- Mensaje de WhatsApp ---");
{
  const total = d("1150.15");
  const msg = mensajeWhatsAppPresupuesto({
    clienteNombre: " Ana Gómez ",
    numero: 12,
    anio: 2026,
    total,
    fecha: f("2026-10-01"),
    validezDias: 15,
  });
  comprobar(
    "texto exacto: saludo, número, total y validez",
    msg,
    `Hola Ana Gómez, te paso el presupuesto N° 12/2026 por ${fmtMoneda(total)}, válido hasta el ${fmtFecha(f("2026-10-16"))}. ¡Gracias!`,
  );
  comprobar("corto (menos de 160 caracteres)", String(msg.length < 160), "true");

  const bueno = enlaceWhatsApp("351 455-6677", msg);
  if (bueno.valido) {
    comprobar("enlace a wa.me con el número normalizado", String(bueno.url.startsWith("https://wa.me/5493514556677?text=")), "true");
    comprobar("el texto vuelve igual al decodificar", decodeURIComponent(bueno.url.split("?text=")[1] ?? ""), msg);
  } else {
    comprobar("teléfono válido", "inválido", "válido");
  }
  comprobar("teléfono dudoso: sin enlace", String(enlaceWhatsApp("12345", msg).valido), "false");
  comprobar("sin teléfono: sin enlace", String(enlaceWhatsApp(null, msg).valido), "false");
}

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
