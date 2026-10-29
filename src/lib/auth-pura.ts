import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Piezas puras de la autenticacion: hash de claves, tokens de sesion, pausa por
// intentos fallidos y validaciones. Sin base, sin Next: las prueba
// `npm run test:auth` (scripts/verificar-auth.ts). Ver docs/seguridad-ola-4-auth.md.

export type Rol = "DUENO" | "EMPLEADO";

/** Lo unico que se sabe del usuario de la sesion. Nunca lleva el hash de la clave. */
export type UsuarioSesion = { id: string; usuario: string; nombre: string; rol: Rol };

// ─── Claves ───────────────────────────────────────────────────────────────────

export const CLAVE_MIN = 10;
/** Tope de largo: scrypt sobre entradas enormes seria una forma barata de cansar al servidor. */
export const CLAVE_MAX = 200;

/**
 * Parametros de scrypt. N = 2^15, r = 8, p = 3: una de las configuraciones
 * minimas equivalentes que recomienda OWASP (32 MiB de memoria por calculo).
 * Si se suben, los hashes viejos siguen validando (cada hash guarda los suyos) y
 * se rehashean solos en el siguiente login correcto (ver `necesitaRehash`).
 */
export const SCRYPT_ACTUAL: ParametrosScrypt = { ln: 15, r: 8, p: 3 };
const LARGO_SAL = 16;
const LARGO_HASH = 64;

export type ParametrosScrypt = { ln: number; r: number; p: number };

// Limites para leer un hash guardado: un valor corrupto en la base no debe poder
// pedir gigas de memoria ni minutos de CPU.
const LIMITES = { ln: [14, 20], r: [1, 32], p: [1, 16] } as const;

const FORMATO = /^scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{32,})$/;

/** `NFC` para que la misma clave tipeada en un iPhone y en una PC de el mismo hash. */
function bytesDeClave(clave: string): Buffer {
  return Buffer.from(clave.normalize("NFC"), "utf8");
}

function derivar(clave: string, sal: Buffer, { ln, r, p }: ParametrosScrypt, largo: number): Promise<Buffer> {
  const N = 2 ** ln;
  const opciones: ScryptOptions = { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scrypt(bytesDeClave(clave), sal, largo, opciones, (error, clave) => (error ? reject(error) : resolve(clave)));
  });
}

/**
 * Hash autodescriptivo: `scrypt$ln=15,r=8,p=3$<sal>$<hash>` (sal y hash en
 * base64url). Lleva los parametros para poder cambiarlos sin invalidar claves.
 */
export async function hashearClave(clave: string, parametros: ParametrosScrypt = SCRYPT_ACTUAL): Promise<string> {
  const sal = randomBytes(LARGO_SAL);
  const hash = await derivar(clave, sal, parametros, LARGO_HASH);
  return `scrypt$ln=${parametros.ln},r=${parametros.r},p=${parametros.p}$${sal.toString("base64url")}$${hash.toString("base64url")}`;
}

type HashLeido = { parametros: ParametrosScrypt; sal: Buffer; hash: Buffer };

export function leerHash(almacenado: string): HashLeido | null {
  const m = FORMATO.exec(almacenado);
  if (!m) return null;
  const parametros = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  for (const clave of ["ln", "r", "p"] as const) {
    const [min, max] = LIMITES[clave];
    if (parametros[clave] < min || parametros[clave] > max) return null;
  }
  const sal = Buffer.from(m[4]!, "base64url");
  const hash = Buffer.from(m[5]!, "base64url");
  if (sal.length < LARGO_SAL || hash.length < 32) return null;
  return { parametros, sal, hash };
}

/**
 * Hash que no corresponde a ninguna clave (sal y hash en cero). Contra el se
 * verifica cuando el usuario no existe, esta inactivo o en pausa: el servidor
 * hace el mismo trabajo y tarda lo mismo, asi el tiempo de respuesta no revela
 * si el usuario existe.
 */
