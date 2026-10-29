/**
 * Verifica la logica pura del editor de articulos y recetas (`src/lib/recetas.ts`):
 * costeo en vivo del borrador y validacion del formulario.
 *
 *   npx tsx scripts/verificar-recetas.ts
 */
import { d } from "../src/lib/money";
import { costearBorrador, margenBorrador, validarArticulo, type DatosArticulo, type LineaBorrador } from "../src/lib/recetas";
import { recetaResuelta } from "../src/lib/receta";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const catalogo = {
  materiales: [
    { id: "mat-vinil", nombre: "Vinil", costo: "4200", unidad: "m2", activo: true },
    { id: "mat-viejo", nombre: "Viejo", costo: "100", unidad: "u", activo: false },
  ],
  maquinas: [{ id: "maq-laser", nombre: "Láser", costo: "8000", unidad: "h", activo: true }],
};
const costoHora = d("3500");

const linea = (l: Partial<LineaBorrador> & Pick<LineaBorrador, "tipo">): LineaBorrador => ({
  materialId: "",
  maquinaId: "",
  cantidad: "",
  override: "",
  notas: "",
  ...l,
});

// ─── Costeo en vivo ───────────────────────────────────────────────────────────

console.log("--- Costeo del borrador ---");
const lineas: LineaBorrador[] = [
  linea({ tipo: "MATERIAL", materialId: "mat-vinil", cantidad: "0,25" }), // 1050
  linea({ tipo: "MAQUINA", maquinaId: "maq-laser", cantidad: "0.5" }), // 4000
  linea({ tipo: "MANO_OBRA", cantidad: "1" }), // 3500
  linea({ tipo: "MATERIAL", materialId: "mat-vinil", cantidad: "2", override: "100" }), // 200 (fijado)
  linea({ tipo: "MAQUINA", cantidad: "3" }), // sin maquina: no cuenta
];
const receta = costearBorrador(lineas, catalogo, costoHora);
comprobar("costo total", receta.costoTotal.toString(), "8750");
comprobar("materiales", receta.costoMateriales.toString(), "1250");
comprobar("maquinas", receta.costoMaquinas.toString(), "4000");
comprobar("mano de obra", receta.costoManoObra.toString(), "3500");
comprobar("lineas incompletas no cuentan", String(receta.componentes.length), "4");
comprobar("ids = indice de la linea", receta.componentes.map((c) => c.id).join(","), "0,1,2,3");
comprobar("override marcado", String(receta.componentes[3]!.costoUnitarioOverride), "true");
comprobar("confiable", String(receta.confiable), "true");

// El mismo resultado que el listado del catalogo, que costea desde la base.
const desdeBase = recetaResuelta(
  [
    { id: "a", tipo: "MATERIAL", cantidad: d("0.25"), costoUnitarioOverride: null, notas: null, material: { nombre: "Vinil", costoUnitario: d(4200), unidad: "m2" }, maquina: null },
    { id: "b", tipo: "MAQUINA", cantidad: d("0.5"), costoUnitarioOverride: null, notas: null, material: null, maquina: { nombre: "Láser", costoHora: d(8000) } },
    { id: "c", tipo: "MANO_OBRA", cantidad: d(1), costoUnitarioOverride: null, notas: null, material: null, maquina: null },
    { id: "d", tipo: "MATERIAL", cantidad: d(2), costoUnitarioOverride: d(100), notas: null, material: { nombre: "Vinil", costoUnitario: d(4200), unidad: "m2" }, maquina: null },
  ],
  costoHora,
);
comprobar("igual al costeo desde la base", receta.costoTotal.toString(), desdeBase.costoTotal.toString());

const tipeoMalo = costearBorrador([linea({ tipo: "MANO_OBRA", cantidad: "1,", override: "abc" })], catalogo, costoHora);
comprobar("cantidad invalida cuenta 0", tipeoMalo.costoTotal.toString(), "0");
comprobar("override invalido = vigente", tipeoMalo.componentes[0]!.costoUnitario.toString(), "3500");

const vacia = costearBorrador([], catalogo, costoHora);
comprobar("sin lineas: no confiable", String(vacia.confiable), "false");
const margenVacio = margenBorrador("1000", "21", vacia);
comprobar("sin receta: margen no confiable", String(margenVacio.costoConfiable), "false");

// Precio 12100 con IVA 21%: neto 10000; costo 8750 → ganancia 3350, margen 27,69%.
const margen = margenBorrador("12100", "21", receta);
comprobar("precio neto", margen.precioNeto.toString(), "10000");
comprobar("ganancia", margen.ganancia.toString(), "3350");
comprobar("margen %", margen.margenPct.toString(), "27.69");
comprobar("precio a medio tipear", margenBorrador("12.", "21", receta).precioBruto.toString(), "0");

// ─── Validacion ───────────────────────────────────────────────────────────────

