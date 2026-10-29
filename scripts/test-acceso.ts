/**
 * Test de regresion de autorizacion POR HTTP, contra la app de verdad.
 *
 *   npm run test:acceso
 *
 * Lo que las otras pruebas (`test:permisos`, `test:auth:db`) verifican llamando
 * al codigo, esta lo verifica como lo veria un navegador (o un atacante): se
 * levanta `next build && next start` y se le pide cada ruta con `fetch`, sin
 * seguir redirecciones. Cubre las tres capas juntas (proxy, guarda de cada
 * pagina, route handler) y, sobre todo, lo que ninguna prueba en proceso puede
 * ver: lo que realmente viaja en el HTML y en el flujo RSC.
 *
 * COMO CORRE (todo propio, no toca tus datos)
 *  1. Toma `DATABASE_URL` (de .env o del entorno) SOLO para saber servidor,
 *     usuario y clave. Crea una base PROPIA llamada `ventas_acceso` en ese
 *     servidor (la borra primero si habia una vieja), le aplica las migraciones
 *     (`prisma migrate deploy`) y el seed, y la destruye al terminar. Se niega a
 *     correr si `DATABASE_URL` ya apunta a `ventas_acceso`. `ACCESO_BASE=ventas_acceso_x`
 *     cambia el nombre (siempre empieza con `ventas_acceso`); `ACCESO_CONSERVAR=1`
 *     no la borra (queda con los usuarios de prueba borrados) para investigar.
 *  2. Siembra costos DISTINTIVOS (p. ej. el vinil cuesta 7.531,27) para que un
 *     costo filtrado no se confunda con un precio de venta.
 *  3. Hace `next build` (siempre, para probar el codigo actual; `ACCESO_SIN_BUILD=1`
 *     reutiliza `.next`) y arranca `next start -p 3103` como proceso hijo (se lo
 *     mata por PID al final, nunca por nombre). Si el puerto esta ocupado, aborta:
 *     liberalo con `fuser -k 3103/tcp`.
 *  4. Crea en la base usuarios de prueba (dueno, empleado, dueno dado de baja) y
 *     sus sesiones con las funciones de `src/lib/auth-pura.ts` (token aleatorio +
 *     SHA-256 en `sesiones`), y las manda en la cabecera `Cookie`. Con `next start`
 *     NODE_ENV es production: la cookie se llama `__Host-ventas_sesion`; se envia a
 *     mano por HTTP plano contra 127.0.0.1. El login por HTTP plano NO se prueba
 *     (el navegador descartaria la cookie `Secure`); lo cubre `test:auth:db`.
 *
 * QUE VERIFICA
 *  1. Inventario: cada `page.tsx`, `route.ts`, ruta de metadatos y archivo de
 *     `public/` esta clasificado abajo (publica / dueno / ambos). Una ruta sin
 *     clasificar FALLA; una clasificada que ya no existe, avisa. Los segmentos
 *     dinamicos se instancian con ids reales del seed.
 *  2. Sin cookie: toda ruta no publica redirige a /login (o 401), tambien con
 *     `RSC: 1`, tambien las exportaciones CSV; y un POST (server action o
 *     formulario) no corre ni cambia la base.
 *  3. Empleado: las rutas de dueno lo mandan a /ventas/nueva (o 401/403); las de
 *     `ambos` responden 200.
 *  4. Sesion expirada y dueno dado de baja: se los trata como sin sesion.
 *  5. Fugas: el HTML y el RSC que recibe el empleado no contienen ningun costo,
 *     margen ni valorizacion sembrados (en formato es-AR con y sin separador de
 *     miles, decimales truncados, entero redondeado, `$`, y el valor crudo
 *     "7531.27" que podria colarse en el RSC). El detector se prueba solo: con
 *     cuerpos que contienen un costo tiene que marcarlo, y con numeros inocentes
 *     (precios, UUID) no. Ademas el dueno SI tiene que ver los costos (control
 *     positivo: si no, el detector estaria ciego).
 *
 * Sale con codigo 1 si algo falla, imprimiendo ruta + evidencia de cada falla.
 */
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { join, relative, sep } from "node:path";
import Decimal from "decimal.js";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { generarToken, hashDeToken, hashearClave, nombreCookie } from "../src/lib/auth-pura";

// ─── Configuracion ────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, "..");
const PUERTO = 3103;
const BASE_URL = `http://127.0.0.1:${PUERTO}`;
const NOMBRE_BASE = process.env.ACCESO_BASE ?? "ventas_acceso";
const COOKIE = nombreCookie(true); // __Host-ventas_sesion: la que usa `next start`
const CLAVE_DE_PRUEBA = "clave-de-prueba-acceso-83";
const DIA = 24 * 60 * 60 * 1000;

// ─── Clasificacion de rutas ───────────────────────────────────────────────────
// A mano, a proposito: si se derivara del codigo, un permiso mal puesto pasaria
// la prueba. `dueno` = solo DUENO (el empleado va a /ventas/nueva); `ambos` =
// DUENO y EMPLEADO; `publica` = sin sesion. Sale de `requierePermisoPagina(...)`
// de cada pagina y de la tabla de `src/lib/permisos-pura.ts`.
// Pendiente de la tarea 8.1: /listas-precios/** (solo dueno), /presupuestos/** y
// /cobranzas/hoy (ambos) todavia no verifican permisos; hasta que se integre, el
// empleado entra a /listas-precios/** y esta prueba lo marca como falla real.

type Clase = "publica" | "dueno" | "ambos";

const CLASIFICACION: Record<string, Clase> = {
  // Publicas: el login y lo que el `matcher` del proxy deja pasar (manifiesto, iconos, logo).
  "/login": "publica",
  "/manifest.webmanifest": "publica",
  "/icon.png": "publica",
  "/apple-icon.png": "publica",
  "/marca/*": "publica",
  // Solo dueno.
  "/": "dueno",
  "/catalogo": "dueno",
  "/catalogo/nuevo": "dueno",
  "/catalogo/[id]": "dueno",
  "/compras": "dueno",
  "/compras/nueva": "dueno",
  "/configuracion": "dueno",
  "/configuracion/maquinas/nueva": "dueno",
  "/configuracion/maquinas/[id]": "dueno",
  "/cortes": "dueno",
  "/listas-precios": "dueno",
  "/listas-precios/nueva": "dueno",
  "/listas-precios/[id]": "dueno",
  "/materiales/nuevo": "dueno",
  "/materiales/[id]/editar": "dueno",
  "/reportes": "dueno",
  "/reportes/stock": "dueno",
  "/reportes/export/[reporte]": "dueno",
  "/usuarios": "dueno",
  "/usuarios/nuevo": "dueno",
  "/usuarios/[id]": "dueno",
  // Ambos roles.
  "/clientes": "ambos",
  "/clientes/nuevo": "ambos",
  "/clientes/[id]": "ambos",
  "/clientes/[id]/editar": "ambos",
  "/cobranzas": "ambos",
  "/cobranzas/hoy": "ambos",
  "/materiales": "ambos",
  "/materiales/[id]": "ambos",
  "/presupuestos": "ambos",
  "/presupuestos/nuevo": "ambos",
  "/presupuestos/[id]": "ambos",
  "/presupuestos/[id]/editar": "ambos",
  "/presupuestos/[id]/imprimir": "ambos",
  "/reposicion": "ambos",
  "/usuarios/mi-clave": "ambos",
  "/ventas": "ambos",
  "/ventas/nueva": "ambos",
  "/ventas/[id]": "ambos",
};

const REPORTES_CSV = ["resumen", "ganancia-por-producto", "productos-rentables", "deuda-por-cliente", "consumo-materiales"];

// ─── Inventario de rutas a partir del codigo ──────────────────────────────────

type Ruta = { patron: string; archivo: string; archivos?: string[] };

function archivosDe(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivosDe(ruta, salida);
    else salida.push(ruta);
  }
  return salida;
}

/** `src/app/ventas/[id]/page.tsx` → `/ventas/[id]`; los grupos `(x)` no cuentan en la URL. */
function patronDe(dirRelativo: string): string {
  const partes = dirRelativo.split(sep).filter((p) => p !== "" && !(p.startsWith("(") && p.endsWith(")")));
  return "/" + partes.join("/");
}