export const HASH_FALSO = `scrypt$ln=${SCRYPT_ACTUAL.ln},r=${SCRYPT_ACTUAL.r},p=${SCRYPT_ACTUAL.p}$${Buffer.alloc(LARGO_SAL).toString("base64url")}$${Buffer.alloc(LARGO_HASH).toString("base64url")}`;

/** Compara en tiempo constante. Un hash ilegible cuenta como clave incorrecta (pero hace igual el trabajo). */
export async function verificarClave(clave: string, almacenado: string): Promise<boolean> {
  const leido = leerHash(almacenado);
  const usado = leido ?? leerHash(HASH_FALSO)!;
  const calculado = await derivar(clave, usado.sal, usado.parametros, usado.hash.length);
  const iguales = timingSafeEqual(calculado, usado.hash);
  return leido !== null && iguales;
}

/** true si el hash se hizo con otros parametros: conviene rehashear en el proximo login correcto. */
export function necesitaRehash(almacenado: string): boolean {
  const leido = leerHash(almacenado);
  if (!leido) return true;
  const { ln, r, p } = leido.parametros;
  return ln !== SCRYPT_ACTUAL.ln || r !== SCRYPT_ACTUAL.r || p !== SCRYPT_ACTUAL.p || leido.hash.length !== LARGO_HASH;
}

