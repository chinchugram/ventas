/**
 * Verificacion de la logica pura de recordatorios de cobranza: a quien llamar
 * hoy (filtros), orden por tramo y monto, bordes de tramo, telefonos
 * argentinos y mensaje de WhatsApp. No usa base.
 *
 *   npx tsx scripts/verificar-recordatorios.ts
 */
import { d } from "../src/lib/money";
import {
  enlaceWhatsApp,
  etiquetaTramo,
  hayQueLlamarHoy,
  mensajeWhatsApp,
  normalizarTelefono,
  recordatoriosDeHoy,
  tramoRecordatorio,
  ultimoContactoDe,
  validarProximoContacto,
  type ContactoRegistrado,
  type Deudor,
} from "../src/lib/recordatorios-cobranza";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const f = (iso: string) => new Date(`${iso}T00:00:00Z`);
const HOY = f("2026-10-29");
/** Fecha a N dias de HOY (negativo = pasado). */
const dia = (n: number) => new Date(HOY.getTime() + n * 86_400_000);

let creado = 0;
function contacto(fecha: Date, proximo: Date | null, nota = "nota", creadoEn?: Date): ContactoRegistrado {
  creado += 1;
  return { fecha, nota, proximoContacto: proximo, creadoEn: creadoEn ?? new Date(Date.UTC(2026, 0, 1, 0, 0, creado)) };
}

function deudor(nombre: string, saldo: string | number, diasDeuda: number, contactos: ContactoRegistrado[] = []): Deudor {
  return {
    clienteId: `id-${nombre}`,
    nombre,
    telefono: null,
    saldo: d(saldo),
    desde: dia(-diasDeuda),
    contactos,
  };
}

const nombres = (rs: { nombre: string }[]) => rs.map((r) => r.nombre).join(",");

console.log("--- Bordes de tramo (0-7, 8-30, 31-60, mas de 60) ---");
for (const [dias, esperado] of [
  [0, "HASTA_7"],
  [7, "HASTA_7"],
  [8, "HASTA_30"],
  [30, "HASTA_30"],
  [31, "HASTA_60"],
  [60, "HASTA_60"],
  [61, "MAS_60"],
  [365, "MAS_60"],
] as const) {
  comprobar(`${dias} dias`, tramoRecordatorio(dias), esperado);
}
comprobar("etiqueta 0-7", etiquetaTramo("HASTA_7"), "0 a 7 días");
comprobar("etiqueta mas de 60", etiquetaTramo("MAS_60"), "Más de 60 días");

console.log("--- Antiguedad desde la venta impaga mas vieja ---");
{
  const r = recordatoriosDeHoy([deudor("A", 100, 7), deudor("B", 100, 8), deudor("C", 100, 61)], HOY);
  comprobar("7 dias -> tramo 0-7", `${r.find((x) => x.nombre === "A")?.dias}/${r.find((x) => x.nombre === "A")?.tramo}`, "7/HASTA_7");
  comprobar("8 dias -> tramo 8-30", `${r.find((x) => x.nombre === "B")?.dias}/${r.find((x) => x.nombre === "B")?.tramo}`, "8/HASTA_30");
  comprobar("61 dias -> mas de 60", `${r.find((x) => x.nombre === "C")?.dias}/${r.find((x) => x.nombre === "C")?.tramo}`, "61/MAS_60");
  const futura = recordatoriosDeHoy([{ ...deudor("F", 100, 0), desde: dia(3) }], HOY);
  comprobar("venta con fecha futura no da dias negativos", String(futura[0]?.dias), "0");
}

