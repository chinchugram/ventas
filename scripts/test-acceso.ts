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
 * COMO CORRE (todo propio, no toca tus datos; solo Postgres LOCAL)
 *  1. Toma `DATABASE_URL` (de .env o del entorno; o `ACCESO_URL_ADMIN`) SOLO para
 *     saber servidor y un rol con CREATEDB (p. ej. `postgres`). Crea una base
 *     PROPIA llamada `ventas_acceso` (dueña: `ventas_migrador`) en ese servidor (la
 *     borra primero si habia una vieja), le aplica las migraciones y el seed con el
 *     rol MIGRADOR, y la destruye al terminar. Se niega a correr si `DATABASE_URL` ya
 *     apunta a `ventas_acceso` o no es local. `ACCESO_BASE=ventas_acceso_x` cambia
 *     el nombre (siempre empieza con `ventas_acceso`); `ACCESO_CONSERVAR=1` no la
 *     borra para investigar.
 *  2. LA APP CORRE CON EL ROL `ventas_app` (SUJETO a RLS: ni superusuario ni BYPASSRLS),
 *     no con el superusuario: sin eso, el aislamiento entre negocios no se prueba.
 *     Los dos roles (`ventas_app` / `ventas_migrador`, claves iguales al nombre salvo
 *     `ACCESO_CLAVE_APP` / `ACCESO_CLAVE_MIGRADOR`) tienen que existir en el servidor
 *     (scripts/crear-roles-db.sql); si no, la prueba FALLA en vez de caer a un superusuario.
 *     A la app no se le pasa `DATABASE_URL_MIGRACIONES` ni `PERMITIR_ROL_CON_BYPASS_RLS`.
 *  3. El seed deja DOS negocios (A = `hl-laser`, B = `taller-demo`). Se siembran costos
 *     DISTINTIVOS en A (p. ej. el vinil cuesta 7.531,27) para que un costo filtrado no se
 *     confunda con un precio de venta, y en CADA negocio ventas, factura, presupuestos,
 *     produccion y usuarios de prueba. Todo lo que busca la prueba se acota por `negocioId`.
 *  4. Hace `next build` (siempre, para probar el codigo actual; `ACCESO_SIN_BUILD=1`
 *     reutiliza `.next`) y arranca `next start -p 3103` (`ACCESO_PUERTO`) como proceso
 *     hijo (se lo mata por PID al final, nunca por nombre), con el emisor fiscal
 *     simulado permitido (facturar de verdad por HTTP). Si el puerto esta ocupado,
 *     aborta: liberalo con `fuser -k 3103/tcp`.
 *  5. Crea en la base usuarios de prueba (dueno, empleado, dueno dado de baja; y dueno y
 *     empleado del negocio B) y sus sesiones con las funciones de `src/lib/auth-pura.ts`
 *     (token aleatorio + SHA-256 en `sesiones`), y las manda en la cabecera `Cookie`.
 *     Con `next start` NODE_ENV es production: la cookie se llama `__Host-ventas_sesion`;
 *     se envia a mano por HTTP plano contra 127.0.0.1. El login por HTTP plano NO se
 *     prueba (el navegador descartaria la cookie `Secure`); lo cubre `test:auth:db`.
 *  6. Al final corre `npm run test:rls` sobre la misma base (con los dos roles); salvo
 *     `ACCESO_SIN_RLS=1`. Con eso, esta prueba es la suite de cierre del aislamiento.
 *
 * AISLAMIENTO ENTRE NEGOCIOS (VTA-20) — sin esto no se despliega
 *  Logueado como dueño y como empleado de CADA negocio (cuatro personas), se intenta ver
 *  y tocar lo del OTRO negocio con ids reales. Una respuesta destinada a un negocio no puede
 *  traer ni un rastro del otro: ni la MARCA que se agrega a los nombres de sus clientes,
 *  materiales, articulos, maquinas, listas y usuarios, ni CUALQUIER id (uuid) de cualquiera
 *  de sus filas. Cada familia tiene su control positivo (lo propio SI funciona).
 *   - urls-ajenas:  detalle por URL (venta, cliente, comprobante, presupuesto, trabajo de
 *     produccion, material, articulo, lista, maquina, usuario...; HTML y RSC) → 404/403/redireccion.
 *   - listados:     listados, tablero y reportes (tambien con un rango de fechas amplio).
 *   - csv:          las exportaciones CSV de reportes traen solo filas del negocio propio.
 *   - parametros:   `?negocio=`, `?negocioId=`, cabeceras `X-Negocio*`, cookies extra y cookies de
 *     sesion manipuladas no cambian el negocio.
 *   - acciones:     server actions con ids del otro negocio (pagar, anular, facturar, nota de
 *     credito, presupuestos, clientes, stock, produccion, usuarios...; y claves foraneas cruzadas)
 *     fallan y no escriben nada; el mismo pedido sobre lo propio funciona. Un `negocioId` en el
 *     pedido no cambia donde se escribe.
 *   - estructura:   toda tabla con `negocioId` tiene RLS activo y forzado y una politica en
 *     `pg_policies`; una tabla nueva sin politica hace fallar la prueba.
 *   - rol-de-la-app, clasificacion (con scripts/auditoria-permisos.ts: /admin/** es del SUPERADMIN).
 *  Comprobar que la suite sirve: `ACCESO_ROMPER=ventas` apaga RLS en esa tabla y
 *  `ACCESO_ROMPER=clientes:politica` la deja con una politica que deja pasar todo; la prueba
 *  TIENE que salir con codigo 1 (lo avisa al final).
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
import { armarValorDeCookie, generarToken, hashDeToken, hashearClave, nombreCookie } from "../src/lib/auth-pura";
import { accesoSimulado, emitirFactura } from "../src/lib/dominio/comprobantes";
import { crearEmisorSimulado } from "../src/lib/fiscal/emisor-simulado";
import { auditarAdmin, claseDeArchivo } from "./auditoria-permisos";

// ─── Configuracion ────────────────────────────────────────────────────────────

const RAIZ = join(__dirname, "..");
// 3103 por defecto; `ACCESO_PUERTO` lo cambia (por ejemplo, si otra tarea tiene `next dev` ahi).
const PUERTO = Number(process.env.ACCESO_PUERTO ?? 3103);
const BASE_URL = `http://127.0.0.1:${PUERTO}`;
const NOMBRE_BASE = process.env.ACCESO_BASE ?? "ventas_acceso";
const COOKIE = nombreCookie(true); // __Host-ventas_sesion: la que usa `next start`
const CLAVE_DE_PRUEBA = "clave-de-prueba-acceso-83";
const DIA = 24 * 60 * 60 * 1000;

// Los dos negocios que siembra `db:seed` (VTA-19): A = HL Laser, B = Taller Demo. Sus ids se resuelven despues del seed.
const SLUG_A = "hl-laser";
const SLUG_B = "taller-demo";
let NEG_A = "";
let NEG_B = "";
// Roles de base de datos (scripts/crear-roles-db.sql). La app corre con `ventas_app` (SUJETO a RLS); el migrador (dueño de las
// tablas, BYPASSRLS) migra, siembra y deja las sesiones de prueba. Las claves por defecto son las de desarrollo (= el nombre).
const ROL_APP = process.env.ACCESO_ROL_APP ?? "ventas_app";
const CLAVE_APP = process.env.ACCESO_CLAVE_APP ?? ROL_APP;
const ROL_MIGRADOR = process.env.ACCESO_ROL_MIGRADOR ?? "ventas_migrador";
const CLAVE_MIGRADOR = process.env.ACCESO_CLAVE_MIGRADOR ?? ROL_MIGRADOR;
// Texto que se agrega al nombre de lo que cada negocio tiene (clientes, materiales, ...): si aparece en una respuesta destinada al
// OTRO negocio, es una fuga. Sin digitos, para no chocar con el detector de importes.
const MARCA_A = "ZZAISLAMIENTOA";
const MARCA_B = "ZZAISLAMIENTOB";

// ─── Clasificacion de rutas ───────────────────────────────────────────────────
// A mano, a proposito: si se derivara del codigo, un permiso mal puesto pasaria
// la prueba. `dueno` = solo DUENO (el empleado va a /ventas/nueva); `ambos` =
// DUENO y EMPLEADO; `publica` = sin sesion. Sale de `requierePermisoPagina(...)`
// de cada pagina y de la tabla de `src/lib/permisos-pura.ts`.
// /listas-precios/** es solo del dueno; /presupuestos/**, /comprobantes/** y /cobranzas/hoy, de ambos.

// `superadmin` (F4.3): `/admin/**`. Solo lo abre una sesion de SUPERADMIN (sin negocio); un dueno o un empleado
// reciben 403 y sin sesion se va a /login.
type Clase = "publica" | "dueno" | "ambos" | "superadmin";

const CLASIFICACION: Record<string, Clase> = {
  // Publicas: el login y lo que el `matcher` del proxy deja pasar (manifiesto, iconos, logo).
  "/login": "publica",
  "/manifest.webmanifest": "publica",
  "/icon.png": "publica",
  "/apple-icon.png": "publica",
  "/marca/*": "publica",
  // F4.2: logo de un negocio por slug (lo necesita /login sin sesion; el proxy excluye `marca/`).
  "/marca/logo/[slug]": "publica",
  // Solo SUPERADMIN (F4.3).
  "/admin": "superadmin",
  "/admin/negocios": "superadmin",
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
  "/reportes/margen-real": "dueno", // ola 6: costo real contra receta (solo dueno)
  "/reportes/margen-real/export": "dueno",
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
  "/comprobantes": "ambos",
  "/comprobantes/[id]": "ambos",
  "/comprobantes/[id]/imprimir": "ambos",
  "/materiales": "ambos",
  "/materiales/[id]": "ambos",
  "/presupuestos": "ambos",
  "/presupuestos/nuevo": "ambos",
  "/presupuestos/[id]": "ambos",
  "/presupuestos/[id]/editar": "ambos",
  "/presupuestos/[id]/imprimir": "ambos",
  "/produccion": "ambos",
  "/produccion/cargar/[ventaItemId]": "ambos",
  "/produccion/estimar": "ambos",
  "/produccion/trabajo/[id]": "ambos",
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

/** Solo Postgres local: localhost o un socket unix (`?host=/ruta`). */
function esLocal(url: string): boolean {
  try {
    const u = new URL(url);
    const socket = u.searchParams.get("host");
    if (socket) return socket.startsWith("/");
    return ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(u.hostname);
  } catch {
    return false;
  }
}

/** La misma URL con otro usuario y clave (servidor y base no cambian). */
function urlConRol(url: string, rol: string, clave: string): string {
  const u = new URL(url);
  u.username = rol;
  u.password = clave;
  return u.toString();
}

/**
 * La prueba de aislamiento solo vale si la app corre con un rol SUJETO a RLS: si los roles no existen o la app se
 * saltara las politicas, la prueba daria verde sin probar nada. Falla fuerte, en vez de caer a un superusuario.
 */
async function verificarRoles(adminUrl: string) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [[ROL_APP, ROL_MIGRADOR]],
    );
    const app = rows.find((r) => r.rolname === ROL_APP);
    const migrador = rows.find((r) => r.rolname === ROL_MIGRADOR);
    if (!app || !migrador) {
      throw new Error(
        `Faltan los roles de base de datos (${ROL_APP} / ${ROL_MIGRADOR}) en el servidor de DATABASE_URL: sin ellos la app no puede correr con RLS real. ` +
          "Crealos con scripts/crear-roles-db.sql (o indica otros con ACCESO_ROL_APP / ACCESO_ROL_MIGRADOR y sus claves con ACCESO_CLAVE_APP / ACCESO_CLAVE_MIGRADOR).",
      );
    }
    if (app.rolsuper || app.rolbypassrls) throw new Error(`El rol de la app (${ROL_APP}) es superusuario o tiene BYPASSRLS: la prueba de aislamiento no probaria nada.`);
    if (!migrador.rolbypassrls) throw new Error(`El rol migrador (${ROL_MIGRADOR}) necesita BYPASSRLS para sembrar los dos negocios.`);
  } finally {
    await admin.end();
  }
}

async function recrearBase(adminUrl: string, nombre: string) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    // Dueña de la base y de las tablas: el migrador (como en produccion). La app no es dueña de nada.
    await admin.query(`CREATE DATABASE "${nombre}" OWNER "${ROL_MIGRADOR}"`);
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
/**
 * Negocio aparte con un logo propio, para la ruta publica `/marca/logo/[slug]`. Es otro negocio a
 * proposito: `quitarLogo` se invoca de verdad como DUENO de hl-laser (cuerpo vacio) y no debe tocar
 * ni cambiar nada de un negocio ajeno (la huella de la base lo comprueba).
 */
