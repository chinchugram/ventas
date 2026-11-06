/**
 * Verificacion de la lista de reposicion contra numeros conocidos.
 *
 *   npx tsx scripts/verificar-reposicion.ts
 */
import {
  armarPrecarga,
  armarReposicion,
  cantidadSugerida,
  leerFactor,
  leerPrecarga,
  urlNuevaCompra,
  validarFactor,
} from "../src/lib/reposicion";
import { d } from "../src/lib/money";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const dos = d(2);

console.log("--- Cantidad sugerida: minimo × factor − stock ---");
comprobar("stock 6 de minimo 10, factor 2", cantidadSugerida(d("6"), d("10"), dos).toString(), "14");
comprobar("agotado, minimo 2, factor 2", cantidadSugerida(d("0"), d("2"), dos).toString(), "4");
comprobar("2,4 de minimo 3, factor 1,5", cantidadSugerida(d("2.4"), d("3"), d("1.5")).toString(), "2.1");
comprobar("factor 1: justo hasta el minimo", cantidadSugerida(d("2.4"), d("3"), d(1)).toString(), "0.6");
comprobar("sobre el minimo: nada", cantidadSugerida(d("38"), d("10"), dos).toString(), "0");
comprobar("justo en el minimo: repone (igual que la alerta de /materiales)", cantidadSugerida(d("10"), d("10"), dos).toString(), "10");
comprobar("justo en el minimo con factor 1: nada", cantidadSugerida(d("10"), d("10"), d(1)).toString(), "0");
comprobar("sin minimo cargado: nada", cantidadSugerida(d("0"), d("0"), dos).toString(), "0");
comprobar("redondea hacia arriba a 3 decimales", cantidadSugerida(d("0.1"), d("1.3333"), dos).toString(), "2.567");
comprobar("unidades enteras: hacia arriba", cantidadSugerida(d("1.5"), d("3"), d("1.5"), "HOJA").toString(), "3");
comprobar("rollos: 0 de minimo 2, factor 1,25", cantidadSugerida(d("0"), d("2"), d("1.25"), "ROLLO").toString(), "3");
comprobar("m2 no se redondea al entero", cantidadSugerida(d("1.5"), d("3"), d("1.5"), "M2").toString(), "3");
comprobar("m2 con decimales", cantidadSugerida(d("1.25"), d("3"), d("1.5"), "M2").toString(), "3.25");

console.log("--- Lista y total (materiales de ejemplo) ---");
const materiales = [
  { id: "m1", nombre: "Vinil adhesivo brillante", unidad: "M2", stockActual: d("38"), stockMinimo: d("10"), costoUnitario: d("4200") },
  { id: "m2", nombre: "Transportador", unidad: "M2", stockActual: d("6"), stockMinimo: d("10"), costoUnitario: d("1400") },
  { id: "m4", nombre: "Acrílico opalino 3mm", unidad: "M2", stockActual: d("2.4"), stockMinimo: d("3"), costoUnitario: d("24000") },
  { id: "m5", nombre: "Cinta doble faz", unidad: "ROLLO", stockActual: d("0"), stockMinimo: d("2"), costoUnitario: d("3200") },
  { id: "m6", nombre: "Sin minimo", unidad: "U", stockActual: d("0"), stockMinimo: d("0"), costoUnitario: d("100") },
];
const r = armarReposicion(materiales, dos);
comprobar("materiales a reponer", String(r.lineas.length), "3");
comprobar("orden: agotado primero, despues el mas lejos del minimo", r.lineas.map((l) => l.id).join(","), "m5,m2,m4");
comprobar("transportador: 14 m2", r.lineas[1]!.cantidad.toString(), "14");
comprobar("transportador: 14 × 1.400", r.lineas[1]!.costoEstimado.toString(), "19600");
comprobar("acrilico: 3,6 m2", r.lineas[2]!.cantidad.toString(), "3.6");
comprobar("acrilico: 3,6 × 24.000", r.lineas[2]!.costoEstimado.toString(), "86400");
comprobar("cinta: 4 rollos × 3.200", r.lineas[0]!.costoEstimado.toString(), "12800");
comprobar("total", r.total.toString(), "118800");
comprobar("factor 1,5 recalcula el total", armarReposicion(materiales, d("1.5")).total.toString(), "72600");
comprobar("nada para reponer", String(armarReposicion([materiales[0]!], dos).lineas.length), "0");