console.log("--- Filtros: saldo ---");
comprobar("saldo 0 no aparece", String(hayQueLlamarHoy(deudor("Z", 0, 10), HOY)), "false");
comprobar("saldo 0,01 (tolerancia) no aparece", String(hayQueLlamarHoy(deudor("Z", "0.01", 10), HOY)), "false");
comprobar("saldo 0,02 aparece", String(hayQueLlamarHoy(deudor("Z", "0.02", 10), HOY)), "true");
comprobar("saldo negativo no aparece", String(hayQueLlamarHoy(deudor("Z", -5, 10), HOY)), "false");
comprobar("saldo positivo sin contactos aparece", String(hayQueLlamarHoy(deudor("Z", 1000, 10), HOY)), "true");

console.log("--- Filtros: promesa de proximo contacto ---");
comprobar(
  "promesa para manana: no aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-1), dia(1))]), HOY)),
  "false",
);
comprobar(
  "promesa para dentro de un mes: no aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-1), dia(30))]), HOY)),
  "false",
);
comprobar(
  "promesa para hoy: aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-3), HOY)]), HOY)),
  "true",
);
comprobar(
  "promesa vencida (ayer): aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-5), dia(-1))]), HOY)),
  "true",
);
comprobar(
  "contacto viejo sin promesa: aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-5), null)]), HOY)),
  "true",
);
comprobar(
  "un contacto posterior sin promesa cancela la anterior",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-4), dia(10)), contacto(dia(-2), null)]), HOY)),
  "true",
);
comprobar(
  "un contacto posterior con promesa futura reemplaza una vencida",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-9), dia(-5)), contacto(dia(-2), dia(5))]), HOY)),
  "false",
);
{
  // Mismo dia: manda el ultimo cargado, en el orden en que lleguen.
  const temprano = new Date("2026-10-27T10:00:00Z");
  const tarde = new Date("2026-10-27T18:00:00Z");
  const conPromesa = contacto(dia(-2), dia(5), "con promesa", temprano);
  const sinPromesa = contacto(dia(-2), null, "sin promesa", tarde);
  comprobar("mismo dia, el ultimo cargado sin promesa: aparece", String(hayQueLlamarHoy(deudor("Z", 1, 1, [conPromesa, sinPromesa]), HOY)), "true");
  comprobar("mismo dia, orden del arreglo invertido: igual", String(hayQueLlamarHoy(deudor("Z", 1000, 1, [sinPromesa, conPromesa]), HOY)), "true");
  const tardeConPromesa = contacto(dia(-2), dia(5), "tarde con promesa", tarde);
  const tempranoSin = contacto(dia(-2), null, "temprano sin promesa", temprano);
  comprobar("mismo dia, el ultimo cargado con promesa: no aparece", String(hayQueLlamarHoy(deudor("Z", 1000, 1, [tardeConPromesa, tempranoSin]), HOY)), "false");
  comprobar("ultimoContactoDe mismo dia", ultimoContactoDe([conPromesa, sinPromesa])?.nota ?? "-", "sin promesa");
}
comprobar("ultimoContactoDe sin contactos", String(ultimoContactoDe([])), "null");
comprobar(
  "ultimoContactoDe por fecha",
  ultimoContactoDe([contacto(dia(-9), null, "viejo"), contacto(dia(-2), null, "nuevo"), contacto(dia(-5), null, "medio")])?.nota ?? "-",
  "nuevo",
);

console.log("--- Filtros: contacto registrado hoy ---");
comprobar(
  "contactado hoy sin promesa: no aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(HOY, null)]), HOY)),
  "false",
);
comprobar(
  "contactado hoy con promesa para manana: no aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(HOY, dia(1))]), HOY)),
  "false",
);
comprobar(
  "contactado hoy y otro viejo: no aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-9), null), contacto(HOY, null)]), HOY)),
  "false",
);
comprobar(
  "contactado ayer sin promesa: aparece",
  String(hayQueLlamarHoy(deudor("Z", 1000, 10, [contacto(dia(-1), null)]), HOY)),
  "true",
);

