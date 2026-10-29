/**
 * Casos conocidos para `src/lib/csv.ts`. Las salidas esperadas estan escritas a
 * mano (no salen de la misma funcion que se prueba).
 *
 *   npm run test:csv
 *
 * Sin base de datos. Sale con codigo 1 si algun caso falla.
 */
import { d } from "../src/lib/money";
import { construirCSV, decimalCSV, fechaCSV, neutralizarFormula, type Celda } from "../src/lib/csv";

let fallos = 0;
let comprobaciones = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  comprobaciones += 1;
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "OK   " : "FALLA"} ${etiqueta}`);
  if (!ok) {
    console.log(`         esperado: ${JSON.stringify(esperado)}`);
    console.log(`         obtenido: ${JSON.stringify(obtenido)}`);
  }
}

const BOM = "﻿";
const CRLF = "\r\n";

// ─── Escape de campos ───────────────────────────────────────────────────────

console.log("Escape de campos");

comprobar(
  "campo con coma (no se escapa: el separador es ';')",
  construirCSV(["Dir"], [["Calle 1, piso 2"]]),
  `${BOM}Dir${CRLF}Calle 1, piso 2${CRLF}`,
);

comprobar(
  "campo con ';' se entrecomilla",
  construirCSV(["Nota"], [["A;B"]]),
  `${BOM}Nota${CRLF}"A;B"${CRLF}`,
);

comprobar(
  "campo con comillas: se entrecomilla y se duplican",
  construirCSV(["Nota"], [['Dice "hola"']]),
  `${BOM}Nota${CRLF}"Dice ""hola"""${CRLF}`,
);

comprobar(
  "campo con salto de linea \\n se entrecomilla",
  construirCSV(["Nota"], [["linea1\nlinea2"]]),
  `${BOM}Nota${CRLF}"linea1\nlinea2"${CRLF}`,
);

comprobar(
  "campo con retorno \\r se entrecomilla",
  construirCSV(["Nota"], [["a\rb"]]),
  `${BOM}Nota${CRLF}"a\rb"${CRLF}`,
);

comprobar(
  "encabezado con ';' tambien se escapa",
  construirCSV(["Precio;neto", "Otro"], []),
  `${BOM}"Precio;neto";Otro${CRLF}`,
);

comprobar(
  "texto vacio: celda vacia entre separadores",
  construirCSV(["a", "b", "c"], [["x", "", "z"]]),
  `${BOM}a;b;c${CRLF}x;;z${CRLF}`,
);

comprobar(
  "null y undefined: celdas vacias",
  construirCSV(["a", "b", "c"], [[null, undefined, "z"]]),
  `${BOM}a;b;c${CRLF};;z${CRLF}`,
);

comprobar(
  "sin filas: solo encabezado",
  construirCSV(["a", "b"], []),
  `${BOM}a;b${CRLF}`,
);

// ─── Importes (Decimal) ─────────────────────────────────────────────────────

console.log("Importes Decimal");

comprobar("Decimal 1234.5 → 1234,50", decimalCSV(d("1234.5")), "1234,50");
comprobar("Decimal -0.5 → -0,50 (negativo sin neutralizar)", decimalCSV(d("-0.5")), "-0,50");
comprobar("Decimal 1234567.891 → 1234567,89 (sin miles, redondeo)", decimalCSV(d("1234567.891")), "1234567,89");
comprobar("Decimal 0 → 0,00", decimalCSV(d(0)), "0,00");
comprobar("Decimal -0.001 → 0,00 (no -0,00)", decimalCSV(d("-0.001")), "0,00");
comprobar("Decimal 2.5 con 3 decimales → 2,500 (cantidad)", decimalCSV(d("2.5"), 3), "2,500");
comprobar("Decimal 0.125 → 0,13 (mitad hacia arriba)", decimalCSV(d("0.125")), "0,13");

comprobar(
  "importe negativo en una fila con texto con '=' (solo el texto se neutraliza)",
  construirCSV(["Texto", "Monto"], [["=SUMA(A1)", d("-0.5")]]),
  `${BOM}Texto;Monto${CRLF}'=SUMA(A1);-0,50${CRLF}`,
);

comprobar(
  "porcentaje Decimal 40.5 → 40,50 (sin '%')",
  construirCSV(["Margen %"], [[{ porcentaje: d("40.5") }]]),
  `${BOM}Margen %${CRLF}40,50${CRLF}`,
);

comprobar(
  "cantidad {cantidad, decimales: 3}: 2.5 → 2,500",
  construirCSV(["Consumido"], [[{ cantidad: d("2.5"), decimales: 3 }]]),
  `${BOM}Consumido${CRLF}2,500${CRLF}`,
);

// ─── Fechas ─────────────────────────────────────────────────────────────────

console.log("Fechas");

comprobar(
  "Date de medianoche UTC → dd/mm/aaaa (dia calendario)",
  fechaCSV(new Date(Date.UTC(2026, 9, 14))),
  "14/10/2026",
);

comprobar(
  "fecha de 1 de enero con dia y mes de un digito → 01/01/2026",
  construirCSV(["Desde"], [[new Date(Date.UTC(2026, 0, 1))]]),
  `${BOM}Desde${CRLF}01/01/2026${CRLF}`,
);

// ─── BOM y fin de linea ─────────────────────────────────────────────────────

console.log("BOM y fin de linea");

const conFilas = construirCSV(["a", "b"], [["1", "2"], ["3", "4"]]);

comprobar("empieza con BOM UTF-8", conFilas.slice(0, 1), BOM);
comprobar(
  "fin de linea \\r\\n en cada fila, incluida la ultima",
  conFilas,
  `${BOM}a;b${CRLF}1;2${CRLF}3;4${CRLF}`,
);
comprobar(
  "ningun \\n suelto fuera de un campo entrecomillado",
  String(conFilas.replace(/\r\n/g, "").includes("\n")),
  "false",
);

// ─── Inyeccion de formulas ──────────────────────────────────────────────────

console.log("Inyeccion de formulas");

comprobar(
  "texto que empieza con '=' → prefijo ' ",
  construirCSV(["x"], [["=1+1"]]),
  `${BOM}x${CRLF}'=1+1${CRLF}`,
);
comprobar("texto que empieza con '+' → prefijo '", neutralizarFormula("+56 11"), "'+56 11");
comprobar("texto que empieza con '-' → prefijo '", neutralizarFormula("-Acrilico"), "'-Acrilico");
comprobar("texto que empieza con '@' → prefijo '", neutralizarFormula("@usuario"), "'@usuario");
comprobar("texto con '=' en el medio no se toca", neutralizarFormula("a=b"), "a=b");
comprobar(
  "formula con ';' y comillas: prefijo y luego escape",
  construirCSV(["x"], [['=A1;"x"']]),
  `${BOM}x${CRLF}"'=A1;""x"""${CRLF}`,
);

// ─── Resumen ────────────────────────────────────────────────────────────────

const celdas: Celda[] = ["texto", d("1"), null];
comprobar(
  "celdas mixtas en una fila",
  construirCSV(["a", "b", "c"], [celdas]),
  `${BOM}a;b;c${CRLF}texto;1,00;${CRLF}`,
);

console.log("");
console.log(`${comprobaciones - fallos}/${comprobaciones} casos OK`);
if (fallos > 0) {
  console.log(`${fallos} FALLA(S)`);
  process.exit(1);
}
