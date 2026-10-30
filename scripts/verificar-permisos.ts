/**
 * Verificacion de los permisos por rol (sin base, sin Next).
 *
 *   npm run test:permisos     (corre esto y despues scripts/test-permisos.ts, contra Postgres)
 *
 * Todas las tablas de abajo estan escritas A MANO desde el contrato de la ola 4,
 * a proposito: si se derivaran del codigo, un error en el codigo pasaria la
 * prueba. Se comparan contra `puede()` y contra lo que el codigo realmente exige:
 *
 *  1. La matriz rol × accion.
 *  2. Que permiso exige CADA server action (como primera sentencia) y CADA pagina.
 *  3. Que las entradas del navbar piden los mismos permisos que su pagina.
 *  4. Que el inicio de cada rol esta permitido para ese rol (si no, la redireccion daria vueltas).
 *  5. Que el auditor estatico detecta lo que tiene que detectar (prueba del probador).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inicioDeRol } from "../src/lib/auth-pura";
import { ACCIONES, PERMISOS, puede, puedeTodo, rutaDeInicio, type Accion } from "../src/lib/permisos-pura";
import {
  analizarActions,
  auditarAcciones,
  paginas,
  permisosDePagina,
  routeHandlers,
  verificaAntesDeLeer,
  verificaRouteHandler,
} from "./auditoria-permisos";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

// ─── 1. Matriz rol × accion (contrato de la ola 4, a mano) ─────────────────────

type Fila = { accion: Accion; DUENO: boolean; EMPLEADO: boolean };
const MATRIZ: Fila[] = [
  // Las 12 del contrato (+ las listas de precios de la ola 7): solo el dueno.
  { accion: "verCostos", DUENO: true, EMPLEADO: false },
  { accion: "verMargenes", DUENO: true, EMPLEADO: false },
  { accion: "anularVenta", DUENO: true, EMPLEADO: false },
  { accion: "anularPago", DUENO: true, EMPLEADO: false },
  { accion: "ajustarStock", DUENO: true, EMPLEADO: false },
  { accion: "registrarCompra", DUENO: true, EMPLEADO: false },
  { accion: "editarCatalogo", DUENO: true, EMPLEADO: false },
  { accion: "editarMateriales", DUENO: true, EMPLEADO: false },
  { accion: "verReportes", DUENO: true, EMPLEADO: false },
  { accion: "exportarCsv", DUENO: true, EMPLEADO: false },
  { accion: "configuracion", DUENO: true, EMPLEADO: false },
  { accion: "gestionarUsuarios", DUENO: true, EMPLEADO: false },
  { accion: "gestionarListasPrecios", DUENO: true, EMPLEADO: false },
  // Las que el empleado si puede: cargar ventas, cobrar, entregar, clientes, stock (cantidades), reposicion.
  { accion: "verVentas", DUENO: true, EMPLEADO: true },
  { accion: "cargarVenta", DUENO: true, EMPLEADO: true },
  { accion: "registrarCobro", DUENO: true, EMPLEADO: true },
  { accion: "marcarEntregada", DUENO: true, EMPLEADO: true },
  { accion: "verCobranzas", DUENO: true, EMPLEADO: true },
  { accion: "verClientes", DUENO: true, EMPLEADO: true },
  { accion: "editarClientes", DUENO: true, EMPLEADO: true },
  { accion: "verStock", DUENO: true, EMPLEADO: true },
  { accion: "verReposicion", DUENO: true, EMPLEADO: true },
  { accion: "cambiarClavePropia", DUENO: true, EMPLEADO: true },
  // Ola 7: presupuestos y recordatorios de cobranza (solo precios y saldos, nunca costos).
  { accion: "verPresupuestos", DUENO: true, EMPLEADO: true },
  { accion: "cargarPresupuesto", DUENO: true, EMPLEADO: true },
  { accion: "convertirPresupuesto", DUENO: true, EMPLEADO: true },
  { accion: "verRecordatorios", DUENO: true, EMPLEADO: true },
  { accion: "registrarContactoCobranza", DUENO: true, EMPLEADO: true },
  // Ola 5: facturacion electronica. Emitir una factura es del mostrador; deshacerla (nota de credito) es del dueno.
  { accion: "verComprobantes", DUENO: true, EMPLEADO: true },
  { accion: "emitirComprobante", DUENO: true, EMPLEADO: true },
  { accion: "emitirNotaCredito", DUENO: true, EMPLEADO: false },
];

// ─── 2. Que exige cada pagina y cada accion (a mano) ───────────────────────────

const PAGINAS_ESPERADAS: Record<string, Accion[]> = {
  "/": ["verCostos", "verMargenes"],
  "/catalogo": ["verCostos", "verMargenes"],
  "/catalogo/nuevo": ["editarCatalogo", "verCostos", "verMargenes"],
  "/catalogo/[id]": ["editarCatalogo", "verCostos", "verMargenes"],
  "/clientes": ["verClientes"],
  "/clientes/[id]": ["verClientes"],
  "/clientes/nuevo": ["editarClientes"],
  "/clientes/[id]/editar": ["editarClientes"],
  "/cobranzas": ["verCobranzas"],
  "/cobranzas/hoy": ["verRecordatorios"],
  "/comprobantes": ["verComprobantes"],
  "/comprobantes/[id]": ["verComprobantes"],
  "/comprobantes/[id]/imprimir": ["verComprobantes"],
  "/compras": ["registrarCompra", "verCostos"],
  "/compras/nueva": ["registrarCompra", "verCostos"],
  "/configuracion": ["configuracion"],
  "/configuracion/maquinas/nueva": ["configuracion"],
  "/configuracion/maquinas/[id]": ["configuracion"],
  "/cortes": ["verCostos"],
  "/listas-precios": ["gestionarListasPrecios"],
  "/listas-precios/nueva": ["gestionarListasPrecios"],
  "/listas-precios/[id]": ["gestionarListasPrecios"],
  "/materiales": ["verStock"],
  "/materiales/[id]": ["verStock"],
  "/materiales/nuevo": ["editarMateriales"],
  "/materiales/[id]/editar": ["editarMateriales", "verCostos", "verMargenes"],
  "/presupuestos": ["verPresupuestos"],
  "/presupuestos/nuevo": ["cargarPresupuesto"],
  "/presupuestos/[id]": ["verPresupuestos"],
  "/presupuestos/[id]/editar": ["cargarPresupuesto"],
  "/presupuestos/[id]/imprimir": ["verPresupuestos"],
  "/reportes": ["verReportes", "verCostos", "verMargenes"],
  "/reportes/stock": ["verReportes", "verCostos"],
  "/reposicion": ["verReposicion"],
  "/ventas": ["verVentas"],
  "/ventas/[id]": ["verVentas"],
  "/ventas/nueva": ["cargarVenta"],
};

const ACCIONES_ESPERADAS: Record<string, Accion> = {
  "catalogo/actions.ts#guardarArticulo": "editarCatalogo",
  "catalogo/actions.ts#cambiarActivoArticulo": "editarCatalogo",
  "clientes/actions.ts#crearCliente": "editarClientes",
  "clientes/actions.ts#editarCliente": "editarClientes",
  "clientes/actions.ts#cambiarActivoCliente": "editarClientes",
  "cobranzas/hoy/actions.ts#registrarContacto": "registrarContactoCobranza",
  // Ola 5 (5.5): facturar desde la venta. Emitir y resolver un pendiente son del mostrador (empleado incluido).
  "comprobantes/actions.ts#emitirFactura": "emitirComprobante",
  "comprobantes/actions.ts#resolverComprobantePendiente": "emitirComprobante",
  "compras/actions.ts#registrarCompra": "registrarCompra",
  "configuracion/actions.ts#guardarConfiguracion": "configuracion",
  "configuracion/actions.ts#guardarDatosFiscales": "configuracion",
  "configuracion/actions.ts#crearMaquina": "configuracion",
  "configuracion/actions.ts#editarMaquina": "configuracion",
  "configuracion/actions.ts#cambiarActivoMaquina": "configuracion",
  "listas-precios/actions.ts#crearLista": "gestionarListasPrecios",
  "listas-precios/actions.ts#editarLista": "gestionarListasPrecios",
  "listas-precios/actions.ts#cambiarActivoLista": "gestionarListasPrecios",
  "listas-precios/actions.ts#guardarPrecioLista": "gestionarListasPrecios",
  "listas-precios/actions.ts#quitarPrecioLista": "gestionarListasPrecios",
  "materiales/actions.ts#crearMaterial": "editarMateriales",
  "materiales/actions.ts#editarMaterial": "editarMateriales",
  "materiales/actions.ts#cambiarEstadoMaterial": "editarMateriales",
  "materiales/[id]/actions.ts#ajustarStock": "ajustarStock",
  // Anular un presupuesto no mueve stock ni caja y solo alcanza a uno que no se convirtio: lo decide quien los carga.
  "presupuestos/actions.ts#crearPresupuesto": "cargarPresupuesto",
  "presupuestos/actions.ts#editarPresupuesto": "cargarPresupuesto",
  "presupuestos/actions.ts#anularPresupuesto": "cargarPresupuesto",
  "presupuestos/actions.ts#duplicarPresupuesto": "cargarPresupuesto",
  "presupuestos/actions.ts#convertirPresupuesto": "convertirPresupuesto",
  "reposicion/actions.ts#guardarFactorReposicion": "configuracion",
  "ventas/actions.ts#registrarVenta": "cargarVenta",
  "ventas/[id]/actions.ts#anularVenta": "anularVenta",
  "ventas/[id]/actions.ts#registrarPago": "registrarCobro",
  "ventas/[id]/actions.ts#anularPago": "anularPago",
  "ventas/[id]/actions.ts#marcarEntregada": "marcarEntregada",
  "ventas/[id]/actions.ts#emitirNotaCredito": "emitirNotaCredito",
  // Dos acciones con el mismo cuerpo (solo precios): cada pantalla exige su propio permiso.
  "ventas/nueva/actions.ts#preciosParaCliente": "cargarVenta",
  "ventas/nueva/actions.ts#preciosParaPresupuesto": "cargarPresupuesto",
};

const lista = (xs: readonly string[]) => [...xs].sort().join(",");

function main() {
  console.log("--- Matriz rol × accion ---");
  comprobar("la matriz cubre todas las acciones de la tabla", lista(MATRIZ.map((f) => f.accion)), lista(ACCIONES));
  for (const f of MATRIZ) {
    comprobar(`DUENO ${f.accion}`, String(puede({ rol: "DUENO" }, f.accion)), String(f.DUENO));
    comprobar(`EMPLEADO ${f.accion}`, String(puede({ rol: "EMPLEADO" }, f.accion)), String(f.EMPLEADO));
    comprobar(`sin sesion ${f.accion}`, String(puede(null, f.accion)), "false");
    comprobar(`undefined ${f.accion}`, String(puede(undefined, f.accion)), "false");
  }
  comprobar("un rol inventado no puede nada", String(ACCIONES.some((a) => puede({ rol: "ADMIN" as never }, a))), "false");
  for (const rara of ["toString", "__proto__", "constructor", "hasOwnProperty", "", "verCostos "]) {
    comprobar(`accion rara ${JSON.stringify(rara)}: nadie`, String(puede({ rol: "DUENO" }, rara as Accion) || puede({ rol: "EMPLEADO" }, rara as Accion)), "false");
  }
  comprobar("puedeTodo: lista vacia no exige nada", String(puedeTodo({ rol: "EMPLEADO" }, [])), "true");
  comprobar("puedeTodo: basta una prohibida", String(puedeTodo({ rol: "EMPLEADO" }, ["verStock", "verCostos"])), "false");
  comprobar("puedeTodo: todas permitidas", String(puedeTodo({ rol: "EMPLEADO" }, ["verStock", "verReposicion"])), "true");
  comprobar("las listas de la tabla son solo roles conocidos", String(Object.values(PERMISOS).every((rs) => rs.every((r) => r === "DUENO" || r === "EMPLEADO"))), "true");

  console.log("--- Inicio de cada rol ---");
  comprobar("rutaDeInicio(DUENO) = inicioDeRol", rutaDeInicio("DUENO"), inicioDeRol("DUENO"));
  comprobar("rutaDeInicio(EMPLEADO) = inicioDeRol", rutaDeInicio("EMPLEADO"), inicioDeRol("EMPLEADO"));
  comprobar("el empleado empieza en /ventas/nueva", rutaDeInicio("EMPLEADO"), "/ventas/nueva");
  for (const rol of ["DUENO", "EMPLEADO"] as const) {
    const inicio = rutaDeInicio(rol);
    const exigidas = PAGINAS_ESPERADAS[inicio] ?? [];
    comprobar(`el inicio de ${rol} (${inicio}) tiene permisos esperados`, String(exigidas.length > 0), "true");
    comprobar(`${rol} puede entrar a su propio inicio (sin vuelta de redireccion)`, String(puedeTodo({ rol }, exigidas)), "true");
  }

  console.log("--- Permiso que exige cada server action ---");
  const acciones = auditarAcciones();
  for (const h of acciones.hallazgos) comprobar(`${h.archivo}: ${h.detalle}`, "hallazgo", "sin hallazgos");
  // `src/app/usuarios/**` (tarea 4.4) no tiene una fila por ruta: la regla es que TODO lo que haya ahi
  // exige `gestionarUsuarios`. Asi esta prueba sigue valiendo cuando se integre esa tarea.
  const deUsuarios = (clave: string) => clave.startsWith("usuarios/");
  comprobar("acciones auditadas", lista([...acciones.exigidas.keys()].filter((c) => !deUsuarios(c))), lista(Object.keys(ACCIONES_ESPERADAS)));
  for (const [clave, esperada] of Object.entries(ACCIONES_ESPERADAS)) {
    comprobar(`${clave}`, String(acciones.exigidas.get(clave)), esperada);
  }
  for (const [clave, exigida] of acciones.exigidas) {
    // Unica excepcion: cada usuario cambia su propia clave (cualquier rol, pide la actual).
    if (deUsuarios(clave)) comprobar(`${clave} (administracion de usuarios)`, String(exigida), clave.endsWith("#cambiarMiClave") ? "cambiarClavePropia" : "gestionarUsuarios");
  }
  const prohibidasParaEmpleado = Object.values(ACCIONES_ESPERADAS).filter((a) => !puede({ rol: "EMPLEADO" }, a)).length;
  console.log(`     (${prohibidasParaEmpleado} de ${Object.keys(ACCIONES_ESPERADAS).length} acciones estan prohibidas para el empleado)`);

  console.log("--- Permiso que exige cada pagina ---");
  const todas = paginas();
  const esDeUsuarios = (ruta: string) => ruta === "/usuarios" || ruta.startsWith("/usuarios/");
  comprobar("paginas auditadas", lista(todas.filter((p) => !esDeUsuarios(p.ruta)).map((p) => p.ruta)), lista(Object.keys(PAGINAS_ESPERADAS)));
  for (const p of todas.filter((x) => esDeUsuarios(x.ruta))) {
    const exigida = p.ruta === "/usuarios/mi-clave" ? "cambiarClavePropia" : "gestionarUsuarios";
    comprobar(`${p.ruta} (administracion de usuarios) exige ${exigida}`, String((permisosDePagina(p.texto) ?? []).includes(exigida as Accion)), "true");
    comprobar(`${p.ruta}: verifica antes de leer datos`, String(verificaAntesDeLeer(p.texto)), "true");
  }
  for (const p of todas) {
    const esperados = PAGINAS_ESPERADAS[p.ruta];
    if (!esperados) continue;
    comprobar(`${p.ruta}`, lista(permisosDePagina(p.texto) ?? ["(ninguno)"]), lista(esperados));
    comprobar(`${p.ruta}: verifica antes de leer datos`, String(verificaAntesDeLeer(p.texto)), "true");
  }

  console.log("--- Route handlers ---");
  const handlers = routeHandlers();
  comprobar("route handlers", lista(handlers.map((h) => h.archivo)), "reportes/export/[reporte]/route.ts");
  for (const h of handlers) {
    comprobar(`${h.archivo}: verifica sesion y permisos`, String(verificaRouteHandler(h.texto)), "true");
    for (const accion of ["exportarCsv", "verReportes", "verCostos", "verMargenes"]) {
      comprobar(`${h.archivo}: exige ${accion}`, String(h.texto.includes(`"${accion}"`)), "true");
    }
    comprobar(`${h.archivo}: 403 con texto, no redireccion`, String(/denegado\(403/.test(h.texto) && !/redirect\s*\(/.test(h.texto)), "true");
    comprobar(`${h.archivo}: pide sesion y permisos antes de leer el reporte`, String(h.texto.indexOf("usuarioActual()") < h.texto.indexOf("EXPORTACIONES.get(")), "true");
  }

  console.log("--- Costos en las listas de precios (ola 7) ---");
  const leerSrc = (...partes: string[]) => readFileSync(join(__dirname, "..", "src", ...partes), "utf8");
  const advertencia = leerSrc("app", "listas-precios", "_componentes", "advertencia-bajo-costo.tsx");
  comprobar(
    "AdvertenciaBajoCosto verifica verCostos ANTES de consultar costos",
    String(advertencia.includes('"verCostos"') && advertencia.indexOf('"verCostos"') < advertencia.indexOf("await getPreciosBajoCosto(")),
    "true",
  );
  comprobar(
    "la ficha de la lista solo pinta la advertencia con verCostos",
    String(/puede\(usuario, "verCostos"\) \? <AdvertenciaBajoCosto/.test(leerSrc("app", "listas-precios", "[id]", "page.tsx"))),
    "true",
  );

  console.log("--- Facturar desde la venta (ola 5, 5.5) ---");
  const panel = leerSrc("app", "ventas", "[id]", "_componentes", "factur-panel.tsx");
  comprobar(
    "FacturarPanel verifica verComprobantes ANTES de consultar la facturacion de la venta",
    String(panel.includes('"verComprobantes"') && panel.indexOf('"verComprobantes"') < panel.indexOf("await estadoFacturacionDeVenta(")),
    "true",
  );
  comprobar("el boton de facturar solo se pinta con emitirComprobante", String(/puedeEmitir = puede\(usuario, "emitirComprobante"\)/.test(panel) && /puedeEmitir \? \(\s*<div className="mt-3">\s*<FacturarBoton/.test(panel)), "true");
  comprobar("el enlace a Configuracion solo se pinta con configuracion", String(/puedeConfigurar = puede\(usuario, "configuracion"\)/.test(panel) && /a\.codigo === "DATOS_FISCALES" && puedeConfigurar/.test(panel)), "true");
  const consultasComprobantes = leerSrc("lib", "queries", "comprobantes.ts");
  comprobar("las consultas de comprobantes no leen costos ni margenes", String(/costo|margen/i.test(consultasComprobantes.replace(/^.*\/\/.*$/gm, ""))), "false");

  console.log("--- Navbar: cada entrada pide lo mismo que su pagina ---");
  const navbar = leerSrc("components", "navbar.tsx");
  // Algunas entradas usan una constante de ruta (`href: RUTA_RECORDATORIOS`): se resuelve contra su `const X = "/ruta"`.
  const rutas = new Map([...navbar.matchAll(/const ([A-Z_]+) = "(\/[^"]*)";/g)].map((m) => [m[1]!, m[2]!] as const));
  const entradas = [...navbar.matchAll(/href: (?:"(\/[^"]*)"|([A-Z_]+)),[^}]*?acciones: \[([^\]]*)\]/g)].map((m) => ({
    href: m[1] ?? rutas.get(m[2]!) ?? `(constante ${m[2]} sin resolver)`,
    acciones: [...m[3]!.matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]!),
  }));
  comprobar("entradas del navbar leidas", String(entradas.length), "16");
  for (const e of entradas) {
    if (e.href === "/usuarios") {
      comprobar("navbar /usuarios: solo con gestionarUsuarios (la pagina la crea 4.4)", lista(e.acciones), "gestionarUsuarios");
      continue;
    }
    const pagina = PAGINAS_ESPERADAS[e.href];
    comprobar(`navbar ${e.href}: pagina conocida`, String(pagina !== undefined), "true");
    if (pagina) comprobar(`navbar ${e.href}: mismos permisos que la pagina`, lista(e.acciones), lista(pagina));
  }
  const visibles = (rol: "DUENO" | "EMPLEADO") => entradas.filter((e) => puedeTodo({ rol }, e.acciones as Accion[])).map((e) => e.href);
  comprobar(
    "el empleado ve solo ventas, clientes, materiales, reposicion, presupuestos, comprobantes, cobranzas y recordatorios",
    lista(visibles("EMPLEADO")),
    lista(["/ventas", "/clientes", "/materiales", "/reposicion", "/presupuestos", "/comprobantes", "/cobranzas", "/cobranzas/hoy"]),
  );
  comprobar("el dueno ve las 16 entradas", String(visibles("DUENO").length), "16");

  console.log("--- El auditor detecta lo que tiene que detectar ---");
  const base = (cuerpo: string, extra = "") => `"use server";\n${extra}\nexport async function f(datos: { a: string }): Promise<{ ok: true } | { ok: false; error: string }> {\n${cuerpo}\n}\n`;
  const hallazgosDe = (texto: string) => analizarActions("x/actions.ts", texto).hallazgos.length;
  const conPermiso = `  const p = await verificarPermiso("anularVenta");\n  if (!p.ok) return p;\n  return { ok: true };`;
  comprobar("buena: verificarPermiso + if", String(hallazgosDe(base(conPermiso))), "0");
  comprobar("buena: requierePermiso", String(hallazgosDe(base(`  await requierePermiso("anularVenta");\n  return { ok: true };`))), "0");
  comprobar("buena: con llaves en el if", String(hallazgosDe(base(`  const p = await verificarPermiso("anularVenta");\n  if (!p.ok) { return p; }\n  return { ok: true };`))), "0");
  comprobar("mala: sin verificacion", String(hallazgosDe(base(`  return { ok: true };`)) > 0), "true");
  comprobar("mala: valida antes", String(hallazgosDe(base(`  const v = esquema.safeParse(datos);\n  ${conPermiso}`)) > 0), "true");
  comprobar("mala: lee la base antes", String(hallazgosDe(base(`  await prisma.venta.findMany();\n  ${conPermiso}`)) > 0), "true");
  comprobar("mala: verificacion dentro de un if", String(hallazgosDe(base(`  if (datos.a) {\n    await requierePermiso("anularVenta");\n  }\n  return { ok: true };`)) > 0), "true");
  comprobar("mala: verificarPermiso sin cortar si no puede", String(hallazgosDe(base(`  const p = await verificarPermiso("anularVenta");\n  return { ok: true };`)) > 0), "true");
  comprobar("mala: devuelve otra cosa", String(hallazgosDe(base(`  const p = await verificarPermiso("anularVenta");\n  if (!p.ok) return { ok: true };\n  return { ok: true };`)) > 0), "true");
  comprobar("mala: sin await", String(hallazgosDe(base(`  verificarPermiso("anularVenta");\n  return { ok: true };`)) > 0), "true");
  comprobar("mala: accion que no existe", String(hallazgosDe(base(`  await requierePermiso("hacerMagia");\n  return { ok: true };`)) > 0), "true");
  comprobar("mala: accion no literal", String(hallazgosDe(base(`  await requierePermiso(accion);\n  return { ok: true };`)) > 0), "true");
  comprobar("mala: solo comprueba la sesion", String(hallazgosDe(base(`  const s = await usuarioParaAccion();\n  if (!s.ok) return s;\n  return { ok: true };`)) > 0), "true");
  comprobar("mala: no es async", String(hallazgosDe(`"use server";\nexport function f() {\n  return 1;\n}\n`) > 0), "true");
  comprobar("mala: exporta una constante", String(hallazgosDe(base(conPermiso, "export const g = async () => 1;")) > 0), "true");
  comprobar("mala: re-exporta funciones", String(hallazgosDe(base(conPermiso, 'export { h } from "./otra";')) > 0), "true");
  comprobar("mala: sin directiva use server", String(hallazgosDe(base(conPermiso).replace('"use server";', "")) > 0), "true");
  comprobar("buena: tipos y constantes no exportadas", String(hallazgosDe(base(conPermiso, 'export type T = { a: string };\nconst x = 1;\nexport type { Resultado } from "./r";')) ), "0");
  comprobar("buena: llaves y regex dentro de cadenas no confunden", String(hallazgosDe(base(conPermiso, 'const re = /^[{(]\\d+"/;\nconst s = "}{ \\"";\nconst t = `${"}"}{`;')) ), "0");
  comprobar("mala: dos funciones, una sin verificar", String(hallazgosDe(`${base(conPermiso)}\nexport async function g() {\n  return 1;\n}\n`) ), "1");
  comprobar("pagina sin verificar", String(permisosDePagina("export default async function P() { return null; }")), "null");
  comprobar("pagina: lee antes de verificar", String(verificaAntesDeLeer('export default async function P() { const x = await getVentas(); await requierePermisoPagina("verVentas"); }')), "false");
  comprobar("pagina: verifica antes de leer", String(verificaAntesDeLeer('export default async function P() { await requierePermisoPagina("verVentas"); const x = await getVentas(); }')), "true");
  comprobar("route sin verificar", String(verificaRouteHandler("export async function GET() { return new Response(); }")), "false");

  console.log("");
  if (fallos > 0) {
    console.log(`${fallos} comprobacion(es) fallaron.`);
    process.exit(1);
  }
  console.log("Todas las comprobaciones pasaron.");
}

main();