/** Devuelve las rutas y los archivos de `src/app` que no se pudieron mapear (para fallar fuerte). */
function inventario(): { rutas: Ruta[]; sinMapear: string[] } {
  const rutas: Ruta[] = [];
  const sinMapear: string[] = [];
  const app = join(RAIZ, "src", "app");
  for (const archivo of archivosDe(app)) {
    const rel = relative(app, archivo);
    const nombre = rel.split(sep).pop()!;
    const dir = rel.split(sep).slice(0, -1).join(sep);
    if (/^(page|route)\.(tsx|ts|jsx|js)$/.test(nombre)) {
      rutas.push({ patron: patronDe(dir) === "/" ? "/" : patronDe(dir), archivo: `src/app/${rel}` });
    } else if (/^manifest\.(ts|js)$/.test(nombre)) {
      rutas.push({ patron: "/manifest.webmanifest", archivo: `src/app/${rel}` });
    } else if (/^(icon|apple-icon)\.(png|ico|jpg|svg)$/.test(nombre)) {
      rutas.push({ patron: `${patronDe(dir) === "/" ? "" : patronDe(dir)}/${nombre}`, archivo: `src/app/${rel}` });
    } else if (/^(sitemap|robots|opengraph-image|twitter-image|favicon)\./.test(nombre)) {
      sinMapear.push(`src/app/${rel}`); // sirve una URL y no sabemos cual: que alguien lo clasifique
    }
  }
  // public/: cada carpeta de primer nivel es una entrada `/<carpeta>/*`; un archivo suelto, su propia ruta.
  const publico = join(RAIZ, "public");
  if (existsSync(publico)) {
    const porPatron = new Map<string, Ruta>();
    for (const archivo of archivosDe(publico)) {
      const partes = relative(publico, archivo).split(sep);
      const patron = partes.length > 1 ? `/${partes[0]}/*` : `/${partes[0]}`;
      const ruta = porPatron.get(patron) ?? { patron, archivo: `public/${partes.join("/")}`, archivos: [] };
      ruta.archivos!.push("/" + partes.join("/"));
      porPatron.set(patron, ruta);
    }
    rutas.push(...porPatron.values());
  }
  return { rutas: rutas.sort((a, b) => a.patron.localeCompare(b.patron)), sinMapear };
}

// ─── Detector de fugas ────────────────────────────────────────────────────────
// Dado un valor sensible (costo, ganancia, valorizacion, margen), genera las
// formas en que podria aparecer en el HTML o en el RSC y las busca con limites
// que evitan coincidencias dentro de otros numeros, UUID, hashes o nombres de
// archivo. Es la parte que mas importa que no falle callada: tiene auto-test.

type Forma = { texto: string; re: RegExp };
type Sensible = { categoria: string; detalle: string; valor: Decimal; formas: Forma[] };

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const agrupar = (entero: string) => entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Limites. Izquierda: no pegado a una letra, digito, `/`, `-` ni a un numero mas
// largo ("1.7.531,27"). Derecha segun el tipo de forma (ver `construir`).
const IZQ_ES = String.raw`(?<![\w/-])(?<!\d[.,])`;
const IZQ_CRUDO = String.raw`(?<![\w/.-])`;
const DER_DECIMALES = String.raw`(?!\d)`;
const DER_ENTERO = String.raw`(?![\w-]|[.,][\w])`; // "7531.js" o "7531-ab" no son un importe

function construir(texto: string, tipo: "decimales" | "entero" | "crudo" | "pct"): Forma {
  const izq = tipo === "crudo" ? IZQ_CRUDO : IZQ_ES;
  const der = tipo === "decimales" ? DER_DECIMALES : tipo === "entero" ? DER_ENTERO : "";
  const cuerpo = tipo === "pct" ? `${escapar(texto)}\\s?%` : escapar(texto);
  return { texto: tipo === "pct" ? `${texto}%` : texto, re: new RegExp(`${izq}${cuerpo}${der}`) };
}

/** Todas las formas en que un importe puede aparecer. `v` es positivo. */
function formasDeImporte(v: Decimal): Forma[] {
  const salida: Forma[] = [];
  const dos = v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const [e2, f2] = dos.toFixed(2).split(".") as [string, string];
  const piso = v.toDecimalPlaces(0, Decimal.ROUND_DOWN).toFixed(0);
  const redondeado = v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
  const f1 = v.toFixed(4).split(".")[1]!.slice(0, 1); // un decimal, truncado
  const f2trunc = v.toFixed(4).split(".")[1]!.slice(0, 2); // dos decimales, truncados
  const enteros = new Set([piso, redondeado]);
  const dec = new Set<string>();
  for (const f of new Set([f2, f2trunc])) {
    dec.add(`${agrupar(e2)},${f}`);
    dec.add(`${e2},${f}`);
  }
  dec.add(`${agrupar(piso)},${f1}`); // "7.531,2": un decimal, truncado
  dec.add(`${piso},${f1}`);
  for (const t of dec) salida.push(construir(t, "decimales"));
  for (const e of enteros) {
    salida.push(construir(agrupar(e), "entero"));
    salida.push(construir(e, "entero"));
  }
  // Crudo, tal como lo guarda la base o lo serializaria el RSC: "7531.27", "7531.2700".
  const crudos = new Set([v.toFixed(2), v.toFixed(4), v.toString(), v.toFixed(3)]);
  for (const c of crudos) salida.push(construir(c, "crudo"));
  // Sin duplicados por texto.
  const vistos = new Set<string>();
  return salida.filter((f) => !vistos.has(f.texto) && vistos.add(f.texto));
}

/** Un porcentaje (margen) tal como lo muestra `fmtPorcentaje` ("35,2%") y con 2 decimales. */
function formasDePorcentaje(p: Decimal): Forma[] {
  const salida: Forma[] = [];
  const unico = new Set<string>();
  for (const dec of [1, 2]) {
    const t = p.toDecimalPlaces(dec, Decimal.ROUND_HALF_UP).toFixed(dec).replace(".", ",");
    if (!unico.has(t)) {
      unico.add(t);
      salida.push(construir(t, "pct"));
    }
  }
  return salida;
}

function sensible(categoria: string, detalle: string, valor: Decimal, tipo: "importe" | "pct" = "importe"): Sensible | null {
  if (tipo === "importe" && valor.abs().lt(1)) return null; // 0,5 no es distintivo
  const positivo = valor.abs();
  return { categoria, detalle, valor, formas: tipo === "pct" ? formasDePorcentaje(positivo) : formasDeImporte(positivo) };
}

/** Normaliza un cuerpo antes de buscar: sin comentarios de React ("35,2<!-- -->%"), con espacios normales. */
function normalizar(cuerpo: string): string {
  return cuerpo
    .replace(/<!--\s*-->/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;|\\u00a0|\u00a0|\u202f|\\u202f/gi, " ")
    .replace(/&quot;/g, '"');
}

type Fuga = { categoria: string; detalle: string; forma: string; fragmento: string };

function buscarFugas(cuerpo: string, sensibles: readonly Sensible[]): Fuga[] {
  const texto = normalizar(cuerpo);
  const fugas: Fuga[] = [];
  for (const s of sensibles) {
    for (const f of s.formas) {
      const m = f.re.exec(texto);
      if (m) {
        const desde = Math.max(0, m.index - 50);
        fugas.push({ categoria: s.categoria, detalle: s.detalle, forma: f.texto, fragmento: texto.slice(desde, m.index + m[0].length + 30).replace(/\s+/g, " ") });
        break; // una forma alcanza para marcar este valor
      }
    }
  }
  return fugas;
}

// ─── Resultados ───────────────────────────────────────────────────────────────

type Columna = "sinCookie" | "empleado" | "dueno" | "expirada" | "baja" | "post" | "fugas";
const COLUMNAS: Columna[] = ["sinCookie", "empleado", "dueno", "expirada", "baja", "post", "fugas"];
type Celda = "ok" | "FALLA";

type Fila = { patron: string; clase: Clase; url: string; celdas: Partial<Record<Columna, Celda>> };
const filas = new Map<string, Fila>();
const fallas: { url: string; columna: string; esperado: string; evidencia: string }[] = [];
const avisos: string[] = [];
let comprobaciones = 0;

function fila(patron: string, clase: Clase, url: string): Fila {
  let f = filas.get(url);
  if (!f) filas.set(url, (f = { patron, clase, url, celdas: {} }));
  return f;
}

function registrar(f: Fila, columna: Columna, ok: boolean, esperado: string, evidencia: string) {
  comprobaciones += 1;
  if (!ok) {
    f.celdas[columna] = "FALLA";
    fallas.push({ url: f.url, columna, esperado, evidencia });
  } else if (f.celdas[columna] !== "FALLA") {
    f.celdas[columna] = "ok";
  }
}