console.log("--- Validacion ---");
const ID = "11111111-1111-4111-8111-111111111111";
const base: DatosArticulo = {
  nombre: "  Cartel  ",
  descripcion: "  ",
  precioVenta: "1500,50",
  ivaPct: "10,5",
  esServicio: false,
  lineas: [
    linea({ tipo: "MATERIAL", materialId: ID, cantidad: "0,5", notas: " merma " }),
    linea({ tipo: "MAQUINA", maquinaId: ID, cantidad: "1", override: "0" }),
    linea({ tipo: "MANO_OBRA", materialId: ID, maquinaId: ID, cantidad: "0.25" }),
  ],
};

const ok = validarArticulo(base);
comprobar("valida", String(ok.ok), "true");
if (ok.ok) {
  const v = ok.valor;
  comprobar("nombre recortado", v.nombre, "Cartel");
  comprobar("descripcion vacia = null", String(v.descripcion), "null");
  comprobar("precio con coma", v.precioVenta.toString(), "1500.5");
  comprobar("iva 10,5", v.ivaPct.toString(), "10.5");
  comprobar("cantidad con coma", v.componentes[0]!.cantidad.toString(), "0.5");
  comprobar("nota recortada", String(v.componentes[0]!.notas), "merma");
  comprobar("override 0 permitido", String(v.componentes[1]!.costoUnitarioOverride), "0");
  comprobar("override vacio = null", String(v.componentes[0]!.costoUnitarioOverride), "null");
  // El CHECK de la base exige ids coherentes con el tipo: la mano de obra no lleva ninguno.
  comprobar(
    "mano de obra sin ids",
    `${v.componentes[2]!.materialId}/${v.componentes[2]!.maquinaId}`,
    "null/null",
  );
  comprobar("material sin maquina", String(v.componentes[0]!.maquinaId), "null");
  comprobar("alta sin id", String(v.id), "null");
}

const error = (cambios: Partial<DatosArticulo>) => {
  const r = validarArticulo({ ...base, ...cambios });
  return r.ok ? "aceptado" : r.error;
};
const lineaMala = (l: Partial<LineaBorrador> & Pick<LineaBorrador, "tipo">) => error({ lineas: [base.lineas[0]!, linea(l)] });

comprobar("sin nombre", error({ nombre: "  " }), "Falta el nombre del artículo");
comprobar("precio 0", error({ precioVenta: "0" }), "El precio de venta debe ser un número mayor a 0");
comprobar("precio con miles", error({ precioVenta: "1.500,00" }), "El precio de venta debe ser un número mayor a 0");
comprobar("precio 5 decimales", error({ precioVenta: "1,12345" }), "El precio admite hasta 4 decimales");
comprobar("iva raro", error({ ivaPct: "19" }), "El IVA debe ser 21%, 10,5%, 27% o 0%");
comprobar("iva 27", error({ ivaPct: "27" }), "aceptado");
comprobar("iva 0", error({ ivaPct: "0" }), "aceptado");
comprobar("id invalido", error({ id: "art-1" }), "Artículo inválido");
comprobar("receta vacia permitida", error({ lineas: [] }), "aceptado");
comprobar("material sin elegir", lineaMala({ tipo: "MATERIAL", cantidad: "1" }), "Línea 2 (material): elegí un material");
comprobar("maquina sin elegir", lineaMala({ tipo: "MAQUINA", cantidad: "1" }), "Línea 2 (máquina): elegí una máquina");
comprobar(
  "cantidad 0",
  lineaMala({ tipo: "MANO_OBRA", cantidad: "0" }),
  "Línea 2 (mano de obra): la cantidad debe ser un número mayor a 0",
);
comprobar(
  "cantidad negativa",
  lineaMala({ tipo: "MANO_OBRA", cantidad: "-1" }),
  "Línea 2 (mano de obra): la cantidad debe ser un número mayor a 0",
);
comprobar(
  "cantidad 5 decimales",
  lineaMala({ tipo: "MANO_OBRA", cantidad: "0,00001" }),
  "Línea 2 (mano de obra): la cantidad admite hasta 4 decimales",
);
comprobar(
  "override negativo",
  lineaMala({ tipo: "MANO_OBRA", cantidad: "1", override: "-5" }),
  "Línea 2 (mano de obra): el costo fijado debe ser un número, 0 o más",
);
comprobar(
  "nota larga",
  lineaMala({ tipo: "MANO_OBRA", cantidad: "1", notas: "x".repeat(201) }),
  "Línea 2 (mano de obra): la nota admite hasta 200 caracteres",
);
comprobar("tipo invalido", error({ lineas: [{ ...base.lineas[0]!, tipo: "OTRO" as "MATERIAL" }] }), "Línea 1: datos inválidos");
comprobar(
  "demasiadas lineas",
  error({ lineas: Array.from({ length: 51 }, () => base.lineas[2]!) }),
  "La receta admite hasta 50 líneas",
);

console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
