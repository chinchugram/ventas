import { NextResponse, type NextRequest } from "next/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { dbDisponible } from "@/lib/prisma";
import { destinoSeguro, nombreCookie, opcionesCookie } from "@/lib/auth-pura";
import { hayUsuarios, resolverSesion, type Db, type SesionResuelta } from "@/lib/dominio/auth";

/**
 * Primer filtro de acceso: corre antes de cada pagina, navegacion del cliente
 * (RSC), server action (POST) y route handler (export CSV).
 *
 * Next 16 ejecuta el proxy en Node.js, asi que aca la sesion se verifica de
 * verdad contra la base (existe, no vencio, usuario activo), no solo por la
 * presencia de la cookie: es la unica puerta por la que pasan todos los pedidos,
 * incluidas las acciones y paginas que todavia no llaman a `requiereUsuario()`.
 * Igual NO es la unica defensa: paginas y acciones verifican con `usuarioActual()`
 * / `requierePermiso()` (ver docs/seguridad-ola-4-auth.md).
 *
 * - Sin sesion: GET → /login?siguiente=<ruta>; server action → 401 (el cliente
 *   navega a /login); cualquier otro metodo → 303 a /login. Nada de eso ejecuta codigo.
 * - Sesion valida: sigue, y una vez por dia extiende el vencimiento (cookie nueva).
 * - Sin ningun usuario en la base: 503 con instrucciones (nunca queda abierto).
 * - Sin base: en desarrollo sigue (modo demo, "Demo" como dueno); en produccion 503.
 */

const PRODUCCION = process.env.NODE_ENV === "production";
const COOKIE = nombreCookie(PRODUCCION);

// Cliente propio y chico: el proxy se empaqueta aparte de la app y no comparte
// el singleton de `src/lib/prisma.ts` (evita mezclar instancias de dos bundles).
const globalProxy = globalThis as unknown as { prismaDelProxy?: PrismaClient };
function db(): Db {
  if (!globalProxy.prismaDelProxy) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Falta DATABASE_URL");
    globalProxy.prismaDelProxy = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3 }), log: ["error"] });
  }
  return globalProxy.prismaDelProxy;
}

// Los usuarios nunca se borran (baja logica): una vez que hay uno, siempre hay.
let hayUsuariosConfirmado = false;
async function hayAlgunUsuario(): Promise<boolean> {
  if (!hayUsuariosConfirmado) hayUsuariosConfirmado = await hayUsuarios(db());
  return hayUsuariosConfirmado;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Solo `next dev`: recursos internos del servidor de desarrollo (recarga en caliente, overlay).
  if (!PRODUCCION && (pathname.startsWith("/_next/") || pathname.startsWith("/__nextjs"))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE)?.value;
  let sesion: SesionResuelta | null = null;
  try {
    if (token) sesion = await resolverSesion(db(), token, new Date(), { renovar: true });
    if (!sesion && !(await hayAlgunUsuario())) return pagina503(SIN_USUARIOS);
  } catch (error) {
    const hayBase = await dbDisponible();
    if (!hayBase && !PRODUCCION) return conCabeceras(NextResponse.next()); // modo demo
    if (hayBase) console.error("[proxy] No se pudo verificar la sesion:", error);
    else console.error("[proxy] La base no responde: se responde 503.");
    return pagina503(hayBase ? ERROR_VERIFICANDO : SIN_BASE);
  }

  if (sesion) {
    const respuesta = NextResponse.next();
    if (token && sesion.renovadaHasta) {
      respuesta.cookies.set(COOKIE, token, opcionesCookie(sesion.renovadaHasta, PRODUCCION));
    }
    return conCabeceras(respuesta);
  }

  // Sin sesion valida. /login (la pagina y su accion de entrar) es lo unico que se atiende.
  const respuesta = pathname === "/login" ? NextResponse.next() : sinSesion(request);
  // Cookie vencida, revocada o trucha: se borra (con los mismos atributos, o `__Host-` la rechaza).
  if (token) respuesta.cookies.set(COOKIE, "", { ...opcionesCookie(new Date(), PRODUCCION), maxAge: 0 });
  return conCabeceras(respuesta);
}

function sinSesion(request: NextRequest): NextResponse {
  const login = new URL("/login", request.url);
  const destino = new URL(request.nextUrl);
  destino.searchParams.delete("_rsc"); // parametro interno de las navegaciones del cliente
  const siguiente = destinoSeguro(`${destino.pathname}${destino.search}`);
  if (siguiente && siguiente !== "/") login.searchParams.set("siguiente", siguiente);

  if (request.method === "GET" || request.method === "HEAD") return NextResponse.redirect(login);

  // POST y demas: la accion NO corre. A una server action llamada desde la app
  // (cabecera Next-Action) se le contesta 401 con `x-action-redirect`, que el
  // cliente de Next entiende como "navegar a /login" en vez de mostrar un error
  // de conexion. Un formulario enviado sin JS recibe un 303 a /login.
  if (request.headers.has("next-action")) {
    return new NextResponse("Sesión vencida o inexistente. Volvé a entrar.", {
      status: 401,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "x-action-redirect": `${login.pathname}${login.search};replace`,
      },
    });
  }
  return NextResponse.redirect(login, 303);
}

/** Nadie puede meter el sitio en un iframe (clickjacking sobre el login o los botones). */
function conCabeceras(respuesta: NextResponse): NextResponse {
  respuesta.headers.set("X-Frame-Options", "DENY");
  respuesta.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  respuesta.headers.set("X-Content-Type-Options", "nosniff");
  respuesta.headers.set("Referrer-Policy", "same-origin");
  return respuesta;
}

const SIN_USUARIOS = {
  titulo: "Falta crear el primer usuario",
  texto:
    "Todavía no hay ningún usuario cargado, así que nadie puede entrar. En el servidor, en la carpeta del proyecto, corré <code>npm run usuarios:crear-dueno</code> y seguí las instrucciones. Después recargá esta página.",
};
const SIN_BASE = {
  titulo: "Sistema no disponible",
  texto: "La base de datos no responde, así que no se puede verificar quién entra. Revisá que Postgres esté levantado y que <code>DATABASE_URL</code> sea correcta.",
};
const ERROR_VERIFICANDO = {
  titulo: "Sistema no disponible",
  texto: "No se pudo verificar la sesión. Si se actualizó el sistema, falta aplicar las migraciones: <code>npm run db:deploy</code>.",
};

function pagina503({ titulo, texto }: { titulo: string; texto: string }): NextResponse {
  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1a171a;line-height:1.5}code{background:#f1f5f9;padding:.1rem .3rem;border-radius:.25rem}</style></head><body><h1>${titulo}</h1><p>${texto}</p></body></html>`;
  return conCabeceras(
    new NextResponse(html, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" },
    }),
  );
}

export const config = {
  // Todo pasa por el proxy salvo los archivos estaticos de Next y lo que el
  // navegador pide sin sesion: el manifiesto, los iconos de la app instalable y
  // el logo (se ve en /login). `/_next/image` NO se excluye: con
  // `images.unoptimized` no se usa, y si alguien lo pide necesita sesion.
  matcher: ["/((?!_next/static/|manifest\\.webmanifest$|icon\\.png$|apple-icon\\.png$|marca/).*)"],
};