const SLUG_CON_LOGO = "acceso-logo";
async function sembrarLogoDeOtroNegocio(prisma: Prisma) {
  const negocio = await prisma.negocio.create({ data: { nombre: "Negocio con logo (acceso)", slug: SLUG_CON_LOGO } });
  const png = readFileSync(join(RAIZ, "public", "marca", "logo.png"));
  await prisma.configuracion.createMany({
    data: [
      { negocioId: negocio.id, clave: "logoMime", valor: "image/png" },
      { negocioId: negocio.id, clave: "logoDatos", valor: png.toString("base64") },
      { negocioId: negocio.id, clave: "logoVersion", valor: "0123456789abcdef" },
    ],
  });
}

async function sembrarDistintivos(prisma: Prisma) {
  await sembrarLogoDeOtroNegocio(prisma);
  // Todo lo de aca es del negocio A (hl-laser): con dos negocios sembrados, un `findMany` sin filtro tomaria filas de B.
  const negocioId = NEG_A;
  for (const [nombre, costo] of Object.entries(COSTOS_MATERIAL)) {
    await prisma.material.updateMany({ where: { negocioId, nombre }, data: { costoUnitario: costo } });
  }
  for (const [nombre, costoHora] of Object.entries(COSTO_HORA_MAQUINA)) {
    await prisma.maquina.updateMany({ where: { negocioId, nombre }, data: { costoHora } });
  }
  for (const [clave, valor] of [["costoHoraManoObra", COSTO_HORA_MANO_OBRA], ["margenObjetivo", MARGEN_OBJETIVO]] as const) {
    await prisma.configuracion.upsert({ where: { negocioId_clave: { negocioId, clave } }, update: { valor }, create: { negocioId, clave, valor } });
  }
  // Dos materiales bajo el minimo: asi la lista de reposicion tiene renglones con costo estimado para el dueno.
  await prisma.material.updateMany({ where: { negocioId, nombre: "Acrílico opalino 3mm" }, data: { stockActual: "1.5" } });
  await prisma.material.updateMany({ where: { negocioId, nombre: "Transportador (vinil transfer)" }, data: { stockActual: "8" } });
  const materiales = new Map((await prisma.material.findMany({ where: { negocioId } })).map((m) => [m.id, m]));

  // Compras: el costo de cada renglon es el del material (asi el costo "de compra" tambien es distintivo).
  for (const compra of await prisma.compra.findMany({ where: { negocioId }, include: { items: true } })) {
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
  for (const venta of await prisma.venta.findMany({ where: { negocioId }, orderBy: { numero: "asc" }, include: { items: { orderBy: { id: "asc" } } } })) {
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

type MatRow = { id: string; costoUnitario: { toString(): string } };
type MaqRow = { id: string; costoHora: { toString(): string } };

/**
 * Ola 6: dos trabajos de produccion VIGENTES (de hoy: caen en el mes que muestra el margen real por defecto) con
 * costos congelados distintivos y con centavos, mas uno ANULADO (que no cuenta y tiene su propio costo distintivo).
 * Asi el margen real tiene numeros que se pueden buscar si se filtraran al empleado.
 *
 * Se siembra en CADA negocio (el B con materiales y maquinas propios): el tercer renglon queda con un trabajo anulado,
 * es decir "sin cargar", y es el blanco de `cargarTrabajo` en la prueba de aislamiento.
 */
async function sembrarProduccion(prisma: Prisma, negocioId: string, usuarioId: string, vinil: MatRow, transportador: MatRow, plotter: MaqRow, laser: MaqRow) {
  const hoy = new Date();
  const fecha = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
  const items = await prisma.ventaItem.findMany({
    where: { negocioId, venta: { estado: { not: "ANULADA" } } },
    orderBy: [{ venta: { numero: "asc" } }, { id: "asc" }],
    take: 3,
  });
  if (items.length < 3) throw new Error("El seed no trae 3 renglones de ventas para sembrar produccion.");
  const [i1, i2, i3] = items as [(typeof items)[number], (typeof items)[number], (typeof items)[number]];
  // 1: consumo + maquinas + mano de obra.
  await prisma.trabajoProduccion.create({
    data: {
      negocioId, ventaItemId: i1.id, fecha, usuarioId, minutosManoObra: "22", costoHoraManoObraSnapshot: COSTO_HORA_MANO_OBRA,
      consumos: { create: [{ negocioId, materialId: vinil.id, cantidad: "2.75", costoUnitarioSnapshot: vinil.costoUnitario.toString() }, { negocioId, materialId: transportador.id, cantidad: "1.4", costoUnitarioSnapshot: transportador.costoUnitario.toString() }] },
      tiempos: { create: [{ negocioId, maquinaId: plotter.id, minutos: "37", costoHoraSnapshot: plotter.costoHora.toString() }, { negocioId, maquinaId: laser.id, minutos: "14.5", costoHoraSnapshot: laser.costoHora.toString() }] },
    },
  });
  // 2: solo materiales.
  await prisma.trabajoProduccion.create({
    data: {
      negocioId, ventaItemId: i2.id, fecha, usuarioId,
      consumos: { create: [{ negocioId, materialId: vinil.id, cantidad: "4.2", costoUnitarioSnapshot: vinil.costoUnitario.toString() }] },
    },
  });
  // 3: anulado, con un costo que no tiene que aparecer en ningun lado (3.333 x 7531,27 = 25.103,2...).
  await prisma.trabajoProduccion.create({
    data: {
      negocioId, ventaItemId: i3.id, fecha, usuarioId, anuladoEn: new Date(), motivoAnulacion: "Prueba de acceso: cargado mal",
      consumos: { create: [{ negocioId, materialId: vinil.id, cantidad: "3.333", costoUnitarioSnapshot: vinil.costoUnitario.toString() }] },
    },
  });
}

/** Los ids de un negocio con los que se instancian las rutas dinamicas y se arman los pedidos de la prueba de aislamiento. */
type Ids = {
  articulo: string; cliente: string; maquina: string; lista: string; material: string; presupuesto: string; venta: string; usuario: string;
  comprobante: string; ventaItem: string; trabajo: string;
  // Blancos de las server actions (cada uno se usa en UNA accion, para que el control del dueño propio pueda repetirla).
  presupuestoAnular: string; presupuestoConvertir: string; ventaPagar: string; ventaEntregar: string; ventaFacturar: string; ventaAnular: string;
  pago: string; trabajoAnular: string; ventaItemLibre: string; usuarioVictima: string;
  clienteActivo: string; materialActivo: string; maquinaActivo: string; articuloActivo: string; listaActiva: string;
};

type Preferencias = { articuloEmpieza?: string; materialEmpieza?: string };

/** Lo que el seed no trae (lista de precios, presupuestos y factura) y los ids para instanciar las rutas dinamicas. */
async function prepararEjemplares(prisma: Prisma, negocioId: string, usuarioId: string, usuarioVictimaId: string, pref: Preferencias = {}): Promise<Ids> {
  const articulos = await prisma.articulo.findMany({ where: { negocioId }, orderBy: { nombre: "asc" } });
  const articulo = (pref.articuloEmpieza ? articulos.find((a) => a.nombre.startsWith(pref.articuloEmpieza!)) : undefined) ?? articulos[0]!;
  const articuloActivo = articulos.find((a) => a.id !== articulo.id)!;
  const clientes = await prisma.cliente.findMany({ where: { negocioId }, orderBy: { nombre: "asc" } });
  const cliente = clientes[0]!;
  const clienteActivo = clientes[1]!;
  const maquinas = await prisma.maquina.findMany({ where: { negocioId }, orderBy: { nombre: "asc" } });
  const maquina = maquinas[0]!;
  const maquinaActivo = maquinas[1]!;
  const materiales = await prisma.material.findMany({ where: { negocioId }, orderBy: { nombre: "asc" } });
  const material = (pref.materialEmpieza ? materiales.find((m) => m.nombre.startsWith(pref.materialEmpieza!)) : undefined) ?? materiales[0]!;
  const materialActivo = materiales.find((m) => m.id !== material.id)!;
  const lista = await prisma.listaPrecio.create({
    data: { negocioId, nombre: "Lista de prueba (acceso)", descuentoPct: "10", items: { create: [{ negocioId, articuloId: articulo.id, precio: "3100" }] } },
  });
  const listaActiva = await prisma.listaPrecio.create({ data: { negocioId, nombre: "Lista a dar de baja (acceso)", descuentoPct: "5" } });

  // Presupuestos: uno para las pantallas, uno que se anula y uno que se convierte en venta.
  const anio = new Date().getFullYear();
  const fecha = new Date(Date.UTC(anio, new Date().getMonth(), new Date().getDate()));
  let numero = ((await prisma.presupuesto.aggregate({ where: { negocioId, anio }, _max: { numero: true } }))._max.numero ?? 0);
  const presupuesto = async () =>
    (
      await prisma.presupuesto.create({
        data: {
          negocioId,
          numero: (numero += 1),
          anio,
          clienteId: cliente.id,
          fecha,
          items: { create: [{ negocioId, articuloId: articulo.id, descripcion: articulo.nombre, cantidad: "10", precioUnitario: "3500", ivaPct: "21" }] },
        },
      })
    ).id;
  const presupuestoId = await presupuesto();
  const presupuestoAnular = await presupuesto();
  const presupuestoConvertir = await presupuesto();

  // Ventas: se reparten los renglones entre las pantallas y las acciones (cada una necesita una venta distinta).
  const ventas = await prisma.venta.findMany({
    where: { negocioId, estado: { not: "ANULADA" } },
    include: { _count: { select: { items: true } }, pagos: { where: { anuladoEn: null } } },
    orderBy: { numero: "asc" },
  });
  const conTrabajo = new Set((await prisma.trabajoProduccion.findMany({ where: { negocioId }, select: { ventaItem: { select: { ventaId: true } } } })).map((t) => t.ventaItem.ventaId));
  const pagado = (v: (typeof ventas)[number]) => v.pagos.reduce((a, p) => a.plus(p.monto.toString()), new Decimal(0));
  // La venta con mas renglones: la pantalla de detalle muestra mas cosas.
  const venta = [...ventas].sort((a, b) => b._count.items - a._count.items)[0]!;
  const usadas = new Set([venta.id]);
  const tomar = (cond: (v: (typeof ventas)[number]) => boolean, descripcion: string) => {
    const v = ventas.find((x) => !usadas.has(x.id) && cond(x)) ?? ventas.find((x) => !usadas.has(x.id));
    if (!v) throw new Error(`No hay una venta libre para ${descripcion} en el negocio ${negocioId}.`);
    usadas.add(v.id);
    return v;
  };
  const ventaEntregar = tomar((v) => v.estado === "PENDIENTE", "marcar entregada");
  const ventaPagar = tomar((v) => new Decimal(v.totalBruto.toString()).minus(pagado(v)).gt(10), "registrar un pago");
  const ventaFacturar = tomar((v) => !conTrabajo.has(v.id), "facturar");
  const ventaAnular = tomar((v) => !conTrabajo.has(v.id) && v.pagos.length === 0, "anular");
  const pago = ventas.find((v) => v.id !== ventaAnular.id && v.id !== ventaFacturar.id && v.id !== ventaPagar.id && v.pagos.length > 0)?.pagos[0];
  if (!pago) throw new Error(`No hay un pago para anular en el negocio ${negocioId}.`);

  // Una factura EMITIDA (simulada) de la venta del detalle: la usan /comprobantes/[id] y su vista imprimible.
  // El seed deja los datos fiscales de ejemplo fuera de produccion; si faltaran, la emision falla fuerte.
  const emisor = crearEmisorSimulado(accesoSimulado(prisma, negocioId));
  const emitida = await emitirFactura(prisma, negocioId, venta.id, usuarioId, { emisor });
  if (emitida.estado !== "EMITIDO") throw new Error(`No se pudo sembrar la factura de prueba: ${emitida.mensaje}`);
  // Ola 6: un renglon cualquiera (para la pantalla de carga) y un trabajo vigente (para su detalle), sembrados antes.
  const vigentes = await prisma.trabajoProduccion.findMany({ where: { negocioId, anuladoEn: null }, orderBy: { creadoEn: "asc" } });
  const anulado = await prisma.trabajoProduccion.findFirstOrThrow({ where: { negocioId, anuladoEn: { not: null } } });
  return {
    articulo: articulo.id, cliente: cliente.id, maquina: maquina.id, lista: lista.id, material: material.id, presupuesto: presupuestoId, venta: venta.id,
    usuario: usuarioId, comprobante: emitida.id, ventaItem: vigentes[0]!.ventaItemId, trabajo: vigentes[0]!.id,
    presupuestoAnular, presupuestoConvertir, ventaPagar: ventaPagar.id, ventaEntregar: ventaEntregar.id, ventaFacturar: ventaFacturar.id, ventaAnular: ventaAnular.id,
    pago: pago.id, trabajoAnular: vigentes[1]!.id, ventaItemLibre: anulado.ventaItemId, usuarioVictima: usuarioVictimaId,
    clienteActivo: clienteActivo.id, materialActivo: materialActivo.id, maquinaActivo: maquinaActivo.id, articuloActivo: articuloActivo.id, listaActiva: listaActiva.id,
  };
}

/** Ids con los que se instancia cada segmento dinamico. */
function ejemplares(ids: Ids): Record<string, string[]> {
  return {
    "/catalogo/[id]": [ids.articulo],
    "/clientes/[id]": [ids.cliente],
    "/clientes/[id]/editar": [ids.cliente],
    "/comprobantes/[id]": [ids.comprobante],
    "/comprobantes/[id]/imprimir": [ids.comprobante],
    "/configuracion/maquinas/[id]": [ids.maquina],
    "/listas-precios/[id]": [ids.lista],
    "/marca/logo/[slug]": [SLUG_CON_LOGO],
    "/materiales/[id]": [ids.material],
    "/materiales/[id]/editar": [ids.material],
    "/presupuestos/[id]": [ids.presupuesto],
    "/presupuestos/[id]/editar": [ids.presupuesto],
    "/presupuestos/[id]/imprimir": [ids.presupuesto],
    "/produccion/cargar/[ventaItemId]": [ids.ventaItem],
    "/produccion/trabajo/[id]": [ids.trabajo],
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

  const materiales = await prisma.material.findMany({ where: { negocioId: NEG_A } });
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

  for (const ci of await prisma.compraItem.findMany({ where: { negocioId: NEG_A } })) {
    lista.push(sensible("costo de compra", `renglon ${ci.id.slice(0, 8)}`, D(ci.costoUnitario)));
    lista.push(sensible("costo de compra", `subtotal ${ci.id.slice(0, 8)}`, D(ci.subtotal)));
    inocentesDec.push(D(ci.cantidad));
  }
  for (const c of await prisma.compra.findMany({ where: { negocioId: NEG_A } })) lista.push(sensible("costo de compra", `total ${c.id.slice(0, 8)}`, D(c.total)));

  let costoTodas = new Decimal(0);
  let brutoTodas = new Decimal(0);
  for (const v of await prisma.venta.findMany({ where: { negocioId: NEG_A }, include: { items: true } })) {
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

  for (const p of await prisma.pago.findMany({ where: { negocioId: NEG_A } })) inocentesDec.push(D(p.monto));
  const maquinas = await prisma.maquina.findMany({ where: { negocioId: NEG_A } });
  for (const m of maquinas) lista.push(sensible("costo de maquina", m.nombre, D(m.costoHora)));
  lista.push(sensible("costo de mano de obra", "hora", new Decimal(COSTO_HORA_MANO_OBRA)));
  lista.push(sensible("margen", "objetivo configurado", new Decimal(MARGEN_OBJETIVO), "pct"));

  // Costo teorico y margen de cada articulo, a partir de la receta (misma cuenta que `costearReceta`, sin overrides).
  const costoMaquina = new Map(maquinas.map((m) => [m.id, D(m.costoHora)]));
  const costoMaterial = new Map(materiales.map((m) => [m.id, D(m.costoUnitario)]));
  for (const a of await prisma.articulo.findMany({ where: { negocioId: NEG_A }, include: { receta: { include: { componentes: true } } } })) {
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

  // Produccion (ola 6): costo real de cada trabajo VIGENTE, desvio contra la receta y margen real (misma cuenta, a mano).
  const dos = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  let realTodos = new Decimal(0);
  let recetaTodos = new Decimal(0);
  let netoTodos = new Decimal(0);
  const trabajos = await prisma.trabajoProduccion.findMany({
    where: { negocioId: NEG_A, anuladoEn: null, ventaItem: { venta: { estado: { not: "ANULADA" } } } },
    include: { consumos: true, tiempos: true, ventaItem: true },
  });
  for (const t of trabajos) {
    const materialesT = dos(t.consumos.reduce((a, c) => a.plus(D(c.cantidad).times(D(c.costoUnitarioSnapshot))), new Decimal(0)));
    const maquinasT = dos(t.tiempos.reduce((a, x) => a.plus(D(x.minutos).div(60).times(D(x.costoHoraSnapshot))), new Decimal(0)));
    const manoObraT = dos(D(t.minutosManoObra).div(60).times(D(t.costoHoraManoObraSnapshot)));
    const real = materialesT.plus(maquinasT).plus(manoObraT);
    const receta = D(t.ventaItem.costoTotalSnapshot);
    const neto = D(t.ventaItem.subtotalNeto);
    realTodos = realTodos.plus(real);
    recetaTodos = recetaTodos.plus(receta);
    netoTodos = netoTodos.plus(neto);
    const etiqueta = `trabajo ${t.id.slice(0, 8)}`;
    lista.push(sensible("costo real de produccion", `${etiqueta} (total)`, real));
    lista.push(sensible("costo real de produccion", `${etiqueta} (materiales)`, materialesT));
    lista.push(sensible("costo real de produccion", `${etiqueta} (maquinas)`, maquinasT));
    lista.push(sensible("costo real de produccion", `${etiqueta} (mano de obra)`, manoObraT));
    lista.push(sensible("desvio de produccion", `${etiqueta} (real − receta)`, real.minus(receta)));
    if (!receta.isZero()) lista.push(sensible("desvio de produccion", `${etiqueta} (%)`, real.minus(receta).div(receta).times(100), "pct"));
    if (!neto.isZero()) lista.push(sensible("margen real", etiqueta, neto.minus(real).div(neto).times(100), "pct"));
    inocentesDec.push(D(t.minutosManoObra), ...t.consumos.map((c) => D(c.cantidad)), ...t.tiempos.map((x) => D(x.minutos)));
  }
  lista.push(sensible("costo real de produccion", "suma de los vigentes", realTodos));
  lista.push(sensible("desvio de produccion", "suma de los vigentes (real − receta)", realTodos.minus(recetaTodos)));
  if (!recetaTodos.isZero()) lista.push(sensible("desvio de produccion", "suma de los vigentes (%)", realTodos.minus(recetaTodos).div(recetaTodos).times(100), "pct"));
  if (!netoTodos.isZero()) lista.push(sensible("margen real", "global de los vigentes", netoTodos.minus(realTodos).div(netoTodos).times(100), "pct"));
  // El trabajo ANULADO: su costo (3,333 x 7531,27) tampoco puede aparecer en ninguna pantalla del dueno ni del empleado.
  lista.push(sensible("costo de un trabajo anulado (no debe verse en ningun lado)", "trabajo anulado", dos(new Decimal("3.333").times(COSTOS_MATERIAL["Vinil adhesivo brillante"]!))));

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

/** `cookie` = valor de la cookie de sesion; `cookiesExtra` = otras cookies crudas ("a=1; b=2") que viajan junto a ella. */
type Pedido = { cookie?: string; cookiesExtra?: string; rsc?: boolean; metodo?: string; cabeceras?: Record<string, string>; cuerpo?: string };

async function pedir(ruta: string, p: Pedido = {}): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { ...p.cabeceras };
  const cookies = [p.cookie ? `${COOKIE}=${p.cookie}` : "", p.cookiesExtra ?? ""].filter(Boolean).join("; ");
  if (cookies) cabeceras["Cookie"] = cookies;
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

type Sesiones = { dueno: string; empleado: string; duenoId: string; empleadoId: string; bajaId: string; baja: string; superadmin: string; superadminId: string };

/** `negocioId` por defecto: el A (hl-laser). Los usuarios de prueba del B pasan el suyo. */
async function crearSesionDirecta(prisma: Prisma, usuarioId: string, opciones: { vencida?: boolean; sinNegocio?: boolean; negocioId?: string } = {}): Promise<string> {
  const token = generarToken();
  const ahora = Date.now();
  // CHECK de la base: el vencimiento es posterior a la creacion. Una sesion vencida se crea "en el pasado".
  const creadaEn = new Date(opciones.vencida ? ahora - 40 * DIA : ahora);
  const expiraEn = new Date(opciones.vencida ? ahora - 10 * DIA : ahora + 30 * DIA);
  // La sesion del SUPERADMIN no tiene negocio (cookie `admin.<token>`).
  const negocioId = opciones.sinNegocio ? null : (opciones.negocioId ?? NEG_A);
  await prisma.sesion.create({ data: { negocioId, tokenHash: hashDeToken(token), usuarioId, creadaEn, renovadaEn: creadaEn, expiraEn } });
  return armarValorDeCookie(negocioId, token); // la cookie lleva `<negocioId>.<token>`
}

/** Cookie con la forma valida pero sin fila en la base (token inventado, negocio existente). */
async function cookieInventada(_prisma: Prisma): Promise<string> {
  return armarValorDeCookie(NEG_A, generarToken());
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

/** Las rutas de `/admin/**` (clase `superadmin`). */
async function probarRutaAdmin(f: Fila, url: string, ctx: Contexto) {
  const { ses } = ctx;
  for (const rsc of [false, true]) {
    const r = await pedir(url, { rsc });
    registrar(f, "sinCookie", aLogin(r), `redireccion a /login o 401 sin cookie${rsc ? " (RSC)" : ""}`, evidencia(r));
    sinFugas(f, "sinCookie", `la respuesta sin cookie${rsc ? " (RSC)" : ""}`, r.cuerpo, ctx);
  }
  for (const [cookie, quien, columna] of [[ses.empleado, "empleado", "empleado"], [ses.dueno, "dueno", "dueno"]] as const) {
    for (const rsc of [false, true]) {
      const r = await pedir(url, { cookie, rsc });
      registrar(f, columna, r.status === 403, `${quien}${rsc ? " (RSC)" : ""}: 403 en /admin/**`, evidencia(r));
      sinFugas(f, "fugas", `lo que recibe el ${quien} en /admin`, r.cuerpo, ctx);
    }
  }
  // El SUPERADMIN abre (o, en /admin, lo lleva a /admin/negocios) y no recibe ningun costo, margen ni valorizacion.
  for (const rsc of [false, true]) {
    const r = await pedir(url, { cookie: ses.superadmin, rsc });
    const destino = rsc ? redireccionRsc(r) : destinoDe(r);
    const abre = rsc ? r.status === 200 && (destino === null || destino === "/admin/negocios") : r.status === 200 || destino === "/admin/negocios";
    registrar(f, "dueno", abre, `SUPERADMIN${rsc ? " (RSC)" : ""}: 200 (o /admin → /admin/negocios)`, evidencia(r));
    sinFugas(f, "fugas", `lo que recibe el SUPERADMIN${rsc ? " (RSC)" : ""}`, r.cuerpo, ctx);
    if (r.status === 200 && url === "/admin/negocios" && !rsc) {
      // Ve nombre, estado y cantidad de usuarios del negocio sembrado, y nada de sus datos.
      comprobarSuelta("/admin/negocios muestra el negocio sembrado (nombre y cantidad de usuarios)", /hl-laser/.test(r.cuerpo) && /usuarios/.test(r.cuerpo), evidencia(r));
    }
  }
  // Sesion expirada y SUPERADMIN dado de baja: como no tener sesion.
  const vencida = await crearSesionDirecta(ctx.prisma, ses.superadminId, { vencida: true, sinNegocio: true });
  const rVencida = await pedir(url, { cookie: vencida });
  registrar(f, "expirada", aLogin(rVencida), "sesion de SUPERADMIN expirada: redireccion a /login o 401", evidencia(rVencida));
  const rTrucha = await pedir(url, { cookie: `admin.${generarToken()}` });
  registrar(f, "sinCookie", aLogin(rTrucha), "cookie admin.<token> inventada: redireccion a /login o 401", evidencia(rTrucha));
  // El token del SUPERADMIN con un negocio en la cookie no sirve (y viceversa).
  const [, token] = ses.superadmin.split(".");
  const rCruzada = await pedir(url, { cookie: await cookieInventada(ctx.prisma).then((c) => `${c.split(".")[0]}.${token}`) });
  registrar(f, "sinCookie", aLogin(rCruzada), "token del SUPERADMIN con el negocio en la cookie: redireccion a /login o 401", evidencia(rCruzada));
  // POST sin cookie: ni la server action ni el formulario corren.
  const accion = await pedir(url, { metodo: "POST", cabeceras: { "Next-Action": ACCION_FALSA, "Content-Type": "text/plain;charset=UTF-8" }, cuerpo: "[]" });
  registrar(f, "post", accion.status === 401 || destinoDe(accion) === "/login", "POST de server action sin cookie: 401 o redireccion a /login", evidencia(accion));
  const form = await pedir(url, { metodo: "POST", cabeceras: { "Content-Type": "application/x-www-form-urlencoded" }, cuerpo: "a=b" });
  registrar(f, "post", form.status === 401 || destinoDe(form) === "/login", "POST de formulario sin cookie: 401 o redireccion a /login", evidencia(form));
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

  // 1b. /admin/**: solo el SUPERADMIN. Dueno y empleado reciben 403 (HTML y RSC); sin sesion, /login.
  if (clase === "superadmin") {
    await probarRutaAdmin(f, url, ctx);
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
  const rTrucha = await pedir(url, { cookie: await cookieInventada(ctx.prisma) });
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

const TABLAS = ["ventas", "venta_items", "pagos", "compras", "compra_items", "movimientos_stock", "clientes", "materiales", "articulos", "recetas", "receta_componentes", "maquinas", "configuracion", "listas_precios", "lista_precio_items", "presupuestos", "presupuesto_items", "contactos_cobranza", "usuarios", "comprobantes", "comprobante_items", "comprobante_iva", "trabajos_produccion", "trabajo_tiempos", "trabajo_consumos"];

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
  "admin/negocios/actions.ts#crearNegocio": "superadmin",
  "admin/negocios/actions.ts#crearPrimerDueno": "superadmin",
  "admin/negocios/actions.ts#cambiarActivoNegocio": "superadmin",
  "catalogo/actions.ts#guardarArticulo": "dueno",
  "catalogo/actions.ts#cambiarActivoArticulo": "dueno",
  "clientes/actions.ts#crearCliente": "ambos",
  "clientes/actions.ts#editarCliente": "ambos",
  "clientes/actions.ts#cambiarActivoCliente": "ambos",
  "cobranzas/hoy/actions.ts#registrarContacto": "ambos",
  "comprobantes/actions.ts#emitirFactura": "ambos",
  "comprobantes/actions.ts#resolverComprobantePendiente": "ambos",
  "compras/actions.ts#registrarCompra": "dueno",
  "configuracion/actions.ts#guardarConfiguracion": "dueno",
  "configuracion/actions.ts#guardarDatosFiscales": "dueno",
  "configuracion/actions.ts#crearMaquina": "dueno",
  "configuracion/actions.ts#editarMaquina": "dueno",
  "configuracion/actions.ts#cambiarActivoMaquina": "dueno",
  "configuracion/actions.ts#subirLogo": "dueno",
  "configuracion/actions.ts#quitarLogo": "dueno",
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
  "produccion/actions.ts#cargarTrabajo": "ambos", // la casilla de ajustar stock exige ademas ajustarStock
  "produccion/actions.ts#anularTrabajo": "ambos",
  "produccion/actions.ts#ajustarStockDeTrabajo": "dueno",
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
  "ventas/[id]/actions.ts#emitirNotaCredito": "dueno",
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
    if (clase === "dueno" || clase === "superadmin") registrar(f, "empleado", rechazada(re), "empleado: 401, 403 o \"No tenés permiso\" (no corre)", evidencia(re));
    else registrar(f, "empleado", !rechazada(re), "empleado: la accion no se rechaza por permiso", evidencia(re));
    // Dueno: nunca se rechaza por permiso (control de que el mensaje de rechazo se distingue del resto)...
    // salvo las del SUPERADMIN, que el dueno tampoco puede (el proxy le contesta 403).
    const rd = await hacer(a.id, destino, ses.dueno);
    if (clase === "superadmin") registrar(f, "dueno", rechazada(rd), "dueno: una accion del SUPERADMIN se rechaza (403)", evidencia(rd));
    else registrar(f, "dueno", !rechazada(rd), "dueno: la accion no se rechaza por permiso", evidencia(rd));
    // El SUPERADMIN: las suyas no se rechazan por permiso (control positivo); las de un negocio, siempre (403 del proxy).
    const rs = await hacer(a.id, destino, ses.superadmin);
    if (clase === "superadmin") registrar(f, "dueno", !rechazada(rs), "SUPERADMIN: su accion no se rechaza por permiso", evidencia(rs));
  }
}

// ─── Aislamiento entre negocios por HTTP (VTA-20) ─────────────────────────────
// Dos negocios sembrados (A = hl-laser, B = taller-demo), la app corriendo con el rol SUJETO a RLS y cuatro personas
// logueadas (dueño y empleado de cada uno). Cada una intenta, por todas las rutas, ver o tocar lo del OTRO negocio con
// ids reales de ese negocio. Se busca de dos maneras: la MARCA que se agrego a los nombres del otro negocio y CUALQUIER
// id (uuid) de cualquier fila del otro negocio. Un solo rastro en una respuesta ya es una fuga. Cada familia de pruebas
// trae su control positivo (lo mismo, sobre lo propio, SI funciona): sin el, "no veo nada" podria ser "no veo nada de nada".

type Lado = "A" | "B";
type Negocio = { lado: Lado; id: string; slug: string; marca: string; ids: Ids; uuids: Set<string> };
type Actor = { etiqueta: string; lado: Lado; rol: "dueno" | "empleado"; cookie: string };
type Aislamiento = {
  prisma: Prisma;
  negocios: Record<Lado, Negocio>;
  actores: Actor[];
  objetivos: { patron: string; clase: Clase; url: string }[];
};

const otro = (l: Lado): Lado => (l === "A" ? "B" : "A");

// Resultado por familia de pruebas (para el resumen) y fallas con el mismo formato que el resto de la suite.
const familias = new Map<string, { n: number; fallas: number }>();
function chequear(familia: string, ok: boolean, esperado: string, evidencia: string, url = familia) {
  comprobaciones += 1;
  const f = familias.get(familia) ?? { n: 0, fallas: 0 };
  f.n += 1;
  if (!ok) {
    f.fallas += 1;
    fallas.push({ url, columna: familia, esperado, evidencia });
  }
  familias.set(familia, f);
}

const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Todos los ids (uuid) de todas las filas de un negocio, de todas las tablas con `negocioId`, mas el id del negocio. */
async function uuidsDe(prisma: Prisma, negocioId: string): Promise<Set<string>> {
  const tablas = await prisma.$queryRaw<{ t: string }[]>`
    SELECT c.table_name AS t FROM information_schema.columns c
      JOIN information_schema.tables tb USING (table_schema, table_name)
     WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'negocioId'
       AND EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema = 'public' AND i.table_name = c.table_name AND i.column_name = 'id')`;
  const ids = new Set<string>([negocioId.toLowerCase()]);
  for (const { t } of tablas) {
    const filas = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM "${t}" WHERE "negocioId" = $1::uuid`, negocioId);
    for (const f of filas) ids.add(f.id.toLowerCase());
  }
  return ids;
}

/**
 * Rastros del negocio `ajeno` en un cuerpo. `ignorar`: ids que el pedido mismo trae (la URL con el id del otro negocio puede
 * volver escrita en el flujo RSC de un 404 sin que sea una fuga; si la pagina mostrara algo de esa fila, igual apareceria su marca).
 */
function fugasAjenas(cuerpo: string, ajeno: Negocio, ignorar: readonly string[] = []): string[] {
  const salida: string[] = [];
  if (cuerpo.includes(ajeno.marca)) salida.push(`la marca "${ajeno.marca}"`);
  const omitir = new Set(ignorar.map((i) => i.toLowerCase()));
  const vistos = new Set<string>();
  for (const m of cuerpo.match(RE_UUID) ?? []) {
    const id = m.toLowerCase();
    if (ajeno.uuids.has(id) && !omitir.has(id) && !vistos.has(id)) {
      vistos.add(id);
      salida.push(`el id ${id}`);
      if (salida.length >= 4) break;
    }
  }
  return salida;
}

const idsDe = (texto: string) => (texto.match(RE_UUID) ?? []).map((x) => x.toLowerCase());
const fragmento = (cuerpo: string, rastro: string) => {
  const dato = rastro.replace(/^(la marca "|el id )/, "").replace(/"$/, "");
  const i = cuerpo.indexOf(dato);
  return cuerpo.slice(Math.max(0, i - 60), i + dato.length + 40).replace(/\s+/g, " ");
};

function autotestDelDetectorDeAislamiento() {
  console.log("--- Auto-test del detector de aislamiento ---");
  const ajeno: Negocio = { lado: "B", id: "bbbbbbbb-0000-4000-8000-000000000001", slug: "b", marca: MARCA_B, ids: {} as Ids, uuids: new Set(["bbbbbbbb-0000-4000-8000-000000000002"]) };
  comprobarSuelta("detecta la marca del otro negocio", fugasAjenas(`<td>Cliente ${MARCA_B}</td>`, ajeno).length === 1);
  comprobarSuelta("detecta un id del otro negocio (mayusculas incluidas)", fugasAjenas(`<a href="/ventas/BBBBBBBB-0000-4000-8000-000000000002">`, ajeno).length === 1);
  comprobarSuelta("detecta el id del otro negocio dentro de un flujo RSC", fugasAjenas(`1:{"ventaId":"bbbbbbbb-0000-4000-8000-000000000002"}`, ajeno).length === 1);
  comprobarSuelta("no marca ids propios ni la marca propia", fugasAjenas(`<td>Cliente ${MARCA_A}</td> aaaaaaaa-0000-4000-8000-000000000002`, ajeno).length === 0);
  comprobarSuelta("`ignorar` omite el id que el pedido mismo trae", fugasAjenas(`"/ventas/bbbbbbbb-0000-4000-8000-000000000002"`, ajeno, ["bbbbbbbb-0000-4000-8000-000000000002"]).length === 0);
  comprobarSuelta("`ignorar` no oculta la marca", fugasAjenas(`${MARCA_B} bbbbbbbb-0000-4000-8000-000000000002`, ajeno, ["bbbbbbbb-0000-4000-8000-000000000002"]).length === 1);
  const resultado = resultadoDeAccion({ status: 200, location: null, tipo: "text/x-component", cuerpo: '0:{"a":"$@1","f":"","b":"x"}\n1:{"ok":false,"error":"No existe"}\n', cabeceras: new Headers() });
  comprobarSuelta("lee el resultado de una server action del flujo RSC", resultado?.ok === false && resultado.error === "No existe");
  comprobarSuelta("sin resultado en el flujo: null", resultadoDeAccion({ status: 500, location: null, tipo: "text/plain", cuerpo: "Internal Server Error", cabeceras: new Headers() }) === null);
}

/** `{ok, error}` que devuelve una server action, leido del flujo `text/x-component` ("1:{...}"). */
function resultadoDeAccion(r: Respuesta): { ok?: boolean; error?: string } | null {
  for (const linea of r.cuerpo.split("\n")) {
    const m = /^[0-9a-f]+:(\{.*\})$/.exec(linea);
    if (!m) continue;
    try {
      const o = JSON.parse(m[1]!) as unknown;
      if (typeof o === "object" && o !== null && "ok" in o) return o as { ok?: boolean; error?: string };
    } catch {
      // no era JSON
    }
  }
  return null;
}

const NO_ENCONTRADO_RSC = /NEXT_HTTP_ERROR_FALLBACK;40[134]|NEXT_NOT_FOUND/;
/** "No se muestra": 401/403/404, una redireccion, o el 404 que viaja dentro del flujo RSC. */
function denegada(r: Respuesta): boolean {
  return [401, 403, 404].includes(r.status) || destinoDe(r) !== null || redireccionRsc(r) !== null || (r.status === 200 && NO_ENCONTRADO_RSC.test(r.cuerpo));
}

// ─── 0. Estructura: ninguna tabla con negocioId sin RLS ni politica ───────────

async function aislamientoEstructura(ai: Aislamiento) {
  console.log("--- Aislamiento: estructura (RLS por tabla, pg_policies) ---");
  const tablas = await ai.prisma.$queryRaw<{ t: string; rls: boolean; forzada: boolean; politicas: number }[]>`
    SELECT c.table_name AS t, cl.relrowsecurity AS rls, cl.relforcerowsecurity AS forzada,
           (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name) AS politicas
      FROM information_schema.columns c
      JOIN information_schema.tables tb USING (table_schema, table_name)
      JOIN pg_class cl ON cl.relname = c.table_name AND cl.relnamespace = 'public'::regnamespace
     WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'negocioId'
     ORDER BY 1`;
  chequear("estructura", tablas.length >= 20, "al menos 20 tablas con negocioId (la consulta no puede quedar vacia)", `${tablas.length} tablas`);
  for (const t of tablas) {
    chequear("estructura", t.rls && t.forzada && t.politicas >= 1, `${t.t}: RLS activo y forzado, con al menos una politica en pg_policies`, `rls=${t.rls}, forzada=${t.forzada}, politicas=${t.politicas}`, `tabla ${t.t}`);
  }
  // Una tabla de datos sin `negocioId` tampoco puede aparecer sin que alguien decida que no es de un negocio.
  const sinNegocioId = await ai.prisma.$queryRaw<{ t: string }[]>`
    SELECT tb.table_name AS t FROM information_schema.tables tb
     WHERE tb.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND tb.table_name NOT IN ('negocios', '_prisma_migrations')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = tb.table_name AND c.column_name = 'negocioId')`;
  chequear("estructura", sinNegocioId.length === 0, "toda tabla de datos tiene negocioId (salvo negocios)", sinNegocioId.map((x) => x.t).join(", "));
}

// ─── 1. Detalle por URL de lo del otro negocio ────────────────────────────────

/** Rutas dinamicas con un id de negocio y la clave de `Ids` que las instancia. Cada ruta dinamica nueva tiene que estar aca. */
const RUTAS_CON_ID: [string, keyof Ids][] = [
  ["/ventas/[id]", "venta"],
  ["/clientes/[id]", "cliente"],
  ["/clientes/[id]/editar", "cliente"],
  ["/comprobantes/[id]", "comprobante"],
  ["/comprobantes/[id]/imprimir", "comprobante"],
  ["/presupuestos/[id]", "presupuesto"],
  ["/presupuestos/[id]/editar", "presupuesto"],
  ["/presupuestos/[id]/imprimir", "presupuesto"],
  ["/produccion/trabajo/[id]", "trabajo"],
  ["/produccion/cargar/[ventaItemId]", "ventaItem"],
  ["/materiales/[id]", "material"],
  ["/materiales/[id]/editar", "material"],
  ["/catalogo/[id]", "articulo"],
  ["/listas-precios/[id]", "lista"],
  ["/configuracion/maquinas/[id]", "maquina"],
  ["/usuarios/[id]", "usuario"],
];
// Rutas dinamicas que no llevan un id de fila de un negocio: el logo por slug (publico) y las exportaciones (se prueban aparte).
const DINAMICAS_SIN_ID = new Set(["/marca/logo/[slug]", "/reportes/export/[reporte]"]);

async function aislamientoUrlsAjenas(ai: Aislamiento) {
  console.log("--- Aislamiento: detalle por URL de lo del otro negocio ---");
  const cubiertas = new Set(RUTAS_CON_ID.map(([p]) => p));
  for (const o of ai.objetivos) {
    if (o.patron.includes("[") && !cubiertas.has(o.patron) && !DINAMICAS_SIN_ID.has(o.patron) && o.clase !== "publica") {
      chequear("urls-ajenas", false, "toda ruta dinamica con id de fila esta en RUTAS_CON_ID", `${o.patron} no esta cubierta`, o.patron);
    }
  }
  for (const actor of ai.actores) {
    const propio = ai.negocios[actor.lado];
    const ajeno = ai.negocios[otro(actor.lado)];
    for (const [patron, clave] of RUTAS_CON_ID) {
      const clase = CLASIFICACION[patron];
      for (const rsc of [false, true]) {
        const etiqueta = `${actor.etiqueta}${rsc ? " (RSC)" : ""}`;
        // Lo del otro negocio, con su id real: 404/403/redireccion, y ni un rastro en la respuesta.
        const urlAjena = patron.replace(/\[[^\]]+\]/, ajeno.ids[clave]);
        const r = await pedir(urlAjena, { cookie: actor.cookie, rsc });
        chequear("urls-ajenas", denegada(r), `${etiqueta}: 404, 403 o redireccion al abrir ${patron} de ${ajeno.slug}`, evidencia(r), `${etiqueta} ${urlAjena}`);
        const rastros = fugasAjenas(r.cuerpo, ajeno, idsDe(urlAjena));
        chequear("urls-ajenas", rastros.length === 0, `${etiqueta}: la respuesta de ${patron} de ${ajeno.slug} no trae nada de ${ajeno.slug}`, rastros.map((x) => `${x} en …${fragmento(r.cuerpo, x)}…`).join(" | "), `${etiqueta} ${urlAjena}`);
        // Control positivo: lo propio, con la misma forma de URL, SI abre (salvo las del dueño para el empleado).
        const urlPropia = patron.replace(/\[[^\]]+\]/, propio.ids[clave]);
        const rp = await pedir(urlPropia, { cookie: actor.cookie, rsc });
        if (actor.rol === "dueno" || clase === "ambos") {
          chequear("urls-ajenas-control", rp.status === 200 && redireccionRsc(rp) === null, `${etiqueta}: lo propio abre en ${patron}`, evidencia(rp), `${etiqueta} ${urlPropia}`);
        } else {
          chequear("urls-ajenas-control", denegada(rp), `${etiqueta}: ${patron} es del dueño: el empleado propio tampoco entra`, evidencia(rp), `${etiqueta} ${urlPropia}`);
        }
      }
    }
  }
}

// ─── 2. Listados, dashboard y reportes: ni una fila del otro negocio ──────────

const RANGO_AMPLIO = "desde=2000-01-01&hasta=2100-12-31";
const CON_RANGO = ["/", "/reportes", "/reportes/margen-real", "/reportes/stock", "/cobranzas", "/produccion", "/ventas", "/comprobantes", "/presupuestos", "/materiales"];

async function aislamientoListados(ai: Aislamiento) {
  console.log("--- Aislamiento: listados, tablero y reportes ---");
  const urls = ai.objetivos
    .filter((o) => o.clase !== "publica" && o.clase !== "superadmin" && !o.patron.includes("[") && !/\/export(\/|$)/.test(o.url))
    .map((o) => o.url);
  const todas = [...new Set([...urls, ...CON_RANGO.map((u) => `${u}${u.includes("?") ? "&" : "?"}${RANGO_AMPLIO}`)])];
  chequear("listados", todas.length >= 15, "se recorren al menos 15 pantallas de listado", `${todas.length}`);
  for (const actor of ai.actores) {
    const propio = ai.negocios[actor.lado];
    const ajeno = ai.negocios[otro(actor.lado)];
    const conMarcaPropia = new Set<string>();
    for (const url of todas) {
      for (const rsc of [false, true]) {
        const etiqueta = `${actor.etiqueta}${rsc ? " (RSC)" : ""}`;
        const r = await pedir(url, { cookie: actor.cookie, rsc });
        const rastros = fugasAjenas(r.cuerpo, ajeno);
        chequear("listados", rastros.length === 0, `${etiqueta}: ${url} no trae nada de ${ajeno.slug}`, rastros.map((x) => `${x} en …${fragmento(r.cuerpo, x)}…`).join(" | "), `${etiqueta} ${url}`);
        if (r.status === 200 && r.cuerpo.includes(propio.marca)) conMarcaPropia.add(url.split("?")[0]!);
      }
    }
    // Control positivo: el negocio propio SI aparece en sus listados (si no, "nada del otro" no probaria nada).
    chequear("listados-control", conMarcaPropia.size >= 3, `${actor.etiqueta}: al menos 3 pantallas muestran filas del negocio propio`, `solo ${conMarcaPropia.size}: ${[...conMarcaPropia].join(", ")}`, actor.etiqueta);
  }
}

// ─── 3. CSV de reportes ───────────────────────────────────────────────────────

async function aislamientoCsv(ai: Aislamiento) {
  console.log("--- Aislamiento: exportaciones CSV ---");
  const reportes = [...REPORTES_CSV.map((r) => `/reportes/export/${r}`), "/reportes/margen-real/export"];
  for (const actor of ai.actores) {
    const propio = ai.negocios[actor.lado];
    const ajeno = ai.negocios[otro(actor.lado)];
    let filasPropias = 0;
    for (const ruta of reportes) {
      const url = `${ruta}?${RANGO_AMPLIO}`;
      const r = await pedir(url, { cookie: actor.cookie });
      const rastros = fugasAjenas(r.cuerpo, ajeno);
      chequear("csv", rastros.length === 0, `${actor.etiqueta}: ${ruta} no trae filas de ${ajeno.slug}`, rastros.map((x) => `${x} en …${fragmento(r.cuerpo, x)}…`).join(" | "), `${actor.etiqueta} ${ruta}`);
      if (actor.rol === "empleado") {
        chequear("csv", r.status === 403, `${actor.etiqueta}: ${ruta} es del dueño (403)`, evidencia(r), `${actor.etiqueta} ${ruta}`);
      } else {
        chequear("csv-control", r.status === 200 && /csv/i.test(r.tipo), `${actor.etiqueta}: ${ruta} se descarga como CSV`, evidencia(r), `${actor.etiqueta} ${ruta}`);
        if (r.cuerpo.includes(propio.marca)) filasPropias += 1;
      }
    }
    if (actor.rol === "dueno") {
      chequear("csv-control", filasPropias >= 2, `${actor.etiqueta}: al menos 2 CSV traen filas del negocio propio`, `solo ${filasPropias}`, actor.etiqueta);
    }
  }
}

// ─── 4. Ningun parametro, cabecera ni cookie cambia el negocio ────────────────

async function aislamientoParametros(ai: Aislamiento, sesiones: Record<Lado, { dueno: string; empleado: string }>) {
  console.log("--- Aislamiento: parametros, cabeceras y cookies que intentan cambiar el negocio ---");
  const PAGINAS = ["/clientes", "/ventas", "/materiales"];
  for (const actor of ai.actores) {
    const propio = ai.negocios[actor.lado];
    const ajeno = ai.negocios[otro(actor.lado)];
    const variantes: { nombre: string; query?: string; cabeceras?: Record<string, string>; cookiesExtra?: string }[] = [
      { nombre: "?negocio=<slug ajeno>", query: `negocio=${ajeno.slug}` },
      { nombre: "?negocio=<id ajeno>", query: `negocio=${ajeno.id}` },
      { nombre: "?negocioId=<id ajeno>", query: `negocioId=${ajeno.id}` },
      { nombre: "?slug=<slug ajeno>&tenant=<slug ajeno>", query: `slug=${ajeno.slug}&tenant=${ajeno.slug}` },
      { nombre: "cabecera X-Negocio", cabeceras: { "X-Negocio": ajeno.slug } },
      { nombre: "cabecera X-Negocio-Id", cabeceras: { "X-Negocio-Id": ajeno.id } },
      { nombre: "cabecera X-Tenant-Id", cabeceras: { "X-Tenant-Id": ajeno.id } },
      { nombre: "cabecera X-Forwarded-Host con el slug ajeno", cabeceras: { "X-Forwarded-Host": `${ajeno.slug}.localhost` } },
      { nombre: "cookie negocio=<id ajeno>", cookiesExtra: `negocio=${ajeno.id}; negocioId=${ajeno.id}; ventas_negocio=${ajeno.slug}` },
    ];
    for (const pagina of PAGINAS) {
      const base = await pedir(pagina, { cookie: actor.cookie });
      chequear("parametros-control", base.status === 200 && base.cuerpo.includes(propio.marca), `${actor.etiqueta}: ${pagina} sin trucos muestra su negocio`, evidencia(base), `${actor.etiqueta} ${pagina}`);
      for (const v of variantes) {
        for (const rsc of [false, true]) {
          const url = v.query ? `${pagina}?${v.query}` : pagina;
          const r = await pedir(url, { cookie: actor.cookie, cookiesExtra: v.cookiesExtra, cabeceras: v.cabeceras, rsc });
          const rastros = fugasAjenas(r.cuerpo, ajeno, [ajeno.id]);
          chequear("parametros", rastros.length === 0 && r.status === 200, `${actor.etiqueta}${rsc ? " (RSC)" : ""}: ${pagina} con ${v.nombre} sigue en su negocio y no trae nada del otro`, `${evidencia(r)}${rastros.length ? ` | ${rastros.join(", ")}` : ""}`, `${actor.etiqueta} ${url}`);
          if (!rsc) chequear("parametros", r.status === 200 && r.cuerpo.includes(propio.marca), `${actor.etiqueta}: ${pagina} con ${v.nombre} sigue mostrando SU negocio`, evidencia(r), `${actor.etiqueta} ${url}`);
        }
      }
    }
    // Cookie de sesion manipulada: el negocio de la cookie no se puede cambiar ni con un token valido.
    const [idPropio, tokenPropio] = actor.cookie.split(".") as [string, string];
    const duenoAjeno = sesiones[otro(actor.lado)].dueno;
    const tokenAjeno = duenoAjeno.split(".")[1]!;
    const manipuladas: [string, string][] = [
      ["negocio ajeno + token propio", `${ajeno.id}.${tokenPropio}`],
      ["negocio propio + token de otro negocio", `${idPropio}.${tokenAjeno}`],
      ["negocio ajeno + token de otro negocio", `${ajeno.id}.${tokenAjeno}.${tokenPropio}`],
      ["solo el token (sin negocio)", tokenPropio],
      ["cookie de SUPERADMIN con el token propio", `admin.${tokenPropio}`],
      ["negocio vacio", `.${tokenPropio}`],
      ["dos negocios en la cookie", `${idPropio}.${ajeno.id}.${tokenPropio}`],
    ];
    for (const [nombre, valor] of manipuladas) {
      for (const rsc of [false, true]) {
        const r = await pedir("/clientes", { cookie: valor, rsc });
        chequear("parametros", aLogin(r), `${actor.etiqueta}${rsc ? " (RSC)" : ""}: cookie manipulada (${nombre}) → /login o 401`, evidencia(r), `${actor.etiqueta} cookie ${nombre}`);
        chequear("parametros", fugasAjenas(r.cuerpo, ajeno).length === 0 && fugasAjenas(r.cuerpo, propio).length === 0, `${actor.etiqueta}: cookie manipulada (${nombre}) no trae datos de ningun negocio`, evidencia(r), `${actor.etiqueta} cookie ${nombre}`);
      }
    }
    // Dos cookies de sesion a la vez (la del propio y la del otro negocio): lo que venga es de UN solo negocio, nunca mezclado.
    const doble = await pedir("/clientes", { cookie: actor.cookie, cookiesExtra: `${COOKIE}=${duenoAjeno}` });
    const ve = [propio, ajeno].filter((n) => doble.cuerpo.includes(n.marca)).length;
    chequear("parametros", ve <= 1, `${actor.etiqueta}: dos cookies de sesion no mezclan negocios`, `se ven ${ve} negocios · ${evidencia(doble)}`, `${actor.etiqueta} doble cookie`);
  }
}

// ─── 5. Server actions con ids del otro negocio ───────────────────────────────

const hoyISO = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
};

/**
 * Una accion y los argumentos con los que se la invoca sobre las filas de un negocio. El mismo pedido, hecho por el dueño
 * del negocio al que pertenecen las filas, TIENE que funcionar (control): asi un fallo sobre las del otro negocio es por el
 * aislamiento y no por un argumento mal armado o un estado que no admite la operacion.
 */
type EspecAccion = { clave: string; args: (ids: Ids) => unknown };
const ESPECS_ACCIONES: EspecAccion[] = [
  { clave: "ventas/[id]/actions.ts#registrarPago", args: (i) => ({ ventaId: i.ventaPagar, monto: "1", metodo: "EFECTIVO", fecha: hoyISO(), notas: "" }) },
  { clave: "ventas/[id]/actions.ts#marcarEntregada", args: (i) => ({ ventaId: i.ventaEntregar }) },
  { clave: "comprobantes/actions.ts#emitirFactura", args: (i) => ({ ventaId: i.ventaFacturar }) },
  { clave: "ventas/[id]/actions.ts#anularPago", args: (i) => ({ pagoId: i.pago, motivo: "Prueba de aislamiento" }) },
  { clave: "ventas/[id]/actions.ts#anularVenta", args: (i) => ({ ventaId: i.ventaAnular }) },
  { clave: "ventas/[id]/actions.ts#emitirNotaCredito", args: (i) => ({ ventaId: i.venta, comprobanteId: i.comprobante }) },
  { clave: "presupuestos/actions.ts#anularPresupuesto", args: (i) => ({ id: i.presupuestoAnular }) },
  { clave: "presupuestos/actions.ts#convertirPresupuesto", args: (i) => ({ id: i.presupuestoConvertir }) },
  { clave: "presupuestos/actions.ts#duplicarPresupuesto", args: (i) => ({ id: i.presupuesto }) },
  { clave: "presupuestos/actions.ts#editarPresupuesto", args: (i) => ({ id: i.presupuesto, clienteId: i.cliente, validezDias: "15", observaciones: "", items: [{ articuloId: i.articulo, cantidad: "2" }] }) },
  { clave: "presupuestos/actions.ts#crearPresupuesto", args: (i) => ({ clienteId: i.cliente, validezDias: "15", observaciones: "", items: [{ articuloId: i.articulo, cantidad: "1" }] }) },
  { clave: "ventas/actions.ts#registrarVenta", args: (i) => ({ clienteId: i.cliente, observaciones: "", entregada: false, items: [{ articuloId: i.articulo, cantidad: "1" }], pago: null }) },
  { clave: "compras/actions.ts#registrarCompra", args: (i) => ({ fecha: hoyISO(), proveedor: "Proveedor de prueba", comprobante: "", notas: "", actualizarCosto: false, items: [{ materialId: i.material, cantidad: "1", costoUnitario: "10" }] }) },
  { clave: "clientes/actions.ts#crearCliente", args: (i) => ({ nombre: "Cliente con lista (aislamiento)", listaPrecioId: i.lista }) },
  { clave: "clientes/actions.ts#editarCliente", args: (i) => ({ id: i.cliente, nombre: "Cliente editado (aislamiento)" }) },
  { clave: "clientes/actions.ts#cambiarActivoCliente", args: (i) => ({ id: i.clienteActivo, activo: false }) },
  { clave: "materiales/[id]/actions.ts#ajustarStock", args: (i) => ({ materialId: i.material, stockContado: "7", motivo: "Prueba de aislamiento" }) },
  { clave: "materiales/actions.ts#cambiarEstadoMaterial", args: (i) => ({ id: i.materialActivo, activo: false }) },
  { clave: "configuracion/actions.ts#cambiarActivoMaquina", args: (i) => ({ id: i.maquinaActivo, activo: false }) },
  { clave: "catalogo/actions.ts#cambiarActivoArticulo", args: (i) => ({ id: i.articuloActivo, activo: false }) },
  { clave: "listas-precios/actions.ts#cambiarActivoLista", args: (i) => ({ id: i.listaActiva, activo: false }) },
  { clave: "produccion/actions.ts#anularTrabajo", args: (i) => ({ trabajoId: i.trabajoAnular, motivo: "Prueba de aislamiento" }) },
  {
    clave: "produccion/actions.ts#cargarTrabajo",
    args: (i) => ({ ventaItemId: i.ventaItemLibre, fecha: hoyISO(), minutosManoObra: "5", tiempos: [{ maquinaId: i.maquina, minutos: "3" }], consumos: [{ materialId: i.material, cantidad: "1" }], notas: "" }),
  },
  { clave: "usuarios/actions.ts#resetearClaveUsuario", args: (i) => ({ id: i.usuarioVictima, clave: "clave-nueva-aislamiento-77" }) },
  { clave: "usuarios/actions.ts#cambiarRolUsuario", args: (i) => ({ id: i.usuarioVictima, rol: "DUENO" }) },
  { clave: "usuarios/actions.ts#cambiarActivoUsuario", args: (i) => ({ id: i.usuarioVictima, activo: false }) },
];

/**
 * Pedidos que mezclan filas PROPIAS con filas del otro negocio (clave foranea cruzada): no tienen control porque nunca
 * deben funcionar. Los hace solo el dueño.
 */
const ESPECS_CRUZADAS: { clave: string; nombre: string; args: (propio: Ids, ajeno: Ids) => unknown }[] = [
  { clave: "ventas/actions.ts#registrarVenta", nombre: "cliente propio + articulo ajeno", args: (p, a) => ({ clienteId: p.cliente, observaciones: "", entregada: false, items: [{ articuloId: a.articulo, cantidad: "1" }], pago: null }) },
  { clave: "ventas/actions.ts#registrarVenta", nombre: "cliente ajeno + articulo propio", args: (p, a) => ({ clienteId: a.cliente, observaciones: "", entregada: false, items: [{ articuloId: p.articulo, cantidad: "1" }], pago: null }) },
  { clave: "presupuestos/actions.ts#crearPresupuesto", nombre: "cliente propio + articulo ajeno", args: (p, a) => ({ clienteId: p.cliente, validezDias: "15", observaciones: "", items: [{ articuloId: a.articulo, cantidad: "1" }] }) },
  { clave: "presupuestos/actions.ts#editarPresupuesto", nombre: "presupuesto propio + cliente ajeno", args: (p, a) => ({ id: p.presupuesto, clienteId: a.cliente, validezDias: "15", observaciones: "", items: [{ articuloId: p.articulo, cantidad: "2" }] }) },
  { clave: "compras/actions.ts#registrarCompra", nombre: "material ajeno", args: (_p, a) => ({ fecha: hoyISO(), proveedor: "Proveedor de prueba", comprobante: "", notas: "", actualizarCosto: false, items: [{ materialId: a.material, cantidad: "1", costoUnitario: "10" }] }) },
  { clave: "clientes/actions.ts#editarCliente", nombre: "cliente propio + lista de precios ajena", args: (p, a) => ({ id: p.cliente, nombre: "Cliente con lista ajena", listaPrecioId: a.lista }) },
  { clave: "produccion/actions.ts#cargarTrabajo", nombre: "renglon propio + maquina y material ajenos", args: (p, a) => ({ ventaItemId: p.ventaItemLibre, fecha: hoyISO(), minutosManoObra: "5", tiempos: [{ maquinaId: a.maquina, minutos: "3" }], consumos: [{ materialId: a.material, cantidad: "1" }], notas: "" }) },
  { clave: "produccion/actions.ts#cargarTrabajo", nombre: "renglon ajeno + maquina y material propios", args: (p, a) => ({ ventaItemId: a.ventaItemLibre, fecha: hoyISO(), minutosManoObra: "5", tiempos: [{ maquinaId: p.maquina, minutos: "3" }], consumos: [{ materialId: p.material, cantidad: "1" }], notas: "" }) },
];

/**
 * Acciones que no reciben ningun id de fila de otro negocio (o que son publicas/del SUPERADMIN): no tienen un "blanco ajeno".
 * Una accion nueva tiene que estar en ESPECS_ACCIONES o aca, con el motivo: no puede quedar sin pensar.
 */
const ACCIONES_SIN_BLANCO_AJENO: Record<string, string> = {
  "catalogo/actions.ts#guardarArticulo": "la receta referencia materiales y maquinas por id (cubierto por el control de claves foraneas de la base: scripts/test-rls.ts)",
  "cobranzas/hoy/actions.ts#registrarContacto": "recibe el id de un cliente: lo cubre RLS en test-rls (contactos_cobranza)",
  "comprobantes/actions.ts#resolverComprobantePendiente": "solo opera sobre comprobantes PENDIENTES, que el seed no tiene; la emision de otro negocio la cubre emitirFactura",
  "configuracion/actions.ts#crearMaquina": "no recibe ids",
  "configuracion/actions.ts#editarMaquina": "edita la maquina por id: misma ruta de datos que cambiarActivoMaquina",
  "configuracion/actions.ts#guardarConfiguracion": "no recibe ids: escribe la configuracion del negocio de la sesion",
  "configuracion/actions.ts#guardarDatosFiscales": "no recibe ids: escribe la configuracion fiscal del negocio de la sesion",
  "configuracion/actions.ts#subirLogo": "no recibe ids: el logo es del negocio de la sesion",
  "configuracion/actions.ts#quitarLogo": "no recibe ids: el logo es del negocio de la sesion",
  "listas-precios/actions.ts#crearLista": "no recibe ids",
  "listas-precios/actions.ts#editarLista": "edita la lista por id: misma ruta de datos que cambiarActivoLista",
  "listas-precios/actions.ts#guardarPrecioLista": "recibe lista y articulo por id: claves foraneas cubiertas por test-rls",
  "listas-precios/actions.ts#quitarPrecioLista": "recibe lista y articulo por id: claves foraneas cubiertas por test-rls",
  "materiales/actions.ts#crearMaterial": "no recibe ids",
  "materiales/actions.ts#editarMaterial": "edita el material por id: misma ruta de datos que cambiarEstadoMaterial",
  "produccion/actions.ts#ajustarStockDeTrabajo": "ajusta el stock de un trabajo por id: misma ruta de datos que anularTrabajo",
  "reposicion/actions.ts#guardarFactorReposicion": "no recibe ids",
  "usuarios/actions.ts#cambiarMiClave": "solo opera sobre el usuario de la sesion",
  "usuarios/actions.ts#crearUsuario": "el negocio sale de la sesion; no recibe ids",
  "ventas/nueva/actions.ts#preciosParaCliente": "lectura de precios para un cliente por id: la lectura la cubre RLS en test-rls",
  "ventas/nueva/actions.ts#preciosParaPresupuesto": "lectura de precios de un presupuesto por id: la lectura la cubre RLS en test-rls",
};

function destinoDeAccion(a: AccionHttp, ids: Ids): string {
  const patron = a.paginas[0] ?? "/ventas";
  if (!patron.includes("[")) return patron;
  const valor = ejemplares(ids)[patron]?.[0];
  return valor ? patron.replace(/\[[^\]]+\]/, valor) : "/ventas";
}

async function aislamientoAcciones(ai: Aislamiento) {
  console.log("--- Aislamiento: server actions con ids del otro negocio ---");
  const acciones = new Map(accionesDelBuild().map((a) => [a.clave, a]));
  const hacer = (a: AccionHttp, destino: string, cookie: string, args: unknown) =>
    pedir(destino, { metodo: "POST", cookie, cabeceras: { "Next-Action": a.id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, cuerpo: JSON.stringify([args]) });

  // Cobertura: toda accion de un negocio tiene un blanco ajeno o un motivo escrito para no tenerlo.
  const conSpec = new Set(ESPECS_ACCIONES.map((e) => e.clave));
  for (const [clave, clase] of Object.entries(CLASIFICACION_ACCIONES)) {
    if (clase === "publica" || clase === "superadmin") continue;
    chequear("acciones-cobertura", conSpec.has(clave) || clave in ACCIONES_SIN_BLANCO_AJENO, "cada accion tiene un blanco ajeno (ESPECS_ACCIONES) o un motivo en ACCIONES_SIN_BLANCO_AJENO", clave, clave);
  }
  for (const e of [...ESPECS_ACCIONES, ...ESPECS_CRUZADAS]) chequear("acciones-cobertura", acciones.has(e.clave), "la accion existe en el build", e.clave, e.clave);

  // Intentos: cada persona, con los ids reales del OTRO negocio. Nada puede cambiar en ninguna tabla.
  const antes = await huella(ai.prisma);
  for (const actor of ai.actores) {
    const propio = ai.negocios[actor.lado];
    const ajeno = ai.negocios[otro(actor.lado)];
    for (const e of ESPECS_ACCIONES) {
      const a = acciones.get(e.clave);
      if (!a) continue;
      // El alta de un cliente de un empleado IGNORA la lista de precios (es una decision del dueño): alta valida, no ajena.
      // Para el empleado se verifica aparte (mas abajo) que la lista ajena no se guarda.
      if (actor.rol === "empleado" && e.clave === "clientes/actions.ts#crearCliente") continue;
      const args = e.args(ajeno.ids);
      const r = await hacer(a, destinoDeAccion(a, propio.ids), actor.cookie, args);
      const res = resultadoDeAccion(r);
      chequear("acciones", res?.ok !== true, `${actor.etiqueta}: ${e.clave} con ids de ${ajeno.slug} falla`, `${evidencia(r)}`, `${actor.etiqueta} ${e.clave}`);
      const rastros = fugasAjenas(r.cuerpo, ajeno, idsDe(JSON.stringify(args)));
      chequear("acciones", rastros.length === 0, `${actor.etiqueta}: la respuesta de ${e.clave} no revela nada de ${ajeno.slug}`, rastros.map((x) => `${x} en …${fragmento(r.cuerpo, x)}…`).join(" | "), `${actor.etiqueta} ${e.clave}`);
    }
    if (actor.rol === "dueno") {
      for (const e of ESPECS_CRUZADAS) {
        const a = acciones.get(e.clave);
        if (!a) continue;
        const r = await hacer(a, destinoDeAccion(a, propio.ids), actor.cookie, e.args(propio.ids, ajeno.ids));
        chequear("acciones", resultadoDeAccion(r)?.ok !== true, `${actor.etiqueta}: ${e.clave} mezclando filas (${e.nombre}) falla`, evidencia(r), `${actor.etiqueta} ${e.clave} [${e.nombre}]`);
      }
    }
  }
  const despues = await huella(ai.prisma);
  chequear("acciones", diferencias(antes, despues) === "", "los intentos sobre el otro negocio no escribieron nada en ninguna tabla", diferencias(antes, despues));

  // Control positivo: el mismo pedido, hecho por el dueño del negocio al que pertenecen las filas, SI funciona.
  // Va DESPUES de los intentos (consume filas: anula, factura, desactiva) y ya no se miran pantallas despues.
  for (const lado of ["A", "B"] as const) {
    const actor = ai.actores.find((x) => x.lado === lado && x.rol === "dueno")!;
    const propio = ai.negocios[lado];
    for (const e of ESPECS_ACCIONES) {
      const a = acciones.get(e.clave);
      if (!a) continue;
      const r = await hacer(a, destinoDeAccion(a, propio.ids), actor.cookie, e.args(propio.ids));
      const res = resultadoDeAccion(r);
      chequear("acciones-control", res?.ok === true, `${actor.etiqueta}: ${e.clave} sobre sus propias filas funciona (si no, el intento ajeno no probaba nada)`, `${evidencia(r)}${res?.error ? ` | ${res.error}` : ""}`, `${actor.etiqueta} ${e.clave}`);
    }
  }

  // Un `negocioId` en el pedido no cambia donde se escribe: el alta cae en el negocio de la sesion.
  for (const lado of ["A", "B"] as const) {
    const actor = ai.actores.find((x) => x.lado === lado && x.rol === "dueno")!;
    const propio = ai.negocios[lado];
    const ajeno = ai.negocios[otro(lado)];
    const a = acciones.get("clientes/actions.ts#crearCliente");
    if (!a) continue;
    const nombre = `Alta con negocioId inyectado ${lado}`;
    const r = await hacer(a, destinoDeAccion(a, propio.ids), actor.cookie, { nombre, negocioId: ajeno.id, negocio: ajeno.slug });
    const filas = await ai.prisma.$queryRaw<{ negocioId: string }[]>`SELECT "negocioId"::text AS "negocioId" FROM clientes WHERE nombre = ${nombre}`;
    chequear("acciones", filas.length > 0 && filas.every((f) => f.negocioId === propio.id), `${actor.etiqueta}: un alta con negocioId de ${ajeno.slug} en el pedido cae en SU negocio`, `${evidencia(r)} | filas: ${JSON.stringify(filas)}`, `${actor.etiqueta} crearCliente + negocioId`);

    // El empleado no puede asignar listas de precios: la lista ajena que traiga el pedido se descarta, y el alta cae en su negocio.
    const emp = ai.actores.find((x) => x.lado === lado && x.rol === "empleado")!;
    const nombreEmp = `Alta de empleado con lista ajena ${lado}`;
    const rEmp = await hacer(a, destinoDeAccion(a, propio.ids), emp.cookie, { nombre: nombreEmp, listaPrecioId: ajeno.ids.lista, negocioId: ajeno.id });
    const filasEmp = await ai.prisma.$queryRaw<{ negocioId: string; listaPrecioId: string | null }[]>`SELECT "negocioId"::text AS "negocioId", "listaPrecioId"::text AS "listaPrecioId" FROM clientes WHERE nombre = ${nombreEmp}`;
    chequear("acciones", filasEmp.length === 1 && filasEmp[0]!.negocioId === propio.id && filasEmp[0]!.listaPrecioId === null, `${emp.etiqueta}: el alta con la lista de precios y el negocioId de ${ajeno.slug} cae en SU negocio y sin lista`, `${evidencia(rEmp)} | filas: ${JSON.stringify(filasEmp)}`, `${emp.etiqueta} crearCliente + lista ajena`);
  }
}

// ─── 6. El rol con el que corre la app ────────────────────────────────────────

async function aislamientoRolDeLaApp(ai: Aislamiento) {
  console.log("--- Aislamiento: rol de base de datos de la app ---");
  const conexiones = await ai.prisma.$queryRaw<{ usename: string; n: number }[]>`
    SELECT usename, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND usename IS NOT NULL GROUP BY usename`;
  chequear("rol-de-la-app", conexiones.some((c) => c.usename === ROL_APP), `la app esta conectada con ${ROL_APP} (sujeto a RLS)`, JSON.stringify(conexiones));
  const rol = (await ai.prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${ROL_APP}`)[0];
  chequear("rol-de-la-app", !!rol && !rol.rolsuper && !rol.rolbypassrls, `${ROL_APP} no es superusuario ni tiene BYPASSRLS`, JSON.stringify(rol));
  const dueno = (await ai.prisma.$queryRaw<{ dueno: string }[]>`SELECT tableowner AS dueno FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ventas'`)[0];
  chequear("rol-de-la-app", dueno?.dueno !== ROL_APP, `${ROL_APP} no es dueño de las tablas`, JSON.stringify(dueno));
}

// ─── 7. Rotura deliberada (para comprobar que la suite falla) ─────────────────

/**
 * `ACCESO_ROMPER=ventas` apaga RLS en esa tabla; `ACCESO_ROMPER=ventas:politica` la deja con una politica que deja pasar todo.
 * Varias, separadas por coma. La suite TIENE que fallar (sale con codigo 1): es la comprobacion de que sirve.
 */
async function romperDeliberadamente(urlMig: string, spec: string) {
  const pg = new Client({ connectionString: urlMig });
  await pg.connect();
  try {
    for (const item of spec.split(",").map((x) => x.trim()).filter(Boolean)) {
      const [tabla, modo] = item.split(":") as [string, string | undefined];
      if (!/^[a-z_]+$/.test(tabla)) throw new Error(`ACCESO_ROMPER: tabla invalida "${tabla}"`);
      if (modo === "politica") {
        const { rows } = await pg.query<{ policyname: string }>(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`, [tabla]);
        for (const p of rows) await pg.query(`DROP POLICY "${p.policyname}" ON "${tabla}"`);
        await pg.query(`CREATE POLICY rotura_deliberada ON "${tabla}" FOR ALL USING (true) WITH CHECK (true)`);
        console.log(`!!! ROTURA DELIBERADA: ${tabla} con una politica que deja pasar todo.`);
      } else {
        await pg.query(`ALTER TABLE "${tabla}" DISABLE ROW LEVEL SECURITY`);
        console.log(`!!! ROTURA DELIBERADA: ${tabla} sin RLS.`);
      }
    }
  } finally {
    await pg.end();
  }
}

// ─── 8. test:rls sobre la misma base ──────────────────────────────────────────

/** `npm run test:rls` forma parte de la suite de cierre: se corre sobre la base de esta prueba, con los dos roles. */
function correrTestRls(urlApp: string, urlMig: string) {
  console.log("--- test:rls (RLS por tabla, con los dos roles) ---");
  const env = Object.fromEntries(
    Object.entries({ ...process.env, DATABASE_URL: urlApp, DATABASE_URL_MIGRACIONES: urlMig }).filter(([clave]) => clave !== "NODE_ENV"),
  ) as unknown as NodeJS.ProcessEnv;
  const r = spawnSync("npx", ["tsx", "scripts/test-rls.ts"], { cwd: RAIZ, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const resumen = /(\d+)\/(\d+) comprobaciones OK/.exec(r.stdout ?? "");
  const fallos = (r.stdout ?? "").split("\n").filter((l) => l.startsWith("FALLA")).slice(0, 10).join("\n");
  chequear("test-rls", r.status === 0 && resumen !== null, "npm run test:rls verde sobre la base de la prueba", `codigo ${r.status}; ${resumen ? resumen[0] : "sin resumen"}\n${fallos}${r.status === 0 ? "" : `\n${(r.stderr ?? "").slice(-1500)}`}`);
  console.log(`     test:rls: ${resumen ? resumen[0] : "sin resumen"} (codigo ${r.status})`);
}

function resumenDeAislamiento() {
  console.log("");
  console.log("=== Aislamiento entre negocios ===");
  for (const [familia, { n, fallas: f }] of [...familias].sort()) {
    console.log(`${f === 0 ? "OK   " : "FALLA"} ${familia.padEnd(22)} ${String(n).padStart(5)} comprobaciones${f ? `, ${f} con falla` : ""}`);
  }
}

// ─── Principal ────────────────────────────────────────────────────────────────

async function main() {
  autotestDelDetector();
  autotestDelDetectorDeAislamiento();

  // Servidor de Postgres: de ACCESO_URL_ADMIN o, si no, de DATABASE_URL (un rol con CREATEDB, p. ej. `postgres`). Solo local.
  const original = process.env.ACCESO_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!original) throw new Error("Falta DATABASE_URL (en .env o en el entorno): se usa para ubicar el servidor de Postgres.");
  if (!esLocal(original)) throw new Error("Esta prueba crea y borra una base: solo corre contra Postgres local (localhost o socket unix). Nunca contra Neon.");
  if (!NOMBRE_BASE.startsWith("ventas_acceso")) throw new Error(`ACCESO_BASE debe empezar con "ventas_acceso" (es "${NOMBRE_BASE}").`);
  const nombreOriginal = new URL(original).pathname.replace(/^\//, "");
  if (nombreOriginal === NOMBRE_BASE) throw new Error(`DATABASE_URL ya apunta a "${NOMBRE_BASE}": usa otra para que la prueba pueda crearla y borrarla.`);
  if (!(await puertoLibre())) throw new Error(`El puerto ${PUERTO} esta ocupado. Liberalo con: fuser -k ${PUERTO}/tcp`);

  const adminUrl = urlDeBase(original, "postgres", false);
  const urlBase = urlDeBase(original, NOMBRE_BASE, true);
  const urlMig = urlConRol(urlBase, ROL_MIGRADOR, CLAVE_MIGRADOR); // dueño de las tablas, BYPASSRLS: migra, siembra y prepara sesiones
  const urlApp = urlConRol(urlBase, ROL_APP, CLAVE_APP); // la app: SUJETA a RLS
  const sinNodeEnv = (e: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(e).filter(([clave]) => clave !== "NODE_ENV")) as unknown as NodeJS.ProcessEnv;
  // Entorno de las migraciones y el seed: el migrador (sin NODE_ENV heredado: next y prisma fijan el suyo).
  const entornoMigracion = sinNodeEnv({ ...process.env, DATABASE_URL: urlMig, DATABASE_URL_MIGRACIONES: urlMig });
  // Entorno de la app (build y `next start`): SOLO el rol de la app, sin credenciales del migrador y sin permiso para
  // saltarse RLS (`PERMITIR_ROL_CON_BYPASS_RLS`): si la app se conectara con un rol que se salta RLS, arrancaria rota.
  const entorno = sinNodeEnv({ ...process.env, DATABASE_URL: urlApp });
  delete entorno.DATABASE_URL_MIGRACIONES;
  delete entorno.PERMITIR_ROL_CON_BYPASS_RLS;

  let prisma: Prisma | null = null;
  let baseCreada = false;
  try {
    console.log(`--- Preparacion (base propia "${NOMBRE_BASE}", servidor de DATABASE_URL; app con ${ROL_APP}, siembra con ${ROL_MIGRADOR}) ---`);
    await verificarRoles(adminUrl);
    await recrearBase(adminUrl, NOMBRE_BASE);
    baseCreada = true;
    correr("prisma migrate deploy", "npx", ["prisma", "migrate", "deploy"], entornoMigracion);
    correr("prisma db seed", "npx", ["prisma", "db", "seed"], entornoMigracion);

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlMig }) });
    NEG_A = (await prisma.negocio.findUniqueOrThrow({ where: { slug: SLUG_A }, select: { id: true } })).id;
    NEG_B = (await prisma.negocio.findUniqueOrThrow({ where: { slug: SLUG_B }, select: { id: true } })).id;
    await sembrarDistintivos(prisma);

    // Usuarios de prueba: claves hasheadas con la funcion del repo (una sola vez; scrypt es caro a proposito).
    const hashClave = await hashearClave(CLAVE_DE_PRUEBA);
    const crear = (negocioId: string, usuario: string, nombre: string, rol: "DUENO" | "EMPLEADO", activo = true) =>
      prisma!.usuario.create({ data: { negocioId, usuario, nombre, rol, hashClave, activo } });
    const dueno = await crear(NEG_A, "acceso.dueno", "Dueño de prueba (acceso)", "DUENO");
    const empleado = await crear(NEG_A, "acceso.empleado", "Empleado de prueba (acceso)", "EMPLEADO");
    const baja = await crear(NEG_A, "acceso.baja", "Dueño dado de baja (acceso)", "DUENO", false);
    const victimaA = await crear(NEG_A, "acceso.victima", "Empleado blanco de acciones (acceso)", "EMPLEADO");
    const duenoB = await crear(NEG_B, "acceso.dueno", "Dueño de prueba B (acceso)", "DUENO");
    const empleadoB = await crear(NEG_B, "acceso.empleado", "Empleado de prueba B (acceso)", "EMPLEADO");
    const victimaB = await crear(NEG_B, "acceso.victima", "Empleado blanco de acciones B (acceso)", "EMPLEADO");
    const superadmin = await prisma.usuario.create({
      data: { negocioId: null, usuario: "acceso.superadmin", nombre: "Superadmin de prueba (acceso)", rol: "SUPERADMIN", hashClave },
    });
    const ses: Sesiones = {
      superadmin: await crearSesionDirecta(prisma, superadmin.id, { sinNegocio: true }),
      superadminId: superadmin.id,
      dueno: await crearSesionDirecta(prisma, dueno.id),
      empleado: await crearSesionDirecta(prisma, empleado.id),
      baja: await crearSesionDirecta(prisma, baja.id),
      duenoId: dueno.id,
      empleadoId: empleado.id,
      bajaId: baja.id,
    };
    const sesionesB = { dueno: await crearSesionDirecta(prisma, duenoB.id, { negocioId: NEG_B }), empleado: await crearSesionDirecta(prisma, empleadoB.id, { negocioId: NEG_B }) };

    // Produccion y ejemplares en CADA negocio (el B con sus propios materiales y maquinas).
    const material = async (negocioId: string, nombre: string) => prisma!.material.findFirstOrThrow({ where: { negocioId, nombre } });
    const maquina = async (negocioId: string, nombre: string) => prisma!.maquina.findFirstOrThrow({ where: { negocioId, nombre } });
    await sembrarProduccion(prisma, NEG_A, dueno.id, await material(NEG_A, "Vinil adhesivo brillante"), await material(NEG_A, "Transportador (vinil transfer)"), await maquina(NEG_A, "Plotter de impresión"), await maquina(NEG_A, "Láser CO2"));
    const matB = await prisma.material.findMany({ where: { negocioId: NEG_B }, orderBy: { nombre: "asc" } });
    const maqB = await prisma.maquina.findMany({ where: { negocioId: NEG_B }, orderBy: { nombre: "asc" } });
    await sembrarProduccion(prisma, NEG_B, duenoB.id, matB[0]!, matB[1]!, maqB[0]!, maqB[1]!);
    const ids = await prepararEjemplares(prisma, NEG_A, dueno.id, victimaA.id, { articuloEmpieza: "Sticker", materialEmpieza: "Vinil" });
    const idsB = await prepararEjemplares(prisma, NEG_B, duenoB.id, victimaB.id);
    const { sensibles, descartes } = await valoresSensibles(prisma);
    // Marca de cada negocio en los nombres de sus clientes, materiales, articulos, maquinas, listas y usuarios (despues de
    // sembrar, que busca por nombre): cualquier rastro en una respuesta del OTRO negocio es una fuga.
    for (const [negocioId, marca] of [[NEG_A, MARCA_A], [NEG_B, MARCA_B]] as const) {
      for (const tabla of ["clientes", "materiales", "articulos", "maquinas", "listas_precios", "usuarios"]) {
        await prisma.$executeRawUnsafe(`UPDATE "${tabla}" SET nombre = nombre || $1 WHERE "negocioId" = $2::uuid`, ` ${marca}`, negocioId);
      }
    }
    if (process.env.ACCESO_ROMPER) {
      console.log(`!!! ACCESO_ROMPER=${process.env.ACCESO_ROMPER}: la suite TIENE que fallar.`);
      await romperDeliberadamente(urlMig, process.env.ACCESO_ROMPER);
    }
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
    // PERMITIR_EMISOR_SIMULADO: en produccion la factura simulada esta deshabilitada; la prueba de aislamiento
    // factura de verdad por HTTP (emitirFactura / emitirNotaCredito) y necesita el emisor simulado.
    arrancarServidor({ ...entorno, NODE_ENV: "production", PORT: String(PUERTO), PERMITIR_EMISOR_SIMULADO: "1" });
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
    // La clasificacion de esta prueba y la auditoria estatica (scripts/auditoria-permisos.ts) tienen que coincidir:
    // /admin/** es del SUPERADMIN en las dos, y lo publico lo es en las dos.
    for (const r of rutas) {
      if (!r.archivo.startsWith("src/app/") || !(r.patron in CLASIFICACION)) continue;
      const claseEstatica = claseDeArchivo(r.archivo.slice("src/app/".length));
      const clase = CLASIFICACION[r.patron]!;
      if (claseEstatica === "superadmin" || clase === "superadmin") {
        chequear("clasificacion", claseEstatica === "superadmin" && clase === "superadmin", "una ruta de /admin/** es `superadmin` en la prueba y en la auditoria estatica (y solo ellas)", `${r.patron}: prueba=${clase}, auditoria=${claseEstatica}`, r.patron);
      } else if (claseEstatica === "publica") {
        chequear("clasificacion", clase === "publica", "una ruta publica de la auditoria estatica es `publica` en la prueba", `${r.patron}: prueba=${clase}`, r.patron);
      }
    }
    const hallazgosAdmin = auditarAdmin();
    chequear("clasificacion", hallazgosAdmin.length === 0, "todo lo de /admin/** (layout, paginas, acciones, route handlers) exige solo administrarNegocios y nada mas lo exige", hallazgosAdmin.map((h) => `${h.archivo}: ${h.detalle}`).join(" | "), "auditoria de /admin");

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
    comprobarSuelta(
      "el costo de un trabajo ANULADO no aparece en ninguna pagina del dueno",
      (vistos.get("costo de un trabajo anulado (no debe verse en ningun lado)") ?? 0) === 0,
      "el margen real esta contando un trabajo anulado",
    );
    for (const obligatoria of ["costo de material", "costo de venta", "ganancia", "margen", "valorizacion de stock", "costo de articulo", "costo estimado de reposicion", "costo real de produccion", "desvio de produccion", "margen real"]) {
      comprobarSuelta(`el dueno ve "${obligatoria}" (el detector no esta ciego)`, (vistos.get(obligatoria) ?? 0) > 0, "ninguna pagina del dueno muestra un valor de esta categoria");
    }

    // ─── Aislamiento entre negocios (VTA-20) ───
    const ai: Aislamiento = {
      prisma,
      negocios: {
        A: { lado: "A", id: NEG_A, slug: SLUG_A, marca: MARCA_A, ids, uuids: await uuidsDe(prisma, NEG_A) },
        B: { lado: "B", id: NEG_B, slug: SLUG_B, marca: MARCA_B, ids: idsB, uuids: await uuidsDe(prisma, NEG_B) },
      },
      actores: [
        { etiqueta: `dueño de ${SLUG_A}`, lado: "A", rol: "dueno", cookie: ses.dueno },
        { etiqueta: `empleado de ${SLUG_A}`, lado: "A", rol: "empleado", cookie: ses.empleado },
        { etiqueta: `dueño de ${SLUG_B}`, lado: "B", rol: "dueno", cookie: sesionesB.dueno },
        { etiqueta: `empleado de ${SLUG_B}`, lado: "B", rol: "empleado", cookie: sesionesB.empleado },
      ],
      objetivos,
    };
    chequear("preparacion", ai.negocios.A.uuids.size > 100 && ai.negocios.B.uuids.size > 100, "se conocen los ids de las filas de los dos negocios (>100 cada uno)", `A=${ai.negocios.A.uuids.size}, B=${ai.negocios.B.uuids.size}`);
    chequear("preparacion", ![...ai.negocios.A.uuids].some((x) => ai.negocios.B.uuids.has(x)), "ningun id esta en los dos negocios", "ids repetidos entre negocios");
    await aislamientoEstructura(ai);
    await aislamientoUrlsAjenas(ai);
    await aislamientoListados(ai);
    await aislamientoCsv(ai);
    await aislamientoParametros(ai, { A: { dueno: ses.dueno, empleado: ses.empleado }, B: sesionesB });
    await aislamientoAcciones(ai);
    await aislamientoRolDeLaApp(ai);
    if (process.env.ACCESO_SIN_RLS !== "1") correrTestRls(urlApp, urlMig);
    else avisos.push("test:rls omitido (ACCESO_SIN_RLS=1)");
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

  if (familias.size > 0) resumenDeAislamiento();

  if (avisos.length > 0) {
    console.log("");
    console.log("=== Avisos ===");
    for (const a of avisos) console.log(`AVISO ${a}`);
  }
  if (process.env.ACCESO_ROMPER) {
    console.log("");
    console.log(`!!! ACCESO_ROMPER=${process.env.ACCESO_ROMPER}: rotura deliberada. ${fallas.length > 0 ? "La suite FALLO, como tenia que pasar." : "La suite NO fallo: NO DETECTA esta rotura."}`);
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