/** Comprobacion suelta (autotests, preparacion): no pertenece a una ruta. */
function comprobarSuelta(etiqueta: string, ok: boolean, evidencia = "") {
  comprobaciones += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}${!ok && evidencia ? ` (${evidencia})` : ""}`);
  if (!ok) fallas.push({ url: "(preparacion)", columna: etiqueta, esperado: "ok", evidencia });
}

// ─── Auto-test del detector ───────────────────────────────────────────────────

function autotestDelDetector() {
  console.log("--- Auto-test del detector de fugas ---");
  const costo = sensible("costo", "costo de prueba", new Decimal("7531.27"))!;
  const margen = sensible("margen", "margen de prueba", new Decimal("35.24"), "pct")!;
  const quedaMarcado = (cuerpo: string, s = costo) => buscarFugas(cuerpo, [s]).length === 1;

  const positivos: [string, string, Sensible?][] = [
    ["$ con separador de miles y decimales", "<td>$&nbsp;7.531,27</td>"],
    ["sin separador de miles", "<td>$ 7531,27</td>"],
    ["decimales truncados", "<td>$ 7.531,2</td>"],
    ["entero (fmtMonedaCorta)", "<td>$ 7.531</td>"],
    ["entero redondeado hacia arriba", "<td>$ 7.532</td>", sensible("costo", "costo con centavos altos", new Decimal("7531.87"))!],
    ["entero sin separador", '<span class="x">7531</span>'],
    ["crudo en el RSC (string)", '1:{"costoUnitario":"7531.2700","nombre":"Vinil"}'],
    ["crudo en el RSC (numero)", '1:{"costo":7531.27}'],
    ["en un arreglo del RSC", '1:["$","td",null,{"children":[3500,7531.27]}]'],
    ["con espacio fino (U+202F)", "<td>$\u202f7.531,27</td>"],
    ["partido por comentarios de React", "<td>$<!-- -->7.531<!-- -->,27</td>"],
    ["porcentaje", "<td>Margen 35,2%</td>", margen],
    ["porcentaje con dos decimales", "<td>35,24 %</td>", margen],
    ["porcentaje partido por comentario de React", "<td>35,2<!-- -->%</td>", margen],
  ];
  for (const [etiqueta, cuerpo, s] of positivos) {
    comprobarSuelta(`detecta: ${etiqueta}`, quedaMarcado(cuerpo, s ?? costo), cuerpo);
  }

  const negativos: [string, string, Sensible?][] = [
    ["un precio de venta cualquiera", "<td>$ 3.500,00</td><td>28.000</td>"],
    ["el costo dentro de un UUID", '<a href="/ventas/a1b2c3d4-7531-4e27-9f00-123456789abc">v</a>'],
    ["el costo dentro de un numero mas largo", "<td>$ 17.531,27</td><td>1.7531</td>"],
    ["parte de un nombre de archivo", '<script src="/_next/static/chunks/7531.js"></script>'],
    ["parte de un hash", '<script src="/_next/static/chunks/a7531b-xyz.js"></script>'],
    ["otro margen", "<td>35,3%</td><td>135,2%</td>", margen],
    ["un 35,2 sin porcentaje", "<td>35,2 kg</td>", margen],
  ];
  for (const [etiqueta, cuerpo, s] of negativos) {
    comprobarSuelta(`no marca: ${etiqueta}`, !quedaMarcado(cuerpo, s ?? costo), cuerpo);
  }
  // Una forma que se descarta por colision (ver `descartarColisiones`) no debe seguir marcando.
  const colisiona = sensible("costo", "x", new Decimal("3500.50"))!;
  descartarColisiones([colisiona], new Set(formasDeImporte(new Decimal("3500.5")).map((f) => f.texto)), []);
  comprobarSuelta("colision con un numero inocente: se descarta la forma", !buscarFugas("<td>3.500,50</td>", [colisiona]).length);
}

// ─── Colisiones con numeros inocentes ─────────────────────────────────────────
// Un costo que casualmente vale lo mismo que un precio de venta daria una falsa
// alarma. Las formas que coinciden con algun numero NO sensible (precios,
// totales, cobros, cantidades, IVA) se descartan y se avisa: es la unica excepcion.

function descartarColisiones(sensibles: Sensible[], inocentes: Set<string>, descartes: string[]) {
  for (const s of sensibles) {
    s.formas = s.formas.filter((f) => {
      const choca = inocentes.has(f.texto);
      if (choca) descartes.push(`${s.categoria} "${s.detalle}": forma "${f.texto}" coincide con un numero no sensible`);
      return !choca;
    });
  }
}

// ─── Base de datos propia ─────────────────────────────────────────────────────

function urlDeBase(original: string, nombre: string, conSchema: boolean): string {
  const u = new URL(original);
  u.pathname = `/${nombre}`;
  if (!conSchema) u.search = "";
  return u.toString();
}

async function recrearBase(adminUrl: string, nombre: string) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await admin.end();
  }
}

async function borrarBase(adminUrl: string, nombre: string) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

function correr(titulo: string, comando: string, args: string[], env: NodeJS.ProcessEnv) {
  console.log(`> ${titulo}`);
  const r = spawnSync(comando, args, { cwd: RAIZ, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.log(r.stdout?.slice(-3000) ?? "");
    console.log(r.stderr?.slice(-3000) ?? "");
    throw new Error(`"${titulo}" fallo (codigo ${r.status})`);
  }
}

// ─── Datos de prueba ──────────────────────────────────────────────────────────

const COSTOS_MATERIAL: Record<string, string> = {
  "Vinil adhesivo brillante": "7531.27",
  "Transportador (vinil transfer)": "1873.43",
  "Laminación brillante": "2964.81",
  "MDF 3mm": "6428.19",
  "Acrílico opalino 3mm": "31457.63",
};
const COSTO_HORA_MAQUINA: Record<string, string> = {
  "Plotter de impresión": "2971.37",
  "Láser CO2": "8613.29",
  "Viniladora": "1789.53",
};
const COSTO_HORA_MANO_OBRA = "4137.61";
const MARGEN_OBJETIVO = "47.3";

type Prisma = PrismaClient;

/** Pisa los costos del seed con valores unicos y con centavos, y deja ventas y compras coherentes con ellos. */
async function sembrarDistintivos(prisma: Prisma) {
  for (const [nombre, costo] of Object.entries(COSTOS_MATERIAL)) {
    await prisma.material.updateMany({ where: { nombre }, data: { costoUnitario: costo } });
  }
  for (const [nombre, costoHora] of Object.entries(COSTO_HORA_MAQUINA)) {
    await prisma.maquina.updateMany({ where: { nombre }, data: { costoHora } });
  }
  for (const [clave, valor] of [["costoHoraManoObra", COSTO_HORA_MANO_OBRA], ["margenObjetivo", MARGEN_OBJETIVO]] as const) {
    await prisma.configuracion.upsert({ where: { clave }, update: { valor }, create: { clave, valor } });
  }
  // Dos materiales bajo el minimo: asi la lista de reposicion tiene renglones con costo estimado para el dueno.
  await prisma.material.updateMany({ where: { nombre: "Acrílico opalino 3mm" }, data: { stockActual: "1.5" } });
  await prisma.material.updateMany({ where: { nombre: "Transportador (vinil transfer)" }, data: { stockActual: "8" } });
  const materiales = new Map((await prisma.material.findMany()).map((m) => [m.id, m]));

  // Compras: el costo de cada renglon es el del material (asi el costo "de compra" tambien es distintivo).
  for (const compra of await prisma.compra.findMany({ include: { items: true } })) {
    let total = new Decimal(0);
    for (const item of compra.items) {
      const costo = new Decimal(materiales.get(item.materialId)!.costoUnitario.toString());
      const subtotal = costo.times(item.cantidad.toString()).toDecimalPlaces(2);
      total = total.plus(subtotal);
      await prisma.compraItem.update({ where: { id: item.id }, data: { costoUnitario: costo.toString(), subtotal: subtotal.toString() } });
    }
    await prisma.compra.update({ where: { id: compra.id }, data: { total: total.toString() } });
  }

  // Ventas: costo congelado distinto en cada renglon, y el costo total de la venta es su suma.
  let k = 0;
  for (const venta of await prisma.venta.findMany({ orderBy: { numero: "asc" }, include: { items: { orderBy: { id: "asc" } } } })) {
    let costoTotal = new Decimal(0);
    for (const item of venta.items) {
      const unitario = new Decimal("1234.56").plus(new Decimal("321.19").times(k++));
      const total = unitario.times(item.cantidad.toString()).toDecimalPlaces(2);
      costoTotal = costoTotal.plus(total);
      await prisma.ventaItem.update({ where: { id: item.id }, data: { costoUnitarioSnapshot: unitario.toString(), costoTotalSnapshot: total.toString() } });
    }
    await prisma.venta.update({ where: { id: venta.id }, data: { costoTotal: costoTotal.toString() } });
  }
}

type Ids = { articulo: string; cliente: string; maquina: string; lista: string; material: string; presupuesto: string; venta: string; usuario: string };

/** Lo que el seed no trae (lista de precios y presupuesto) y los ids para instanciar las rutas dinamicas. */
async function prepararEjemplares(prisma: Prisma, usuarioId: string): Promise<Ids> {
  const articulo = (await prisma.articulo.findFirst({ where: { nombre: { startsWith: "Sticker" } } }))!;
  const cliente = (await prisma.cliente.findFirst({ orderBy: { nombre: "asc" } }))!;
  const maquina = (await prisma.maquina.findFirst({ orderBy: { nombre: "asc" } }))!;
  const material = (await prisma.material.findFirst({ where: { nombre: { startsWith: "Vinil" } } }))!;
  const lista = await prisma.listaPrecio.create({
    data: { nombre: "Lista de prueba (acceso)", descuentoPct: "10", items: { create: [{ articuloId: articulo.id, precio: "3100" }] } },
  });
  const presupuesto = await prisma.presupuesto.create({
    data: {
      numero: 1,
      anio: new Date().getFullYear(),
      clienteId: cliente.id,
      fecha: new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())),
      items: { create: [{ articuloId: articulo.id, descripcion: articulo.nombre, cantidad: "10", precioUnitario: "3500", ivaPct: "21" }] },
    },
  });
  // La venta con mas renglones: la pantalla de detalle muestra mas cosas.
  const ventas = await prisma.venta.findMany({ include: { _count: { select: { items: true } } }, orderBy: { numero: "asc" } });
  const venta = ventas.sort((a, b) => b._count.items - a._count.items)[0]!;
  return { articulo: articulo.id, cliente: cliente.id, maquina: maquina.id, lista: lista.id, material: material.id, presupuesto: presupuesto.id, venta: venta.id, usuario: usuarioId };
}

/** Ids con los que se instancia cada segmento dinamico. */
function ejemplares(ids: Ids): Record<string, string[]> {
  return {
    "/catalogo/[id]": [ids.articulo],
    "/clientes/[id]": [ids.cliente],
    "/clientes/[id]/editar": [ids.cliente],
    "/configuracion/maquinas/[id]": [ids.maquina],
    "/listas-precios/[id]": [ids.lista],
    "/materiales/[id]": [ids.material],
    "/materiales/[id]/editar": [ids.material],
    "/presupuestos/[id]": [ids.presupuesto],
    "/presupuestos/[id]/editar": [ids.presupuesto],
    "/presupuestos/[id]/imprimir": [ids.presupuesto],
    "/reportes/export/[reporte]": REPORTES_CSV,
    "/usuarios/[id]": [ids.usuario],
    "/ventas/[id]": [ids.venta],
  };
}

/** Los archivos de `public/` se piden uno por uno. */
function urlsConcretas(ruta: Ruta): string[] {
  return ruta.archivos ?? [ruta.patron];
}

// ─── Valores sensibles y valores inocentes (desde la base) ───────────────────

async function valoresSensibles(prisma: Prisma): Promise<{ sensibles: Sensible[]; inocentes: Set<string>; descartes: string[] }> {
  const D = (v: { toString(): string } | null | undefined) => new Decimal((v ?? 0).toString());
  const lista: (Sensible | null)[] = [];
  const inocentesDec: Decimal[] = [];

  const materiales = await prisma.material.findMany();
  let valorizacion = new Decimal(0);
  for (const m of materiales) {
    lista.push(sensible("costo de material", m.nombre, D(m.costoUnitario)));
    const val = D(m.stockActual).times(D(m.costoUnitario)).toDecimalPlaces(2);
    valorizacion = valorizacion.plus(val);
    lista.push(sensible("valorizacion de stock", m.nombre, val));
    inocentesDec.push(D(m.stockActual), D(m.stockMinimo), D(m.precioVenta));
  }
  lista.push(sensible("valorizacion de stock", "total", valorizacion));

  // Reposicion (factor 2, el de por defecto): cantidad = minimo × 2 − stock; costo estimado = cantidad × costo.
  let totalReposicion = new Decimal(0);
  for (const m of materiales) {
    if (D(m.stockMinimo).lte(0) || D(m.stockActual).gt(D(m.stockMinimo))) continue;
    const cantidad = D(m.stockMinimo).times(2).minus(D(m.stockActual));
    if (cantidad.lte(0)) continue;
    const estimado = cantidad.times(D(m.costoUnitario)).toDecimalPlaces(2);
    totalReposicion = totalReposicion.plus(estimado);
    lista.push(sensible("costo estimado de reposicion", m.nombre, estimado));
    inocentesDec.push(cantidad);
  }
  if (!totalReposicion.isZero()) lista.push(sensible("costo estimado de reposicion", "total de la compra sugerida", totalReposicion));

  for (const ci of await prisma.compraItem.findMany()) {
    lista.push(sensible("costo de compra", `renglon ${ci.id.slice(0, 8)}`, D(ci.costoUnitario)));
    lista.push(sensible("costo de compra", `subtotal ${ci.id.slice(0, 8)}`, D(ci.subtotal)));
    inocentesDec.push(D(ci.cantidad));
  }
  for (const c of await prisma.compra.findMany()) lista.push(sensible("costo de compra", `total ${c.id.slice(0, 8)}`, D(c.total)));

  let costoTodas = new Decimal(0);
  let brutoTodas = new Decimal(0);
  for (const v of await prisma.venta.findMany({ include: { items: true } })) {
    const costo = D(v.costoTotal);
    const bruto = D(v.totalBruto);
    const neto = D(v.totalNeto);
    const etiqueta = `venta ${v.anio}-${v.numero}`;
    costoTodas = costoTodas.plus(costo);
    brutoTodas = brutoTodas.plus(bruto);
    lista.push(sensible("costo de venta", etiqueta, costo));
    lista.push(sensible("ganancia", `${etiqueta} (sobre bruto)`, bruto.minus(costo)));
    lista.push(sensible("ganancia", `${etiqueta} (sobre neto)`, neto.minus(costo)));
    if (!bruto.isZero()) lista.push(sensible("margen", `${etiqueta} (sobre bruto)`, bruto.minus(costo).div(bruto).times(100), "pct"));
    if (!neto.isZero()) lista.push(sensible("margen", `${etiqueta} (sobre neto)`, neto.minus(costo).div(neto).times(100), "pct"));
    inocentesDec.push(neto, D(v.totalIVA), bruto);
    for (const it of v.items) {
      lista.push(sensible("costo de venta", `${etiqueta} renglon (unitario)`, D(it.costoUnitarioSnapshot)));
      lista.push(sensible("costo de venta", `${etiqueta} renglon (total)`, D(it.costoTotalSnapshot)));
      inocentesDec.push(D(it.cantidad), D(it.precioUnitario), D(it.subtotalNeto), D(it.subtotalIVA), D(it.subtotalBruto), D(it.ivaPct));
    }
  }
  lista.push(sensible("costo de venta", "suma de todas", costoTodas));
  lista.push(sensible("ganancia", "suma de todas", brutoTodas.minus(costoTodas)));
  if (!brutoTodas.isZero()) lista.push(sensible("margen", "global", brutoTodas.minus(costoTodas).div(brutoTodas).times(100), "pct"));

  for (const p of await prisma.pago.findMany()) inocentesDec.push(D(p.monto));
  const maquinas = await prisma.maquina.findMany();
  for (const m of maquinas) lista.push(sensible("costo de maquina", m.nombre, D(m.costoHora)));
  lista.push(sensible("costo de mano de obra", "hora", new Decimal(COSTO_HORA_MANO_OBRA)));
  lista.push(sensible("margen", "objetivo configurado", new Decimal(MARGEN_OBJETIVO), "pct"));

  // Costo teorico y margen de cada articulo, a partir de la receta (misma cuenta que `costearReceta`, sin overrides).
  const costoMaquina = new Map(maquinas.map((m) => [m.id, D(m.costoHora)]));
  const costoMaterial = new Map(materiales.map((m) => [m.id, D(m.costoUnitario)]));
  for (const a of await prisma.articulo.findMany({ include: { receta: { include: { componentes: true } } } })) {
    inocentesDec.push(D(a.precioVenta), D(a.ivaPct));
    if (!a.receta) continue;
    let costo = new Decimal(0);
    for (const c of a.receta.componentes) {
      const cant = D(c.cantidad);
      const unit = c.costoUnitarioOverride ? D(c.costoUnitarioOverride) : c.tipo === "MATERIAL" ? costoMaterial.get(c.materialId!)! : c.tipo === "MAQUINA" ? costoMaquina.get(c.maquinaId!)! : new Decimal(COSTO_HORA_MANO_OBRA);
      costo = costo.plus(cant.times(unit));
    }
    const precio = D(a.precioVenta);
    lista.push(sensible("costo de articulo", a.nombre, costo.toDecimalPlaces(2)));
    lista.push(sensible("costo de articulo", `${a.nombre} (4 decimales)`, costo.toDecimalPlaces(4)));
    lista.push(sensible("ganancia", `${a.nombre} (por unidad)`, precio.minus(costo).toDecimalPlaces(2)));
    if (!precio.isZero()) lista.push(sensible("margen", `${a.nombre}`, precio.minus(costo).div(precio).times(100), "pct"));
    if (!costo.isZero()) lista.push(sensible("margen", `${a.nombre} (recargo sobre costo)`, precio.minus(costo).div(costo).times(100), "pct"));
  }

  // Descarta duplicados exactos y nulos.
  const vistos = new Set<string>();
  const sensibles = lista.filter((s): s is Sensible => {
    if (!s) return false;
    const clave = `${s.categoria}|${s.valor.toFixed(4)}|${s.formas[0]?.texto.endsWith("%") === true}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });

  // Textos de los numeros inocentes, en las mismas formas que se buscan.
  const inocentes = new Set<string>();
  for (const v of inocentesDec) {
    if (v.isZero()) continue;
    for (const f of formasDeImporte(v.abs())) inocentes.add(f.texto);
    for (const f of formasDePorcentaje(v.abs())) inocentes.add(f.texto);
  }
  const descartes: string[] = [];
  descartarColisiones(sensibles, inocentes, descartes);
  return { sensibles: sensibles.filter((s) => s.formas.length > 0), inocentes, descartes };
}

