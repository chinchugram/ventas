/**
 * Verificacion de la logica pura de autenticacion y permisos (sin base, sin Next).
 *
 *   npm run test:auth
 *
 * Al final lista las paginas, acciones y route handlers que todavia no llaman a
 * una verificacion de sesion propia (hoy los cubre solo el proxy). Con
 * AUTH_ESTRICTO=1 eso cuenta como falla: para cuando 4.3 termine de cubrirlas.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CLAVE_MAX,
  CLAVE_MIN,
  debeRenovar,
  destinoSeguro,
  estaEnPausa,
  formatoDeTokenValido,
  generarToken,
  HASH_FALSO,
  hashDeToken,
  hashearClave,
  inicioDeRol,
  leerHash,
  necesitaRehash,
  nombreCookie,
  normalizarUsuario,
  opcionesCookie,
  PAUSA_MAX_MS,
  pausaTrasFallos,
  problemaDeClave,
  problemaDeUsuario,
  registrarFallo,
  SCRYPT_ACTUAL,
  verificarClave,
  type EstadoFallos,
} from "../src/lib/auth-pura";
import { ACCIONES, puede, type Accion } from "../src/lib/permisos-pura";

let fallos = 0;

function comprobar(etiqueta: string, obtenido: string, esperado: string) {
  const ok = obtenido === esperado;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK  " : "FALLA"} ${etiqueta}: ${obtenido}${ok ? "" : ` (esperado ${esperado})`}`);
}

const HORA = 60 * 60 * 1000;
const T0 = new Date("2026-03-01T12:00:00Z");
const mas = (ms: number, desde: Date = T0) => new Date(desde.getTime() + ms);

async function main() {
  console.log("--- Hash de claves (scrypt) ---");
  const clave = "una clave larga";
  const hash = await hashearClave(clave);
  const { ln, r, p } = SCRYPT_ACTUAL;
  comprobar("formato autodescriptivo", String(hash.startsWith(`scrypt$ln=${ln},r=${r},p=${p}$`)), "true");
  comprobar("se puede leer", String(leerHash(hash) !== null), "true");
  comprobar("sal de 16 bytes y hash de 64", `${leerHash(hash)?.sal.length}/${leerHash(hash)?.hash.length}`, "16/64");
  comprobar("la clave correcta verifica", String(await verificarClave(clave, hash)), "true");
  comprobar("otra clave no", String(await verificarClave("una clave larga ", hash)), "false");
  comprobar("mayusculas importan", String(await verificarClave("Una clave larga", hash)), "false");
  comprobar("misma clave, otro hash (sal por usuario)", String((await hashearClave(clave)) !== hash), "true");
  comprobar("no guarda la clave", String(hash.includes(clave)), "false");

  // "José" con la e acentuada en un caracter (NFC) o en dos (e + acento, NFD).
  const compuesta = "contraseña José";
  const descompuesta = compuesta.normalize("NFD");
  comprobar("NFC y NFD son la misma clave", String(await verificarClave(descompuesta, await hashearClave(compuesta))), "true");

  comprobar("el hash falso no verifica nada", String(await verificarClave("", HASH_FALSO)), "false");
  comprobar("hash ilegible → false", String(await verificarClave(clave, "texto plano")), "false");
  comprobar("hash vacio → false", String(await verificarClave("", "")), "false");
  const enorme = hash.replace(`ln=${ln}`, "ln=30");
  comprobar("parametros absurdos no se leen (DoS)", String(leerHash(enorme)), "null");
  comprobar("...y no verifican", String(await verificarClave(clave, enorme)), "false");
  const truncado = hash.slice(0, hash.lastIndexOf("$") + 10);
  comprobar("hash truncado → false", String(await verificarClave(clave, truncado)), "false");

  const viejo = await hashearClave(clave, { ln: 14, r: 8, p: 1 });
  comprobar("hash con otros parametros sigue verificando", String(await verificarClave(clave, viejo)), "true");
  comprobar("...y pide rehash", String(necesitaRehash(viejo)), "true");
  comprobar("el actual no pide rehash", String(necesitaRehash(hash)), "false");
  comprobar("uno ilegible pide rehash", String(necesitaRehash("x")), "true");

  // Mismo trabajo con y sin usuario: el tiempo no debe revelar si existe.
  const medir = async (almacenado: string) => {
    const t = performance.now();
    for (let i = 0; i < 3; i++) await verificarClave("probando-tiempos", almacenado);
    return performance.now() - t;
  };
  const conUsuario = await medir(hash);
  const sinUsuario = await medir(HASH_FALSO);
  const razon = sinUsuario / conUsuario;
  console.log(`     (tiempos: con usuario ${conUsuario.toFixed(0)} ms, hash falso ${sinUsuario.toFixed(0)} ms)`);
  comprobar("hash falso tarda parecido (0,6–1,6×)", String(razon > 0.6 && razon < 1.6), "true");

  console.log("--- Validacion de claves ---");
  comprobar(`${CLAVE_MIN - 1} caracteres`, String(problemaDeClave("a".repeat(CLAVE_MIN - 1)) !== null), "true");
  comprobar(`${CLAVE_MIN} caracteres`, String(problemaDeClave("a".repeat(CLAVE_MIN))), "null");
  comprobar(`${CLAVE_MAX} caracteres`, String(problemaDeClave("a".repeat(CLAVE_MAX))), "null");
  comprobar(`${CLAVE_MAX + 1} caracteres (tope contra DoS)`, String(problemaDeClave("a".repeat(CLAVE_MAX + 1)) !== null), "true");
  comprobar("solo espacios", String(problemaDeClave(" ".repeat(12)) !== null), "true");
  comprobar("emoji cuenta como uno", String(problemaDeClave("🔒".repeat(CLAVE_MIN))), "null");

  console.log("--- Nombre de usuario ---");
  comprobar("normaliza", normalizarUsuario("  Dueno "), "dueno");
  comprobar("mayusculas", normalizarUsuario("LAURA.P"), "laura.p");
  comprobar("valido", String(problemaDeUsuario("laura.p")), "null");
  comprobar("valido con mayusculas (se normaliza)", String(problemaDeUsuario(" Laura ")), "null");
  comprobar("muy corto", String(problemaDeUsuario("ab") !== null), "true");
  comprobar("con espacio", String(problemaDeUsuario("la ura") !== null), "true");
  comprobar("con ñ", String(problemaDeUsuario("dueño") !== null), "true");
  comprobar("41 caracteres", String(problemaDeUsuario("a".repeat(41)) !== null), "true");

  console.log("--- Tokens de sesion ---");
  const token = generarToken();
  comprobar("43 caracteres base64url", String(/^[A-Za-z0-9_-]{43}$/.test(token)), "true");
  comprobar("formato valido", String(formatoDeTokenValido(token)), "true");
  comprobar("no se repiten", String(new Set(Array.from({ length: 200 }, generarToken)).size), "200");
  comprobar("hash SHA-256 en hex", String(/^[0-9a-f]{64}$/.test(hashDeToken(token))), "true");
  comprobar("hash estable", String(hashDeToken(token) === hashDeToken(token)), "true");
  comprobar("el hash no es el token", String(hashDeToken(token).includes(token)), "false");
  comprobar("vacio no", String(formatoDeTokenValido("")), "false");
  comprobar("undefined no", String(formatoDeTokenValido(undefined)), "false");
  comprobar("corto no", String(formatoDeTokenValido("abc")), "false");
  comprobar("44 caracteres no", String(formatoDeTokenValido(`${token}a`)), "false");
  comprobar("con relleno = no", String(formatoDeTokenValido(`${token.slice(0, 42)}=`)), "false");
  comprobar("con comillas no", String(formatoDeTokenValido(`'${token.slice(0, 41)}'`)), "false");

  console.log("--- Vencimiento y renovacion ---");
  comprobar("23 h despues no renueva", String(debeRenovar(T0, mas(23 * HORA))), "false");
  comprobar("24 h despues renueva", String(debeRenovar(T0, mas(24 * HORA))), "true");
  const cookie = opcionesCookie(mas(30 * 24 * HORA), true, T0);
  comprobar(
    "cookie en produccion",
    `${cookie.httpOnly}/${cookie.secure}/${cookie.sameSite}/${cookie.path}/${cookie.maxAge}`,
    `true/true/lax///${30 * 24 * 3600}`,
  );
  comprobar("cookie en desarrollo no es secure", String(opcionesCookie(mas(HORA), false, T0).secure), "false");
  comprobar("nombre con __Host- en produccion", nombreCookie(true), "__Host-ventas_sesion");
  comprobar("nombre en desarrollo", nombreCookie(false), "ventas_sesion");

  console.log("--- Pausa por intentos fallidos ---");
  comprobar(
    "pausa por cantidad de fallos (s)",
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50, 1000].map((n) => pausaTrasFallos(n) / 1000).join(","),
    "0,0,0,0,30,60,120,240,480,900,900,900",
  );
  comprobar("tope de 15 min", String(PAUSA_MAX_MS), String(15 * 60_000));

  let estado: EstadoFallos = { intentosFallidos: 0, ultimoFalloEn: null, bloqueadoHasta: null };
  let ahora = T0;
  for (let i = 0; i < 4; i++) {
    estado = registrarFallo(estado, ahora);
    ahora = mas(1000, ahora);
  }
  comprobar("4 fallos: sin pausa", `${estado.intentosFallidos}/${estaEnPausa(estado, ahora)}`, "4/false");
  estado = registrarFallo(estado, ahora);
  comprobar("5.º fallo: pausa", `${estado.intentosFallidos}/${estaEnPausa(estado, ahora)}`, "5/true");
  comprobar("29 s despues sigue en pausa", String(estaEnPausa(estado, mas(29_000, ahora))), "true");
  comprobar("30 s despues ya no", String(estaEnPausa(estado, mas(30_000, ahora))), "false");
  ahora = mas(30_000, ahora);
  estado = registrarFallo(estado, ahora);
  comprobar("6.º fallo: 1 min", String((estado.bloqueadoHasta!.getTime() - ahora.getTime()) / 1000), "60");
  for (let i = 0; i < 20; i++) {
    ahora = estado.bloqueadoHasta!;
    estado = registrarFallo(estado, ahora);
  }
  comprobar("muchos fallos: nunca mas de 15 min", String((estado.bloqueadoHasta!.getTime() - ahora.getTime()) / 60_000), "15");
  const otroDia = registrarFallo(estado, mas(25 * HORA, ahora));
  comprobar("un dia sin fallos: la cuenta vuelve a empezar", `${otroDia.intentosFallidos}/${otroDia.bloqueadoHasta}`, "1/null");

  console.log("--- Destino despues de entrar (?siguiente=) ---");
  const casos: [string | null, string | null][] = [
    ["/ventas", "/ventas"],
    ["/ventas/nueva?cliente=1#x", "/ventas/nueva?cliente=1#x"],
    ["/", "/"],
    ["//evil.com", null],
    ["//evil.com/ventas", null],
    ["/\\evil.com", null],
    ["\\\\evil.com", null],
    ["https://evil.com", null],
    ["http:/evil.com", null],
    ["javascript:alert(1)", null],
    ["ventas", null],
    ["/\tevil", null],
    ["/\nevil", null],
    ["/login", null],
    ["/login?siguiente=/ventas", null],
    ["", null],
    [null, null],
    [`/${"a".repeat(1001)}`, null],
  ];
  for (const [entrada, esperado] of casos) {
    comprobar(`siguiente=${JSON.stringify(entrada)}`, String(destinoSeguro(entrada)), String(esperado));
  }
  comprobar("inicio del dueno", inicioDeRol("DUENO"), "/");
  comprobar("inicio del empleado", inicioDeRol("EMPLEADO"), "/ventas/nueva");

  console.log("--- Permisos ---");
  comprobar("12 acciones", String(ACCIONES.length), "12");
  comprobar("el dueno puede todo", String(ACCIONES.every((a) => puede({ rol: "DUENO" }, a))), "true");
  comprobar("el empleado ninguna de la lista", String(ACCIONES.some((a) => puede({ rol: "EMPLEADO" }, a))), "false");
  comprobar("sin usuario, nada", String(ACCIONES.some((a) => puede(null, a))), "false");
  comprobar("accion desconocida, nada", String(puede({ rol: "EMPLEADO" }, "toString" as Accion)), "false");

  auditarRutas();

  console.log("");
  if (fallos > 0) {
    console.log(`${fallos} comprobacion(es) fallaron.`);
    process.exit(1);
  }
  console.log("Todas las comprobaciones pasaron.");
}

/**
 * Paginas, acciones y route handlers sin verificacion propia. Hoy el proxy los
 * cubre a todos (verifica la sesion contra la base en cada pedido); este listado
 * es para que 4.3 agregue `requiereUsuario()` / `requierePermiso()` en cada uno.
 */
function auditarRutas() {
  console.log("--- Rutas sin verificacion propia (las cubre el proxy) ---");
  const raiz = join(__dirname, "..", "src", "app");
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/^(page\.tsx|actions\.ts|route\.ts)$/.test(e.name)) archivos.push(ruta);
    }
  };
  recorrer(raiz);
  const VERIFICA = /\b(requiereUsuario|requierePermiso|verificarPermiso|usuarioParaAccion|usuarioActual)\s*\(/;
  const PUBLICAS = new Set(["login/page.tsx", "login/actions.ts"]);
  const sinVerificar = archivos
    .map((a) => relative(raiz, a))
    .filter((a) => !PUBLICAS.has(a) && !VERIFICA.test(readFileSync(join(raiz, a), "utf8")))
    .sort();
  const estricto = process.env.AUTH_ESTRICTO === "1";
  for (const a of sinVerificar) console.log(`${estricto ? "FALLA" : "AVISO"} src/app/${a}`);
  if (estricto) fallos += sinVerificar.length;
  console.log(`     ${sinVerificar.length} de ${archivos.length} sin verificacion propia${estricto ? "" : " (AUTH_ESTRICTO=1 las cuenta como falla)"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