console.log("--- Costo estimado redondeado como un subtotal de compra ---");
const centavos = armarReposicion(
  [
    { id: "a", nombre: "A", unidad: "M", stockActual: d("0"), stockMinimo: d("0.333"), costoUnitario: d("15.0075") },
    { id: "b", nombre: "B", unidad: "M", stockActual: d("0"), stockMinimo: d("1"), costoUnitario: d("0.005") },
  ],
  d(1),
);
comprobar("0,333 × 15,0075", centavos.lineas[0]!.costoEstimado.toString(), "5");
comprobar("1 × 0,005 (medio centavo, redondea arriba)", centavos.lineas[1]!.costoEstimado.toString(), "0.01");
comprobar("total = suma de subtotales redondeados", centavos.total.toString(), "5.01");

console.log("--- Factor ---");
comprobar("2 es valido", String(validarFactor("2")), "null");
comprobar("1,5 con coma es valido", String(validarFactor("1,5")), "null");
comprobar("1 es valido", String(validarFactor("1")), "null");
comprobar("10 es valido", String(validarFactor("10")), "null");
comprobar("0,5 no", String(validarFactor("0,5") !== null), "true");
comprobar("10,5 no", String(validarFactor("10,5") !== null), "true");
comprobar("1,255 no (3 decimales)", String(validarFactor("1,255") !== null), "true");
comprobar("texto no", String(validarFactor("dos") !== null), "true");
comprobar("sin clave: 2", leerFactor({}).toString(), "2");
comprobar("guardado 1.5", leerFactor({ factorReposicion: "1.5" }).toString(), "1.5");
comprobar("guardado roto: 2", leerFactor({ factorReposicion: "0" }).toString(), "2");

console.log("--- Precarga de Nueva compra ---");
const lineas = [
  { id: "3f1c7a0e-0000-4000-8000-000000000001", cantidad: d("14") },
  { id: "3f1c7a0e-0000-4000-8000-000000000002", cantidad: d("3.6") },
];
comprobar("armar", armarPrecarga(lineas), "3f1c7a0e-0000-4000-8000-000000000001:14,3f1c7a0e-0000-4000-8000-000000000002:3.6");
comprobar("ida y vuelta", JSON.stringify(leerPrecarga(armarPrecarga(lineas))), JSON.stringify(lineas.map((l) => ({ materialId: l.id, cantidad: l.cantidad.toString() }))));
comprobar("url sin lineas", urlNuevaCompra([]), "/compras/nueva");
comprobar("url con lineas", urlNuevaCompra([{ id: "m2", cantidad: d("14") }]), "/compras/nueva?m=m2%3A14");
comprobar("cantidad con coma no se confunde con otra linea", JSON.stringify(leerPrecarga("m2:1.5,m3:2")), JSON.stringify([{ materialId: "m2", cantidad: "1.5" }, { materialId: "m3", cantidad: "2" }]));
comprobar("descarta cantidad 0, negativa, texto o vacia", JSON.stringify(leerPrecarga("a:0,b:-1,c:dos,d:,e,f:1e3,g:2")), JSON.stringify([{ materialId: "g", cantidad: "2" }]));
comprobar("descarta ids raros y repetidos", JSON.stringify(leerPrecarga("x;drop:1,g:2,g:5, h:1.50 ")), JSON.stringify([{ materialId: "g", cantidad: "2" }, { materialId: "h", cantidad: "1.5" }]));
comprobar("parametro ausente", JSON.stringify(leerPrecarga(undefined)), "[]");
comprobar("parametro repetido", JSON.stringify(leerPrecarga(["a:1", "b:2"])), JSON.stringify([{ materialId: "a", cantidad: "1" }, { materialId: "b", cantidad: "2" }]));

console.log("");
console.log(fallos === 0 ? "TODAS LAS COMPROBACIONES PASARON" : `${fallos} COMPROBACIONES FALLARON`);
process.exit(fallos === 0 ? 0 : 1);