console.log("--- Lista completa: filtra y conserva a los que corresponden ---");
{
  const lista = recordatoriosDeHoy(
    [
      deudor("Saldado", 0, 40),
      deudor("Prometio", 900, 40, [contacto(dia(-1), dia(3))]),
      deudor("YaLlamado", 900, 40, [contacto(HOY, null)]),
      deudor("PromesaHoy", 100, 20, [contacto(dia(-2), HOY)]),
      deudor("Nuevo", 200, 3),
    ],
    HOY,
  );
  comprobar("quedan", nombres(lista), "PromesaHoy,Nuevo");
  const ult = lista.find((x) => x.nombre === "PromesaHoy")?.ultimoContacto;
  comprobar("trae el ultimo contacto", ult?.nota ?? "-", "nota");
  comprobar("sin contactos, ultimoContacto es null", String(lista.find((x) => x.nombre === "Nuevo")?.ultimoContacto), "null");
}

console.log("--- Orden: tramo (mas viejo primero) y luego monto descendente ---");
{
  const lista = recordatoriosDeHoy(
    [
      deudor("T1_0d_100", 100, 0),
      deudor("T2_7d_9000", 9000, 7),
      deudor("T3_8d_50", 50, 8),
      deudor("T4_30d_800", 800, 30),
      deudor("T5_31d_10", 10, 31),
      deudor("T6_60d_300", 300, 60),
      deudor("T7_61d_20", 20, 61),
      deudor("T8_200d_5", 5, 200),
      deudor("T9_61d_700", 700, 61),
    ],
    HOY,
  );
  comprobar(
    "orden completo",
    nombres(lista),
    ["T9_61d_700", "T7_61d_20", "T8_200d_5", "T6_60d_300", "T5_31d_10", "T4_30d_800", "T3_8d_50", "T2_7d_9000", "T1_0d_100"].join(","),
  );
  comprobar("un monto enorme reciente va despues de uno chico viejo", String(lista.findIndex((x) => x.nombre === "T2_7d_9000") > lista.findIndex((x) => x.nombre === "T8_200d_5")), "true");
  const empate = recordatoriosDeHoy([deudor("Beta", 100, 10), deudor("Alfa", 100, 10), deudor("Gama", 100, 10)], HOY);
  comprobar("mismo tramo y monto: por nombre", nombres(empate), "Alfa,Beta,Gama");
  const centavos = recordatoriosDeHoy([deudor("Menos", "100.10", 10), deudor("Mas", "100.11", 10)], HOY);
  comprobar("monto decimal exacto", nombres(centavos), "Mas,Menos");
  const original = [deudor("B", 1, 1), deudor("A", 2, 1)];
  recordatoriosDeHoy(original, HOY);
  comprobar("no modifica la entrada", original.map((x) => x.nombre).join(","), "B,A");
}

console.log("--- Proximo contacto: no puede ser pasado ---");
comprobar("hoy se acepta", String(validarProximoContacto("2026-10-29", "2026-10-29")), "null");
comprobar("manana se acepta", String(validarProximoContacto("2026-10-30", "2026-10-29")), "null");
comprobar("ayer se rechaza", String(validarProximoContacto("2026-10-28", "2026-10-29")), "El próximo contacto no puede ser una fecha pasada.");
comprobar("formato roto", String(validarProximoContacto("29/10/2026", "2026-10-29")), "Fecha inválida");
comprobar("fecha imposible", String(validarProximoContacto("2026-13-45", "2026-10-29")), "Fecha inválida");

