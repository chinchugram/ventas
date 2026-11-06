/**
 * Verificacion de la logica pura del registro de produccion (6.1): sugerencia desde
 * la receta, validacion de la carga, ajuste de stock por la diferencia (idempotente),
 * costo real con snapshots, filtros del listado y que las pantallas del empleado no
 * toquen costos. No usa base.
 *
 *   npm run test:produccion
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { d } from "../src/lib/money";
import {
  calcularAjusteDeStock,
  consumoDeRecetaEnStock,
  costoRealDeTrabajo,
  fmtMinutos,
  marcaDeLinea,
  motivoDeAjusteProduccion,
  numeroDeVentaEnBusqueda,
  parsearBusqueda,
  parsearFiltro,
  sugerirDesdeReceta,
  validarCarga,
  type ComponenteReceta,
} from "../src/lib/produccion";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string | boolean, esperado: string) {
  obtenido = String(obtenido);
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const comp = (tipo: ComponenteReceta["tipo"], id: string | null, cantidad: string): ComponenteReceta => ({
  tipo,
  materialId: tipo === "MATERIAL" ? id : null,
  maquinaId: tipo === "MAQUINA" ? id : null,
  cantidad: d(cantidad),
});

const resumen = (xs: { materialId?: string; maquinaId?: string; cantidad?: { toString(): string }; minutos?: { toString(): string } }[]) =>
  xs.map((x) => `${x.materialId ?? x.maquinaId}=${(x.cantidad ?? x.minutos)!.toString()}`).join(",");

console.log("--- Sugerencia desde la receta ---");
{
  // Receta de un cartel: 0,5 m2 de vinilo, 0,25 h de laser, 0,1 h de mano de obra, por unidad.
  const receta = [comp("MATERIAL", "vinilo", "0.5"), comp("MAQUINA", "laser", "0.25"), comp("MANO_OBRA", null, "0.1")];
  const s = sugerirDesdeReceta(receta, "4");
  comprobar("material = cantidad de receta × cantidad de la línea", resumen(s.materiales), "vinilo=2");
  comprobar("minutos de máquina = horas × 60 × cantidad", resumen(s.maquinas), "laser=60");
  comprobar("minutos de mano de obra", s.minutosManoObra.toString(), "24");

  const sinReceta = sugerirDesdeReceta([], "3");
  comprobar("sin receta no sugiere nada", `${sinReceta.maquinas.length}/${sinReceta.materiales.length}/${sinReceta.minutosManoObra}`, "0/0/0");

  const repetido = sugerirDesdeReceta([comp("MATERIAL", "a", "1.5"), comp("MATERIAL", "a", "0.25"), comp("MAQUINA", "m", "0.5"), comp("MAQUINA", "m", "0.5")], "2");
  comprobar("un componente repetido se suma", `${resumen(repetido.materiales)}|${resumen(repetido.maquinas)}`, "a=3.5|m=120");

  const fino = sugerirDesdeReceta([comp("MATERIAL", "a", "0.3333"), comp("MAQUINA", "m", "0.0333")], "1");
  comprobar("material redondea a 3 decimales", resumen(fino.materiales), "a=0.333");
  comprobar("minutos redondean a 2 decimales (0,0333 h = 1,998 min)", resumen(fino.maquinas), "m=2");

  const orden = sugerirDesdeReceta([comp("MATERIAL", "b", "1"), comp("MATERIAL", "a", "1")], "1");
  comprobar("resultado ordenado y estable", resumen(orden.materiales), "a=1,b=1");

  const servicio = [comp("MATERIAL", "x", "2")];
  comprobar("la sugerencia incluye materiales de un servicio", resumen(sugerirDesdeReceta(servicio, "1").materiales), "x=2");
  comprobar("pero un servicio no descontó stock", String(consumoDeRecetaEnStock(servicio, "1", true).length), "0");
  comprobar("lo que descontó la venta de un artículo común", resumen(consumoDeRecetaEnStock(servicio, "3", false)), "x=6");
}

console.log("--- Validación de la carga ---");
{
  const ok = { minutosManoObra: d(0), tiempos: [{ maquinaId: "m1", minutos: d(30) }], consumos: [{ materialId: "a", cantidad: d("1.5") }] };
  comprobar("carga válida", String(validarCarga(ok)), "null");
  comprobar("solo mano de obra alcanza", String(validarCarga({ minutosManoObra: d(10), tiempos: [], consumos: [] })), "null");
  comprobar("solo un material alcanza", String(validarCarga({ minutosManoObra: d(0), tiempos: [], consumos: ok.consumos })), "null");
  comprobar("ceros explícitos son válidos (una fila en 0)", String(validarCarga({ minutosManoObra: d(0), tiempos: [{ maquinaId: "m", minutos: d(0) }], consumos: [] })), "null");
  comprobar("vacía no es válida", String(validarCarga({ minutosManoObra: d(0), tiempos: [], consumos: [] })).includes("al menos"), "true");
  comprobar("minutos de máquina negativos", String(validarCarga({ ...ok, tiempos: [{ maquinaId: "m", minutos: d(-1) }] })).includes("negativos"), "true");
  comprobar("mano de obra negativa", String(validarCarga({ ...ok, minutosManoObra: d(-1) })).includes("negativos"), "true");
  comprobar("cantidad de material negativa", String(validarCarga({ ...ok, consumos: [{ materialId: "a", cantidad: d(-0.001) }] })).includes("negativa"), "true");
  comprobar("máquina repetida", String(validarCarga({ ...ok, tiempos: [{ maquinaId: "m", minutos: d(1) }, { maquinaId: "m", minutos: d(2) }] })).includes("repetida"), "true");
  comprobar("material repetido", String(validarCarga({ ...ok, consumos: [{ materialId: "a", cantidad: d(1) }, { materialId: "a", cantidad: d(2) }] })).includes("repetido"), "true");
  comprobar("minutos que no entran en la columna", String(validarCarga({ ...ok, minutosManoObra: d("100000") })).includes("demasiados"), "true");
  comprobar("cantidad que no entra en la columna", String(validarCarga({ ...ok, consumos: [{ materialId: "a", cantidad: d("1000000000") }] })).includes("demasiado"), "true");
}

console.log("--- Ajuste de stock por la diferencia ---");
{
  const receta = [{ materialId: "a", cantidad: d(2) }, { materialId: "b", cantidad: d(5) }];
  const movs = (filas: ReturnType<typeof calcularAjusteDeStock>) => filas.filter((f) => !f.movimiento.isZero()).map((f) => `${f.materialId}:${f.movimiento}`).join(",");

  const masDeLoPrevisto = calcularAjusteDeStock({ receta, real: [{ materialId: "a", cantidad: d("2.5") }], yaAjustado: [] });
  comprobar("se usó de más: el stock baja la diferencia", movs(masDeLoPrevisto), "a:-0.5");
  comprobar("diferencia = real − receta", masDeLoPrevisto[0]!.diferencia.toString(), "0.5");

  const menos = calcularAjusteDeStock({ receta, real: [{ materialId: "b", cantidad: d(4) }], yaAjustado: [] });
  comprobar("se usó de menos: el stock sube", movs(menos), "b:1");

  const igual = calcularAjusteDeStock({ receta, real: [{ materialId: "a", cantidad: d(2) }], yaAjustado: [] });
  comprobar("igual a la receta: nada que ajustar", movs(igual), "");

  const noEnReceta = calcularAjusteDeStock({ receta, real: [{ materialId: "z", cantidad: d(1) }], yaAjustado: [] });
  comprobar("material fuera de la receta: baja todo lo usado", movs(noEnReceta), "z:-1");

  const noCargado = calcularAjusteDeStock({ receta, real: [{ materialId: "a", cantidad: d(2) }], yaAjustado: [] });
  comprobar("un material de la receta que no se cargó no se toca", String(noCargado.some((f) => f.materialId === "b")), "false");
  const enCero = calcularAjusteDeStock({ receta, real: [{ materialId: "b", cantidad: d(0) }], yaAjustado: [] });
  comprobar("cargarlo en 0 sí devuelve lo que la receta descontó", movs(enCero), "b:5");

  // Idempotencia: ya se ajustó −0,5 → repetir no mueve nada.
  const repetido = calcularAjusteDeStock({ receta, real: [{ materialId: "a", cantidad: d("2.5") }], yaAjustado: [{ materialId: "a", cantidad: d("-0.5") }] });
  comprobar("nunca doble descuento: repetir el ajuste no mueve nada", movs(repetido), "");
  // Corrección: se recarga con 3 (diferencia 1) y ya se había ajustado −0,5 → solo −0,5 más.
  const corregido = calcularAjusteDeStock({ receta, real: [{ materialId: "a", cantidad: d(3) }], yaAjustado: [{ materialId: "a", cantidad: d("-0.5") }] });
  comprobar("recarga mayor: solo la diferencia nueva", movs(corregido), "a:-0.5");
  // Corrección a la baja: se recarga igual a la receta y ya se había ajustado −0,5 → devuelve +0,5.
  const devuelve = calcularAjusteDeStock({ receta, real: [{ materialId: "a", cantidad: d(2) }], yaAjustado: [{ materialId: "a", cantidad: d("-0.5") }] });
  comprobar("recarga igual a la receta: devuelve lo ajustado", movs(devuelve), "a:0.5");
  // Varios ajustes previos se suman.
  const varios = calcularAjusteDeStock({ receta, real: [{ materialId: "a", cantidad: d(4) }], yaAjustado: [{ materialId: "a", cantidad: d(-1) }, { materialId: "a", cantidad: d("-0.5") }] });
  comprobar("ajustes previos acumulados", movs(varios), "a:-0.5");

  const servicio = calcularAjusteDeStock({ receta: consumoDeRecetaEnStock([comp("MATERIAL", "a", "2")], "1", true), real: [{ materialId: "a", cantidad: d(2) }], yaAjustado: [] });
  comprobar("un servicio no descontó nada: se ajusta todo lo usado", movs(servicio), "a:-2");

  comprobar("la marca identifica la línea", motivoDeAjusteProduccion({ numero: 7, anio: 2026 }, "uuid-1").includes(marcaDeLinea("uuid-1")), "true");
  comprobar("el motivo nombra la venta", motivoDeAjusteProduccion({ numero: 7, anio: 2026 }, "uuid-1").includes("#7/2026"), "true");
}

console.log("--- Costo real con costos congelados (lo usa el margen real, solo dueño) ---");
{
  // 2 kg a $100 + 90 min de laser a $600/h + 30 min de mano de obra a $400/h = 200 + 900 + 200.
  const costo = costoRealDeTrabajo({
    consumos: [{ cantidad: d(2), costoUnitarioSnapshot: d(100) }],
    tiempos: [{ minutos: d(90), costoHoraSnapshot: d(600) }],
    minutosManoObra: d(30),
    costoHoraManoObraSnapshot: d(400),
  });
  comprobar("Σ cantidad×costo + Σ min/60×costo/h + MO/60×costo/h", costo.toString(), "1300");
  const fraccion = costoRealDeTrabajo({ consumos: [], tiempos: [{ minutos: d(10), costoHoraSnapshot: d(100) }], minutosManoObra: d(0), costoHoraManoObraSnapshot: d(0) });
  comprobar("10 min a $100/h = $16,67", fraccion.toString(), "16.67");
  comprobar("trabajo sin nada = 0", costoRealDeTrabajo({ consumos: [], tiempos: [], minutosManoObra: d(0), costoHoraManoObraSnapshot: d(500) }).toString(), "0");
}

console.log("--- Listado: filtro y búsqueda ---");
{
  comprobar("sin filtro: sin cargar", parsearFiltro(undefined), "pendientes");
  comprobar("cargadas", parsearFiltro("cargadas"), "cargadas");
  comprobar("todas", parsearFiltro("todas"), "todas");
  comprobar("filtro raro vuelve al de por defecto", parsearFiltro("DROP TABLE"), "pendientes");
  comprobar("filtro repetido toma el primero", parsearFiltro(["cargadas", "todas"]), "cargadas");
  comprobar("búsqueda sin espacios sobrantes", parsearBusqueda("  vinilo "), "vinilo");
  comprobar("búsqueda acotada", String(parsearBusqueda("x".repeat(200)).length), "60");
  comprobar("búsqueda ausente", parsearBusqueda(undefined), "");
  comprobar("número de venta", String(numeroDeVentaEnBusqueda("12")), "12");
  comprobar("número de venta con # y año", String(numeroDeVentaEnBusqueda("#12/2026")), "12");
  comprobar("un texto no es un número", String(numeroDeVentaEnBusqueda("vinilo")), "null");
  comprobar("un número gigante no se interpreta", String(numeroDeVentaEnBusqueda("12345678901234")), "null");
}

console.log("--- Formato de minutos ---");
{
  comprobar("menos de una hora", fmtMinutos("45"), "45 min");
  comprobar("una hora justa", fmtMinutos("60"), "1 h");
  comprobar("hora y minutos", fmtMinutos("90"), "1 h 30 min");
  comprobar("decimales con coma", fmtMinutos("1.5"), "1,5 min");
  comprobar("cero", fmtMinutos("0"), "0 min");
}

console.log("--- Las pantallas del empleado no tocan costos ---");
{
  // Las consultas y las pantallas de /produccion las ve el empleado: ni una referencia a costos
  // (se ignoran los comentarios). Los snapshots los escribe el dominio, que no es de pantalla.
  const raiz = join(__dirname, "..", "src");
  const archivos: string[] = [join(raiz, "lib", "queries", "produccion.ts")];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(nombre)) archivos.push(ruta);
    }
  };
  recorrer(join(raiz, "app", "produccion"));
  // 6.3 es dueña de /produccion/estimar y 6.2 puede leer costos fuera de estas carpetas: solo se miran los de 6.1.
  const propios = archivos.filter((a) => !a.includes(`${join("app", "produccion", "estimar")}`));
  comprobar("archivos revisados", String(propios.length >= 9), "true");
  for (const a of propios) {
    const sinComentarios = readFileSync(a, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const costo = /\bcosto|margen|precioVenta|snapshot/i.test(sinComentarios) || /[a-z]Costo/.test(sinComentarios);
    comprobar(`${a.slice(raiz.length + 1)}: sin costos ni márgenes`, String(costo), "false");
  }
}

console.log("");
if (fallos > 0) {
  console.log(`${fallos} comprobacion(es) fallaron.`);
  process.exit(1);
}
console.log("Todas las comprobaciones pasaron.");