/** Mensaje de validacion de una clave nueva, o null si sirve. */
export function problemaDeClave(clave: string): string | null {
  const largo = [...clave.normalize("NFC")].length;
  if (largo < CLAVE_MIN) return `La clave debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (largo > CLAVE_MAX) return `La clave puede tener hasta ${CLAVE_MAX} caracteres.`;
  if (clave.trim().length === 0) return "La clave no puede ser solo espacios.";
  return null;
}

// ─── Nombre de usuario ────────────────────────────────────────────────────────
// Se guarda en minusculas (CHECK en la base) y se compara normalizado: "Dueno",
// " dueno " y "DUENO" son el mismo usuario.

export const USUARIO_PATRON = /^[a-z0-9._-]{3,40}$/;

export function normalizarUsuario(usuario: string): string {
  return usuario.normalize("NFC").trim().toLowerCase();
}

export function problemaDeUsuario(usuario: string): string | null {
  return USUARIO_PATRON.test(normalizarUsuario(usuario))
    ? null
    : "El usuario debe tener entre 3 y 40 caracteres: letras sin acentos, números, punto, guion o guion bajo.";
}

// ─── Tokens de sesion ─────────────────────────────────────────────────────────
// La cookie lleva el token; la base guarda solo su SHA-256. Quien lea la tabla
// (un respaldo filtrado, por ejemplo) no puede usar las sesiones.

const TOKEN_PATRON = /^[A-Za-z0-9_-]{43}$/;

/** 32 bytes aleatorios en base64url (43 caracteres). */
export function generarToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Filtro barato antes de ir a la base: lo que no tiene forma de token ni se busca. */
export function formatoDeTokenValido(token: string | undefined | null): token is string {
  return typeof token === "string" && TOKEN_PATRON.test(token);
}

export function hashDeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ─── Duracion y renovacion ────────────────────────────────────────────────────

const DIA_MS = 24 * 60 * 60 * 1000;
export const DURACION_SESION_MS = 30 * DIA_MS;
/** La sesion se extiende a lo sumo una vez por dia: no se escribe en la base en cada pedido. */
export const RENOVAR_CADA_MS = DIA_MS;

export function vencimientoDesde(ahora: Date): Date {
  return new Date(ahora.getTime() + DURACION_SESION_MS);
}

export function debeRenovar(renovadaEn: Date, ahora: Date): boolean {
  return ahora.getTime() - renovadaEn.getTime() >= RENOVAR_CADA_MS;
}

// ─── Cookie ───────────────────────────────────────────────────────────────────

/**
 * En produccion lleva el prefijo `__Host-`: el navegador solo la acepta con
 * `Secure`, `Path=/` y sin `Domain`, asi ningun subdominio puede pisarla. En
 * desarrollo (http://localhost o la IP de la PC en la Wi-Fi) no se puede usar.
 */
export function nombreCookie(produccion: boolean): string {
  return produccion ? "__Host-ventas_sesion" : "ventas_sesion";
}

/**
 * Atributos de la cookie de sesion: `httpOnly` (el JS de la pagina no la lee),
 * `secure` en produccion, `sameSite=lax` (no viaja en POST ni fetch de otros
 * sitios) y vencimiento igual al de la fila en la base.
 */
export function opcionesCookie(expiraEn: Date, produccion: boolean, ahora: Date = new Date()) {
  return {
    httpOnly: true,
    secure: produccion,
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.max(1, Math.floor((expiraEn.getTime() - ahora.getTime()) / 1000)),
  };
}

// ─── Pausa por intentos fallidos ──────────────────────────────────────────────
// Los primeros fallos no pausan (un error de tipeo no castiga). Desde el quinto,
// cada fallo pausa el doble que el anterior: 30 s, 1 min, 2 min, 4 min, 8 min y
// tope de 15 min. Nunca hay bloqueo permanente: un atacante no puede dejar al
// dueno afuera para siempre, y a lo sumo prueba 4 claves por hora.
// Si pasa un dia sin fallos, la cuenta vuelve a cero.

export const FALLOS_SIN_PAUSA = 4;
export const PAUSA_BASE_MS = 30_000;
export const PAUSA_MAX_MS = 15 * 60_000;
export const OLVIDAR_FALLOS_MS = DIA_MS;

export function pausaTrasFallos(fallos: number): number {
  if (fallos <= FALLOS_SIN_PAUSA) return 0;
  return Math.min(PAUSA_BASE_MS * 2 ** Math.min(fallos - FALLOS_SIN_PAUSA - 1, 20), PAUSA_MAX_MS);
}

export type EstadoFallos = { intentosFallidos: number; ultimoFalloEn: Date | null; bloqueadoHasta: Date | null };

export function estaEnPausa(estado: Pick<EstadoFallos, "bloqueadoHasta">, ahora: Date): boolean {
  return estado.bloqueadoHasta !== null && estado.bloqueadoHasta.getTime() > ahora.getTime();
}

/** Estado despues de un intento fallido (con la clave verificada: no se cuenta lo que llega en pausa). */
export function registrarFallo(estado: EstadoFallos, ahora: Date): EstadoFallos {
  const viejo = estado.ultimoFalloEn === null || ahora.getTime() - estado.ultimoFalloEn.getTime() >= OLVIDAR_FALLOS_MS;
  const intentosFallidos = (viejo ? 0 : estado.intentosFallidos) + 1;
  const pausa = pausaTrasFallos(intentosFallidos);
  return {
    intentosFallidos,
    ultimoFalloEn: ahora,
    bloqueadoHasta: pausa > 0 ? new Date(ahora.getTime() + pausa) : null,
  };
}

// ─── Destino despues de entrar ────────────────────────────────────────────────

export function inicioDeRol(rol: Rol): string {
  return rol === "DUENO" ? "/" : "/ventas/nueva";
}

/**
 * `?siguiente=` solo si es una ruta interna: empieza con una sola `/`, sin `\`,
 * sin caracteres de control y sin volver a /login. Cualquier otra cosa (`//evil`,
 * `https://...`, `/\evil`, `javascript:`) se ignora: evita redirecciones abiertas.
 */
export function destinoSeguro(siguiente: string | null | undefined): string | null {
  if (typeof siguiente !== "string" || siguiente.length === 0 || siguiente.length > 1000) return null;
  if (!siguiente.startsWith("/") || siguiente.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(siguiente)) return null;
  try {
    const base = "http://interno.invalid";
    const url = new URL(siguiente, base);
    if (url.origin !== base) return null;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

// ─── Mensajes ─────────────────────────────────────────────────────────────────

/**
 * Unico mensaje de error del login. Es el mismo si el usuario no existe, si la
 * clave esta mal, si el usuario esta dado de baja o si esta en pausa: no revela
 * cual fue.
 */
export const ERROR_LOGIN =
  "Usuario o clave incorrectos. Si fallaste varias veces seguidas, esperá unos minutos antes de volver a intentar.";