console.log("--- Telefonos validos -> 549 + caracteristica + abonado ---");
const validos: [string, string][] = [
  ["351 455-6677", "5493514556677"],
  ["3514556677", "5493514556677"],
  ["  351 4556677  ", "5493514556677"],
  ["(0351) 455 6677", "5493514556677"],
  ["0351 4556677", "5493514556677"],
  ["0351 15 455-6677", "5493514556677"],
  ["351-15-4556677", "5493514556677"],
  ["+54 9 351 455-6677", "5493514556677"],
  ["+5493514556677", "5493514556677"],
  ["+54 351 455 6677", "5493514556677"],
  ["+54 (351) 455.6677", "5493514556677"],
  ["+54 9 351 15 455 6677", "5493514556677"],
  ["54 351 15 4556677", "5493514556677"],
  ["0054 9 351 4556677", "5493514556677"],
  ["9 351 4556677", "5493514556677"],
  ["+54 0351 4556677", "5493514556677"],
  ["11 5555-1234", "5491155551234"],
  ["011 15 5555 1234", "5491155551234"],
  ["(011) 4555-1234", "5491145551234"],
  ["+54 9 11 5555 1234", "5491155551234"],
  ["2966 15 123456", "5492966123456"],
  ["0291 15 4123456", "5492914123456"],
  ["03543 15 123456", "5493543123456"],
  ["221 555-1234", "5492215551234"],
];
for (const [crudo, esperado] of validos) {
  const r = normalizarTelefono(crudo);
  comprobar(`"${crudo}"`, r.valido ? r.numero : `INVALIDO (${r.motivo})`, esperado);
}

console.log("--- Telefonos no validos (nunca se adivina) ---");
const invalidos: (string | null | undefined)[] = [
  "",
  "   ",
  null,
  undefined,
  "abc",
  "sin teléfono",
  "N/A",
  "351 455-6677 int 12",
  "351 455-6677 / 351 411-2233",
  "4556677", // sin caracteristica
  "455-6677",
  "154556677", // 15 sin caracteristica
  "351 455-667", // un digito de menos
  "351 455-66778", // un digito de mas
  "11 4555 1234 5",
  "3514556677123456", // demasiado largo
  "1234567890", // caracteristica que no existe (empieza con 1 pero no 11)
  "4556677351", // empieza con 4
  "0800 222 1234", // 0800
  "351 45 456677 7", // 12 digitos sin 15
  "+1 415 555 2671", // otro pais
  "0044 20 7946 0958",
  "+54+9 351 455 6677", // dos +
  "351+4556677", // + en el medio
  "5493514556677 99",
  "54 9 351 455 667", // con pais pero corto
];
for (const crudo of invalidos) {
  const r = normalizarTelefono(crudo);
  comprobar(`${JSON.stringify(crudo)}`, r.valido ? `VALIDO (${r.numero})` : "no válido", "no válido");
}
{
  const r = normalizarTelefono("");
  comprobar("el motivo es legible", r.valido ? "-" : r.motivo, "Falta el teléfono.");
  const otro = normalizarTelefono("+1 415 555 2671");
  comprobar("motivo de otro pais", otro.valido ? "-" : otro.motivo, "Solo se aceptan teléfonos de Argentina.");
}

console.log("--- Mensaje y enlace de WhatsApp ---");
{
  const msg = mensajeWhatsApp("  Café La Esquina ", d("1234.5"));
  comprobar("saludo + nombre + saldo", `${msg.startsWith("Hola Café La Esquina,")}/${msg.includes("1.234,50")}`, "true/true");
  comprobar("no menciona venta ni negocio", String(/venta|comprobante|factura|HL|láser|laser|CBU|alias/i.test(msg)), "false");

  const e = enlaceWhatsApp("351 455-6677", msg);
  if (e.valido) {
    comprobar("numero del enlace", e.numero, "5493514556677");
    comprobar("empieza con wa.me/549", String(e.url.startsWith("https://wa.me/5493514556677?text=")), "true");
    comprobar("el texto va codificado y vuelve igual", decodeURIComponent(e.url.split("?text=")[1] ?? ""), msg);
    comprobar("sin espacios crudos en la url", String(/\s/.test(e.url)), "false");
  } else {
    comprobar("enlace de telefono valido", "inválido", "válido");
  }
  const malo = enlaceWhatsApp("123", msg);
  comprobar("telefono dudoso: sin enlace", String(malo.valido), "false");
  comprobar("telefono null: sin enlace", String(enlaceWhatsApp(null, msg).valido), "false");
}

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