// ─── Servidor ─────────────────────────────────────────────────────────────────

let servidor: ChildProcess | null = null;
let salidaServidor = "";

function puertoLibre(): Promise<boolean> {
  return new Promise((resolver) => {
    const socket = net.connect({ port: PUERTO, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolver(false); });
    socket.once("error", () => resolver(true));
  });
}

function arrancarServidor(env: NodeJS.ProcessEnv) {
  const next = join(RAIZ, "node_modules", "next", "dist", "bin", "next");
  // detached: el hijo lidera su propio grupo y se lo puede matar completo por PID (nunca por nombre).
  servidor = spawn(process.execPath, [next, "start", "-p", String(PUERTO), "-H", "127.0.0.1"], {
    cwd: RAIZ,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  servidor.stdout?.on("data", (d) => { salidaServidor = (salidaServidor + d).slice(-6000); });
  servidor.stderr?.on("data", (d) => { salidaServidor = (salidaServidor + d).slice(-6000); });
}

async function esperarServidor() {
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    if (servidor?.exitCode !== null) throw new Error(`next start termino (codigo ${servidor?.exitCode}):\n${salidaServidor}`);
    try {
      const r = await fetch(`${BASE_URL}/login`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
      await r.text();
      if (r.status === 200) return;
    } catch {
      // todavia no escucha
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`next start no respondio en 60 s:\n${salidaServidor}`);
}

async function detenerServidor() {
  const hijo = servidor;
  servidor = null;
  if (!hijo || hijo.pid === undefined || hijo.exitCode !== null) return;
  const termino = new Promise<void>((r) => hijo.once("exit", () => r()));
  try { process.kill(-hijo.pid, "SIGTERM"); } catch { /* ya termino */ }
  const timeout = new Promise<void>((r) => setTimeout(r, 5000));
  await Promise.race([termino, timeout]);
  if (hijo.exitCode === null) {
    try { process.kill(-hijo.pid, "SIGKILL"); } catch { /* ya termino */ }
    await Promise.race([termino, new Promise<void>((r) => setTimeout(r, 3000))]);
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

type Respuesta = { status: number; location: string | null; tipo: string; cuerpo: string; cabeceras: Headers };

type Pedido = { cookie?: string; rsc?: boolean; metodo?: string; cabeceras?: Record<string, string>; cuerpo?: string };

async function pedir(ruta: string, p: Pedido = {}): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { ...p.cabeceras };
  if (p.cookie) cabeceras["Cookie"] = `${COOKIE}=${p.cookie}`;
  if (p.rsc) cabeceras["RSC"] = "1";
  // Una navegacion RSC de verdad lleva `?_rsc=<hash>` (el hash sale de las cabeceras de navegacion;
  // sin ellas es vacio). Sin el parametro, Next contesta 307 para agregarlo.
  const destino = p.rsc ? `${ruta}${ruta.includes("?") ? "&" : "?"}_rsc=` : ruta;
  const r = await fetch(BASE_URL + destino, {
    method: p.metodo ?? "GET",
    redirect: "manual",
    headers: cabeceras,
    body: p.cuerpo,
    signal: AbortSignal.timeout(60_000),
  });
  const cuerpo = await r.text();
  return { status: r.status, location: r.headers.get("location"), tipo: r.headers.get("content-type") ?? "", cuerpo, cabeceras: r.headers };
}

const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);

function destinoDe(r: Respuesta): string | null {
  if (!REDIRECCIONES.has(r.status) || !r.location) return null;
  try {
    return new URL(r.location, BASE_URL).pathname;
  } catch {
    return null;
  }
}

function evidencia(r: Respuesta): string {
  const frag = r.cuerpo.replace(/\s+/g, " ").slice(0, 140);
  return `status ${r.status}, location ${r.location ?? "-"}, tipo ${r.tipo || "-"}, cuerpo "${frag}${r.cuerpo.length > 140 ? "…" : ""}"`;
}

/**
 * En una navegacion RSC, `redirect()` no es un 307: Next contesta 200 con el flujo y, dentro, el error
 * `{"digest":"NEXT_REDIRECT;replace;/ventas/nueva;307;"}` que el cliente convierte en navegacion.
 */
function redireccionRsc(r: Respuesta): string | null {
  if (r.status !== 200) return null;
  const m = /NEXT_REDIRECT;\w+;([^;"\\]+);/.exec(r.cuerpo);
  return m ? m[1]! : null;
}

const aLogin = (r: Respuesta) => (destinoDe(r) === "/login") || r.status === 401;

// ─── Sesiones de prueba ───────────────────────────────────────────────────────

type Sesiones = { dueno: string; empleado: string; duenoId: string; empleadoId: string; bajaId: string; baja: string };

async function crearSesionDirecta(prisma: Prisma, usuarioId: string, opciones: { vencida?: boolean } = {}): Promise<string> {
  const token = generarToken();
  const ahora = Date.now();
  // CHECK de la base: el vencimiento es posterior a la creacion. Una sesion vencida se crea "en el pasado".
  const creadaEn = new Date(opciones.vencida ? ahora - 40 * DIA : ahora);
  const expiraEn = new Date(opciones.vencida ? ahora - 10 * DIA : ahora + 30 * DIA);
  await prisma.sesion.create({ data: { tokenHash: hashDeToken(token), usuarioId, creadaEn, renovadaEn: creadaEn, expiraEn } });
  return token;
}

// ─── Prueba de cada ruta ──────────────────────────────────────────────────────

const ACCION_FALSA = "7f".padEnd(42, "0"); // id con forma de id de server action, que no existe

type Contexto = {
  prisma: Prisma;
  ses: Sesiones;
  sensibles: Sensible[];
  cuerposDueno: string[];
  cuerposEmpleado: Map<string, string>;
  /** Por pagina de `ambos`: cuantos valores sensibles ve el dueno y cuantos el empleado (el contraste que da sentido a "0 fugas"). */
  contraste: { url: string; dueno: number; empleado: number }[];
};

function sinFugas(f: Fila, columna: Columna, etiqueta: string, cuerpo: string, ctx: Contexto) {
  const fugas = buscarFugas(cuerpo, ctx.sensibles);
  registrar(
    f,
    columna,
    fugas.length === 0,
    `sin costos, margenes ni valorizaciones en ${etiqueta}`,
    fugas.map((x) => `${x.categoria} "${x.detalle}" como "${x.forma}" en …${x.fragmento}…`).join(" | "),
  );
}

async function probarRuta(patron: string, clase: Clase, url: string, ctx: Contexto) {
  const f = fila(patron, clase, url);
  const { ses } = ctx;

  // 1. Publica: se atiende sin sesion y listo (el resto de las columnas no aplica).
  if (clase === "publica") {
    const r = await pedir(url);
    registrar(f, "sinCookie", r.status === 200, "200 sin cookie (ruta publica)", evidencia(r));
    return;
  }

  // 2. Sin cookie: a /login o 401, en navegacion normal y en navegacion RSC.
  for (const rsc of [false, true]) {
    const r = await pedir(url, { rsc });
    registrar(f, "sinCookie", aLogin(r), `redireccion a /login o 401 sin cookie${rsc ? " (RSC)" : ""}`, evidencia(r));
    sinFugas(f, "sinCookie", `la respuesta sin cookie${rsc ? " (RSC)" : ""}`, r.cuerpo, ctx);
  }

  // 3. Empleado.
  const html = await pedir(url, { cookie: ses.empleado });
  const rsc = await pedir(url, { cookie: ses.empleado, rsc: true });
  for (const [r, nombre] of [[html, "HTML"], [rsc, "RSC"]] as const) {
    if (clase === "dueno") {
      const ok = destinoDe(r) === "/ventas/nueva" || redireccionRsc(r) === "/ventas/nueva" || r.status === 401 || r.status === 403;
      registrar(f, "empleado", ok, `empleado (${nombre}): redireccion a /ventas/nueva, 401 o 403`, evidencia(r));
    } else {
      const ok = r.status === 200 && redireccionRsc(r) === null;
      registrar(f, "empleado", ok, `empleado (${nombre}): 200 sin redireccion`, evidencia(r));
    }
    // Fugas: se mira lo que reciba el empleado SEA CUAL SEA el estado (una pagina de dueno que
    // le contesta 200 es doble falla: acceso y, probablemente, datos).
    sinFugas(f, "fugas", `lo que recibe el empleado (${nombre})`, r.cuerpo, ctx);
    if (r.status === 200) ctx.cuerposEmpleado.set(`${url} ${nombre}`, r.cuerpo);
  }

  // 4. Dueno: todo abre (control de que la ruta y el ejemplar existen) y se guardan los cuerpos para el control positivo.
  for (const rscDueno of [false, true]) {
    const r = await pedir(url, { cookie: ses.dueno, rsc: rscDueno });
    registrar(f, "dueno", r.status === 200 && redireccionRsc(r) === null, `dueno${rscDueno ? " (RSC)" : ""}: 200 sin redireccion`, evidencia(r));
    if (r.status === 200) ctx.cuerposDueno.push(r.cuerpo);
    if (clase === "ambos" && !rscDueno) {
      ctx.contraste.push({ url, dueno: buscarFugas(r.cuerpo, ctx.sensibles).length, empleado: buscarFugas(html.cuerpo, ctx.sensibles).length });
    }
  }

  // 5. Sesion expirada y dueno dado de baja: como no tener sesion. Una sesion nueva por pedido,
  //    porque el proxy borra la fila apenas la encuentra vencida o de un usuario inactivo.
  const vencida = await crearSesionDirecta(ctx.prisma, ses.duenoId, { vencida: true });
  const rVencida = await pedir(url, { cookie: vencida });
  registrar(f, "expirada", aLogin(rVencida), "sesion expirada: redireccion a /login o 401", evidencia(rVencida));
  const rVencidaRsc = await pedir(url, { cookie: await crearSesionDirecta(ctx.prisma, ses.duenoId, { vencida: true }), rsc: true });
  registrar(f, "expirada", aLogin(rVencidaRsc), "sesion expirada (RSC): redireccion a /login o 401", evidencia(rVencidaRsc));
  const rBaja = await pedir(url, { cookie: await crearSesionDirecta(ctx.prisma, ses.bajaId) });
  registrar(f, "baja", aLogin(rBaja), "usuario dado de baja con sesion vigente: redireccion a /login o 401", evidencia(rBaja));
  const rBajaRsc = await pedir(url, { cookie: await crearSesionDirecta(ctx.prisma, ses.bajaId), rsc: true });
  registrar(f, "baja", aLogin(rBajaRsc), "usuario dado de baja (RSC): redireccion a /login o 401", evidencia(rBajaRsc));
  // Y con una cookie inventada (formato valido, sin fila): lo mismo.
  const rTrucha = await pedir(url, { cookie: generarToken() });
  registrar(f, "sinCookie", aLogin(rTrucha), "cookie inventada: redireccion a /login o 401", evidencia(rTrucha));

  // 6. POST sin cookie: ni la server action ni el formulario corren.
  const accion = await pedir(url, {
    metodo: "POST",
    cabeceras: { "Next-Action": ACCION_FALSA, "Content-Type": "text/plain;charset=UTF-8" },
    cuerpo: "[]",
  });
  registrar(f, "post", accion.status === 401 || destinoDe(accion) === "/login", "POST de server action sin cookie: 401 o redireccion a /login", evidencia(accion));
  const form = await pedir(url, { metodo: "POST", cabeceras: { "Content-Type": "application/x-www-form-urlencoded" }, cuerpo: "a=b" });
  registrar(f, "post", form.status === 401 || destinoDe(form) === "/login", "POST de formulario sin cookie: 401 o redireccion a /login", evidencia(form));
}

// ─── Huella de la base: los pedidos rechazados no pueden escribir nada ────────

const TABLAS = ["ventas", "venta_items", "pagos", "compras", "compra_items", "movimientos_stock", "clientes", "materiales", "articulos", "recetas", "receta_componentes", "maquinas", "configuracion", "listas_precios", "lista_precio_items", "presupuestos", "presupuesto_items", "contactos_cobranza", "usuarios"];

/** Hash del contenido de cada tabla (no se mira `sesiones`: el proxy renueva su vencimiento al pasar). */
async function huella(prisma: Prisma): Promise<Record<string, string>> {
  const salida: Record<string, string> = {};
  for (const t of TABLAS) {
    const r = await prisma.$queryRawUnsafe<{ h: string | null; n: bigint }[]>(
      `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h, count(*)::bigint AS n FROM "${t}" x`,
    );
    salida[t] = `${r[0]!.n}:${r[0]!.h}`;
  }
  return salida;
}

function diferencias(antes: Record<string, string>, despues: Record<string, string>): string {
  return Object.keys(antes).filter((t) => antes[t] !== despues[t]).map((t) => `${t} (${antes[t]?.split(":")[0]} → ${despues[t]?.split(":")[0]} filas)`).join(", ");
}

// ─── Server actions por HTTP ──────────────────────────────────────────────────
// `next build` deja en `.next/server/server-reference-manifest.json` cada server
// action con su id, su archivo y su nombre: se las inventaria igual que a las
// rutas (una accion sin clasificar falla) y se las invoca de verdad con POST +
// cabecera `Next-Action`, sin cookie y con la sesion de cada rol.

const CLASIFICACION_ACCIONES: Record<string, Clase> = {
  "login/actions.ts#entrar": "publica",
  "login/actions.ts#salir": "publica", // sin sesion no hay nada que cerrar
  "catalogo/actions.ts#guardarArticulo": "dueno",
  "catalogo/actions.ts#cambiarActivoArticulo": "dueno",
  "clientes/actions.ts#crearCliente": "ambos",
  "clientes/actions.ts#editarCliente": "ambos",
  "clientes/actions.ts#cambiarActivoCliente": "ambos",
  "cobranzas/hoy/actions.ts#registrarContacto": "ambos",
  "compras/actions.ts#registrarCompra": "dueno",
  "configuracion/actions.ts#guardarConfiguracion": "dueno",
  "configuracion/actions.ts#crearMaquina": "dueno",
  "configuracion/actions.ts#editarMaquina": "dueno",
  "configuracion/actions.ts#cambiarActivoMaquina": "dueno",
  "listas-precios/actions.ts#crearLista": "dueno",
  "listas-precios/actions.ts#editarLista": "dueno",
  "listas-precios/actions.ts#cambiarActivoLista": "dueno",
  "listas-precios/actions.ts#guardarPrecioLista": "dueno",
  "listas-precios/actions.ts#quitarPrecioLista": "dueno",
  "materiales/actions.ts#crearMaterial": "dueno",
  "materiales/actions.ts#editarMaterial": "dueno",
  "materiales/actions.ts#cambiarEstadoMaterial": "dueno",
  "materiales/[id]/actions.ts#ajustarStock": "dueno",
  "presupuestos/actions.ts#crearPresupuesto": "ambos",
  "presupuestos/actions.ts#editarPresupuesto": "ambos",
  "presupuestos/actions.ts#anularPresupuesto": "ambos",
  "presupuestos/actions.ts#convertirPresupuesto": "ambos",
  "presupuestos/actions.ts#duplicarPresupuesto": "ambos",
  "reposicion/actions.ts#guardarFactorReposicion": "dueno",
  "usuarios/actions.ts#crearUsuario": "dueno",
  "usuarios/actions.ts#cambiarActivoUsuario": "dueno",
  "usuarios/actions.ts#cambiarRolUsuario": "dueno",
  "usuarios/actions.ts#resetearClaveUsuario": "dueno",
  "usuarios/actions.ts#cambiarMiClave": "ambos",
  "ventas/actions.ts#registrarVenta": "ambos",
  "ventas/nueva/actions.ts#preciosParaCliente": "ambos",
  "ventas/nueva/actions.ts#preciosParaPresupuesto": "ambos",
  "ventas/[id]/actions.ts#registrarPago": "ambos",
  "ventas/[id]/actions.ts#marcarEntregada": "ambos",
  "ventas/[id]/actions.ts#anularPago": "dueno",
  "ventas/[id]/actions.ts#anularVenta": "dueno",
};

type AccionHttp = { id: string; clave: string; paginas: string[] };

function accionesDelBuild(): AccionHttp[] {
  const ruta = join(RAIZ, ".next", "server", "server-reference-manifest.json");
  const manifiesto = JSON.parse(readFileSync(ruta, "utf8")) as { node: Record<string, { workers: Record<string, unknown>; filename: string; exportedName: string }> };
  return Object.entries(manifiesto.node).map(([id, a]) => ({
    id,
    clave: `${a.filename.replace(/^src\/app\//, "")}#${a.exportedName}`,
    paginas: Object.keys(a.workers).filter((w) => w.endsWith("/page") && !w.startsWith("app/_")).map((w) => patronDe(w.replace(/^app\//, "").replace(/\/page$/, ""))),
  }));
}

const MENSAJE_SIN_PERMISO = /No ten[eé]s permiso/;

async function probarAcciones(ctx: Contexto, instancias: Record<string, string[]>) {
  const acciones = accionesDelBuild();
  for (const a of acciones) {
    if (!(a.clave in CLASIFICACION_ACCIONES)) comprobarSuelta(`server action sin clasificar: ${a.clave}`, false, "agregala a CLASIFICACION_ACCIONES como publica, dueno o ambos");
  }
  const existentes = new Set(acciones.map((a) => a.clave));
  for (const clave of Object.keys(CLASIFICACION_ACCIONES)) if (!existentes.has(clave)) avisos.push(`accion clasificada pero ya no existe: ${clave}`);

  const { ses } = ctx;
  const hacer = (id: string, destino: string, cookie?: string) =>
    pedir(destino, { metodo: "POST", cookie, cabeceras: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, cuerpo: "[]" });
  const rechazada = (r: Respuesta) => r.status === 401 || r.status === 403 || MENSAJE_SIN_PERMISO.test(r.cuerpo);

  for (const a of acciones.sort((x, y) => x.clave.localeCompare(y.clave))) {
    const clase = CLASIFICACION_ACCIONES[a.clave];
    if (!clase || clase === "publica") continue;
    const patron = a.paginas[0];
    const valor = patron?.includes("[") ? instancias[patron]?.[0] : undefined;
    if (!patron || (patron.includes("[") && !valor)) {
      comprobarSuelta(`server action sin pagina para invocarla: ${a.clave}`, false, `paginas: ${a.paginas.join(", ") || "(ninguna)"}`);
      continue;
    }
    const destino = patron.replace(/\[[^\]]+\]/, valor ?? "");
    const f = fila(`accion ${a.clave}`, clase, `ACCION ${a.clave}`);

    // Sin cookie, por su pagina y por /login (Next la reenvia a la pagina de la accion y el proxy tiene que cortarla ahi).
    const rPagina = await hacer(a.id, destino);
    registrar(f, "sinCookie", rPagina.status === 401 || destinoDe(rPagina) === "/login", `POST sin cookie a ${destino}: 401 o redireccion a /login`, evidencia(rPagina));
    // Por /login (la unica ruta que el proxy atiende sin sesion): Next reenvia la accion a su pagina con un pedido
    // interno que vuelve a pasar por el proxy. Hoy contesta 200 con "{}" (el reenvio fallo y no se ejecuta nada) o 401;
    // lo que nunca puede pasar es que corra: el flujo traeria datos y la huella de la base cambiaria.
    const rLogin = await hacer(a.id, "/login");
    const sinEjecutar = rLogin.status === 401 || destinoDe(rLogin) === "/login" || (rLogin.status === 200 && rLogin.cuerpo.trim() === "{}");
    registrar(f, "sinCookie", sinEjecutar, "POST sin cookie a /login: 401, redireccion a /login o respuesta vacia \"{}\" (no corre)", evidencia(rLogin));
    // Sesion expirada y usuario dado de baja.
    const rv = await hacer(a.id, destino, await crearSesionDirecta(ctx.prisma, ses.duenoId, { vencida: true }));
    registrar(f, "expirada", rv.status === 401 || destinoDe(rv) === "/login", "POST con sesion expirada: 401 o redireccion a /login", evidencia(rv));
    const rb = await hacer(a.id, destino, await crearSesionDirecta(ctx.prisma, ses.bajaId));
    registrar(f, "baja", rb.status === 401 || destinoDe(rb) === "/login", "POST de un usuario dado de baja: 401 o redireccion a /login", evidencia(rb));

    // Empleado: las de dueno se rechazan; las de ambos no se rechazan por permiso. El cuerpo es basura a proposito:
    // la verificacion de permiso va antes que la validacion, asi que una accion prohibida contesta "No tenes permiso".
    const re = await hacer(a.id, destino, ses.empleado);
    if (clase === "dueno") registrar(f, "empleado", rechazada(re), "empleado: 401, 403 o \"No tenés permiso\" (no corre)", evidencia(re));
    else registrar(f, "empleado", !rechazada(re), "empleado: la accion no se rechaza por permiso", evidencia(re));
    // Dueno: nunca se rechaza por permiso (control de que el mensaje de rechazo se distingue del resto).
    const rd = await hacer(a.id, destino, ses.dueno);
    registrar(f, "dueno", !rechazada(rd), "dueno: la accion no se rechaza por permiso", evidencia(rd));
  }
}

// ─── Principal ────────────────────────────────────────────────────────────────

async function main() {
  autotestDelDetector();

  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("Falta DATABASE_URL (en .env o en el entorno): se usa para ubicar el servidor de Postgres.");
  if (!NOMBRE_BASE.startsWith("ventas_acceso")) throw new Error(`ACCESO_BASE debe empezar con "ventas_acceso" (es "${NOMBRE_BASE}").`);
  const nombreOriginal = new URL(original).pathname.replace(/^\//, "");
  if (nombreOriginal === NOMBRE_BASE) throw new Error(`DATABASE_URL ya apunta a "${NOMBRE_BASE}": usa otra para que la prueba pueda crearla y borrarla.`);
  if (!(await puertoLibre())) throw new Error(`El puerto ${PUERTO} esta ocupado. Liberalo con: fuser -k ${PUERTO}/tcp`);

  const adminUrl = urlDeBase(original, "postgres", false);
  const urlPrueba = urlDeBase(original, NOMBRE_BASE, true);
  // Entorno de los hijos: la base de prueba, y sin NODE_ENV heredado (next y prisma fijan el suyo).
  const entorno = Object.fromEntries(
    Object.entries({ ...process.env, DATABASE_URL: urlPrueba }).filter(([clave]) => clave !== "NODE_ENV"),
  ) as unknown as NodeJS.ProcessEnv;

  let prisma: Prisma | null = null;
  let baseCreada = false;
  try {
    console.log(`--- Preparacion (base propia "${NOMBRE_BASE}", servidor de DATABASE_URL) ---`);
    await recrearBase(adminUrl, NOMBRE_BASE);
    baseCreada = true;
    correr("prisma migrate deploy", "npx", ["prisma", "migrate", "deploy"], entorno);
    correr("prisma db seed", "npx", ["prisma", "db", "seed"], entorno);

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlPrueba }) });
    await sembrarDistintivos(prisma);

    // Usuarios de prueba: claves hasheadas con la funcion del repo (una sola vez; scrypt es caro a proposito).
    const hashClave = await hashearClave(CLAVE_DE_PRUEBA);
    const crear = (usuario: string, nombre: string, rol: "DUENO" | "EMPLEADO", activo = true) =>
      prisma!.usuario.create({ data: { usuario, nombre, rol, hashClave, activo } });
    const dueno = await crear("acceso.dueno", "Dueño de prueba (acceso)", "DUENO");
    const empleado = await crear("acceso.empleado", "Empleado de prueba (acceso)", "EMPLEADO");
    const baja = await crear("acceso.baja", "Dueño dado de baja (acceso)", "DUENO", false);
    const ses: Sesiones = {
      dueno: await crearSesionDirecta(prisma, dueno.id),
      empleado: await crearSesionDirecta(prisma, empleado.id),
      baja: await crearSesionDirecta(prisma, baja.id),
      duenoId: dueno.id,
      empleadoId: empleado.id,
      bajaId: baja.id,
    };

    const ids = await prepararEjemplares(prisma, dueno.id);
    const { sensibles, descartes } = await valoresSensibles(prisma);
    console.log(`Valores sensibles sembrados: ${sensibles.length} (${[...new Set(sensibles.map((s) => s.categoria))].join(", ")})`);
    for (const d of descartes) avisos.push(`colision descartada: ${d}`);
    // Auto-test sobre los valores reales: el detector tiene que marcar cada uno de los sembrados.
    const ciego = sensibles.filter((s) => buscarFugas(`<td>${s.formas[0]!.texto}</td>`, [s]).length !== 1);
    comprobarSuelta("el detector marca cada valor sensible real tal como se lo escribe", ciego.length === 0, ciego.map((s) => s.detalle).join(", "));
    const estanSembrados = sensibles.some((s) => s.formas.some((f) => f.texto === "7.531,27"));
    comprobarSuelta("el costo distintivo 7.531,27 esta entre los buscados", estanSembrados);

    // Build y servidor.
    if (process.env.ACCESO_SIN_BUILD === "1" && existsSync(join(RAIZ, ".next", "BUILD_ID"))) {
      console.log("> next build: omitido (ACCESO_SIN_BUILD=1), se usa .next existente");
    } else {
      correr("next build", "npm", ["run", "build"], entorno);
    }
    arrancarServidor({ ...entorno, NODE_ENV: "production", PORT: String(PUERTO) });
    await esperarServidor();
    console.log(`> next start escuchando en ${BASE_URL} (pid ${servidor?.pid})`);

    // Inventario.
    console.log("--- Inventario de rutas ---");
    const { rutas, sinMapear } = inventario();
    for (const s of sinMapear) comprobarSuelta(`archivo de ruta sin mapear: ${s}`, false, "sirve una URL que esta prueba no sabe calcular: clasificala a mano");
    const patrones = new Set(rutas.map((r) => r.patron));
    const sinClasificar = rutas.filter((r) => !(r.patron in CLASIFICACION));
    for (const r of sinClasificar) comprobarSuelta(`ruta sin clasificar: ${r.patron}`, false, `${r.archivo}: agregala a CLASIFICACION como publica, dueno o ambos`);
    for (const clave of Object.keys(CLASIFICACION)) {
      if (!patrones.has(clave)) avisos.push(`clasificada pero ya no existe: ${clave}`);
    }
    console.log(`${rutas.length} rutas en el codigo, ${rutas.length - sinClasificar.length} clasificadas`);

    const instancias = ejemplares(ids);
    const objetivos: { patron: string; clase: Clase; url: string }[] = [];
    for (const r of rutas) {
      const clase = CLASIFICACION[r.patron];
      if (!clase) continue;
      if (r.patron.includes("[")) {
        const valores = instancias[r.patron];
        if (!valores) {
          comprobarSuelta(`ruta dinamica sin ejemplar: ${r.patron}`, false, "agregala a ejemplares()");
          continue;
        }
        for (const v of valores) objetivos.push({ patron: r.patron, clase, url: r.patron.replace(/\[[^\]]+\]/, v) });
      } else {
        for (const url of urlsConcretas(r)) objetivos.push({ patron: r.patron, clase, url });
      }
    }

    // Prueba de cada ruta.
    console.log("--- Pedidos HTTP ---");
    const antes = await huella(prisma);
    const ctx: Contexto = { prisma, ses, sensibles, cuerposDueno: [], cuerposEmpleado: new Map(), contraste: [] };
    for (const o of objetivos) await probarRuta(o.patron, o.clase, o.url, ctx);

    // Server actions invocadas de verdad por HTTP (POST + Next-Action).
    console.log("--- Server actions por HTTP ---");
    await probarAcciones(ctx, instancias);
    const despues = await huella(prisma);
    comprobarSuelta("ningun pedido rechazado ni con basura escribio en la base", diferencias(antes, despues) === "", diferencias(antes, despues));

    // Control positivo por pagina: en las de `ambos` el dueno ve costos y el empleado no. Si el dueno no viera
    // ninguno en una pagina, "0 fugas" del empleado no probaria nada ahi; se lista cuales tienen contraste.
    console.log("--- Contraste dueno / empleado en las paginas de ambos roles ---");
    for (const c of ctx.contraste) console.log(`     ${c.url.padEnd(62)} dueno ve ${String(c.dueno).padStart(2)} valores sensibles, empleado ${c.empleado}`);
    const conContraste = ctx.contraste.filter((c) => c.dueno > 0);
    comprobarSuelta("hay paginas de ambos roles donde el dueno ve costos (el contraste prueba algo)", conContraste.length >= 2, `solo ${conContraste.length}`);
    comprobarSuelta("el detalle de un material (ambos) le muestra el costo al dueno y no al empleado", ctx.contraste.some((c) => c.url.startsWith("/materiales/") && c.dueno > 0 && c.empleado === 0), "sin contraste en /materiales/[id]");

    // Control positivo: el dueno SI tiene que ver los costos, o el detector estaria ciego en las paginas reales.
    console.log("--- Control positivo: lo que ve el dueno ---");
    const todo = ctx.cuerposDueno.join("\n");
    const vistos = new Map<string, number>();
    for (const x of buscarFugas(todo, sensibles)) vistos.set(x.categoria, (vistos.get(x.categoria) ?? 0) + 1);
    for (const [categoria, n] of [...vistos].sort()) console.log(`     ${categoria}: ${n} valores aparecen en las paginas del dueno`);
    for (const obligatoria of ["costo de material", "costo de venta", "ganancia", "margen", "valorizacion de stock", "costo de articulo", "costo estimado de reposicion"]) {
      comprobarSuelta(`el dueno ve "${obligatoria}" (el detector no esta ciego)`, (vistos.get(obligatoria) ?? 0) > 0, "ninguna pagina del dueno muestra un valor de esta categoria");
    }
  } finally {
    console.log("--- Limpieza ---");
    await detenerServidor();
    if (prisma) {
      try {
        await prisma.sesion.deleteMany({ where: { usuario: { usuario: { startsWith: "acceso." } } } });
        await prisma.usuario.deleteMany({ where: { usuario: { startsWith: "acceso." } } });
      } catch (error) {
        console.log("No se pudieron borrar los usuarios de prueba:", error instanceof Error ? error.message : error);
      }
      await prisma.$disconnect();
    }
    if (baseCreada && process.env.ACCESO_CONSERVAR !== "1") await borrarBase(adminUrl, NOMBRE_BASE);
    else if (baseCreada) console.log(`Base "${NOMBRE_BASE}" conservada (ACCESO_CONSERVAR=1).`);
  }
}

// ─── Informe ──────────────────────────────────────────────────────────────────

function informe() {
  console.log("");
  console.log("=== Ruta → clasificacion → resultado ===");
  const ancho = Math.max(...[...filas.values()].map((f) => f.url.length), 10);
  console.log(`${"ruta".padEnd(ancho)}  ${"clase".padEnd(7)}  ${COLUMNAS.map((c) => c.padEnd(9)).join(" ")}`);
  for (const f of [...filas.values()].sort((a, b) => a.patron.localeCompare(b.patron) || a.url.localeCompare(b.url))) {
    const celdas = COLUMNAS.map((c) => (f.celdas[c] ?? "-").padEnd(9)).join(" ");
    console.log(`${f.url.padEnd(ancho)}  ${f.clase.padEnd(7)}  ${celdas}`);
  }

  if (avisos.length > 0) {
    console.log("");
    console.log("=== Avisos ===");
    for (const a of avisos) console.log(`AVISO ${a}`);
  }

  console.log("");
  if (fallas.length > 0) {
    console.log("=== Fallas ===");
    for (const x of fallas) {
      console.log(`FALLA ${x.url} [${x.columna}]`);
      console.log(`      esperado: ${x.esperado}`);
      console.log(`      evidencia: ${x.evidencia}`);
    }
    console.log("");
    console.log(`${fallas.length} falla(s) en ${comprobaciones} comprobaciones.`);
    process.exit(1);
  }
  console.log(`Todas las comprobaciones pasaron (${comprobaciones}).`);
}

// Si se corta con Ctrl+C no puede quedar un `next start` huerfano ocupando el puerto.
for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    void detenerServidor().finally(() => process.exit(130));
  });
}

main()
  .then(informe)
  .catch(async (error) => {
    await detenerServidor();
    console.error("");
    console.error("La prueba no pudo completarse:", error instanceof Error ? (error.stack ?? error.message) : error);
    process.exit(1);
  });
