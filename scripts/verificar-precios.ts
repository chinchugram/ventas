/**
 * Verificacion de `resolverPrecio` (logica pura, sin base):
 *
 *   npm run test:precios
 */
import { d } from "../src/lib/money";
import { listaDePrecios, precioConDescuento, preciosBajoCosto, resolverPrecio, type ListaDePrecios } from "../src/lib/precios";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const A = "articulo-a";
const B = "articulo-b";

const lista = (extra: Partial<ListaDePrecios> = {}): ListaDePrecios => ({
  activo: true,
  descuentoPct: d(10),
  precios: new Map([[A, d(800)]]),
  ...extra,
});

const r = (articuloId: string, precioCatalogo: string, l: ListaDePrecios | null | undefined) => {
  const x = resolverPrecio({ articuloId, precioCatalogo: d(precioCatalogo), lista: l });
  return `${x.precio.toString()} ${x.origen}`;
};

console.log("--- Ramas de la regla ---");
comprobar("sin lista → catalogo", r(A, "1000", null), "1000 CATALOGO");
comprobar("lista undefined → catalogo", r(A, "1000", undefined), "1000 CATALOGO");
comprobar("precio especifico gana", r(A, "1000", lista()), "800 ESPECIFICO");
comprobar("especifico mayor al catalogo (se respeta)", r(A, "500", lista()), "800 ESPECIFICO");
comprobar("sin especifico → descuento general", r(B, "1000", lista()), "900 DESCUENTO");
comprobar("sin especifico ni descuento → catalogo", r(B, "1000", lista({ descuentoPct: d(0) })), "1000 CATALOGO");
comprobar("especifico gana aunque el descuento sea 0", r(A, "1000", lista({ descuentoPct: d(0) })), "800 ESPECIFICO");
comprobar("especifico en 0 es valido (no cae al descuento)", r(A, "1000", lista({ precios: new Map([[A, d(0)]]) })), "0 ESPECIFICO");
comprobar("descuento 100% → 0", r(B, "1000", lista({ descuentoPct: d(100) })), "0 DESCUENTO");

console.log("--- Lista inactiva ---");
comprobar("inactiva ignora el especifico", r(A, "1000", lista({ activo: false })), "1000 CATALOGO");
comprobar("inactiva ignora el descuento", r(B, "1000", lista({ activo: false })), "1000 CATALOGO");

console.log("--- Redondeos (centavos, mitad hacia arriba) ---");
comprobar("99,99 − 15% = 84,9915 → 84,99", precioConDescuento(d("99.99"), d(15)).toString(), "84.99");
comprobar("10,05 − 50% = 5,025 → 5,03", precioConDescuento(d("10.05"), d(50)).toString(), "5.03");
comprobar("0,01 − 50% = 0,005 → 0,01", precioConDescuento(d("0.01"), d(50)).toString(), "0.01");
comprobar("descuento con decimales 12,5%", precioConDescuento(d(1000), d("12.5")).toString(), "875");
comprobar("1210 − 33,33% = 806,707 → 806,71", precioConDescuento(d(1210), d("33.33")).toString(), "806.71");
comprobar("descuento 0 no cambia el precio", precioConDescuento(d("123.45"), d(0)).toString(), "123.45");
comprobar("el especifico no se redondea", r(A, "1000", lista({ precios: new Map([[A, d("799.9999")]]) })), "799.9999 ESPECIFICO");
let fueraDeRango = "no lanzó";
try {
  precioConDescuento(d(100), d(101));
} catch {
  fueraDeRango = "lanzó";
}
comprobar("descuento > 100 se rechaza", fueraDeRango, "lanzó");

console.log("--- Armado desde filas de la base ---");
const armada = listaDePrecios({ activo: true, descuentoPct: "5.00", items: [{ articuloId: A, precio: "750.5000" }] });
comprobar("fila → especifico", r(A, "1000", armada), "750.5 ESPECIFICO");
comprobar("fila → descuento 5%", r(B, "1000", armada), "950 DESCUENTO");

console.log("--- Precios por debajo del costo ---");
const arts = [
  { id: A, nombre: "A", precioCatalogo: d(1000), costo: d(850), costoConfiable: true },
  { id: B, nombre: "B", precioCatalogo: d(1000), costo: d(950), costoConfiable: true },
  { id: "c", nombre: "C sin receta", precioCatalogo: d(1000), costo: d(0), costoConfiable: false },
  { id: "e", nombre: "E", precioCatalogo: d(100), costo: d(500), costoConfiable: true },
];
// A: especifico 800 < 850. B: 10% → 900 < 950. C: sin receta, se omite. E: 90 < 500.
const bajo = preciosBajoCosto(lista(), arts);
comprobar(
  "detecta especifico y descuento, omite sin receta",
  bajo.map((x) => `${x.articuloId}:${x.origen}`).join(","),
  `${A}:ESPECIFICO,${B}:DESCUENTO,e:DESCUENTO`,
);
comprobar("sin descuento ni especificos no hay alertas", String(preciosBajoCosto(lista({ descuentoPct: d(0), precios: new Map() }), arts).length), "0");
comprobar("precio igual al costo no alerta", String(preciosBajoCosto(lista({ descuentoPct: d(0), precios: new Map([[A, d(850)]]) }), arts).length), "0");
comprobar("evalua aunque la lista este inactiva", String(preciosBajoCosto(lista({ activo: false }), arts).length), "3");

if (fallos > 0) {
  console.log(`\n${fallos} comprobaciones fallaron.`);
  process.exit(1);
}
console.log("\nTodo OK.");
