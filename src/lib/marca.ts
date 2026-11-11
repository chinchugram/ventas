import { cache } from "react";
import { conRespaldo } from "@/lib/respaldo";
import { DEMO_CONFIG } from "@/lib/demo-data";
import { conNegocio, type TxNegocio } from "@/lib/negocio";
import { prisma } from "@/lib/prisma";
import { normalizarSlug, slugValido } from "@/lib/auth-pura";
import { inicialesDe, logoUrlSegura, tipoPorExtension, type LogoValidado, type TipoLogo } from "@/lib/marca-pura";

/**
 * Marca visual del negocio (F4.2): nombre y logo propios de cada negocio.
 *
 * La INTERFAZ de la app no usa colores del negocio: usa siempre la marca Kiwitt (docs/brand/).
 * Del negocio se muestran su nombre y su logo (encabezado, /login) y los documentos para su
 * cliente final (comprobante, presupuesto). Decisión en docs/brand/README.md, "Cómo se aplica en ventas".
 *
 * Nombre: la clave `nombreNegocio` de la configuracion del negocio (la edita el dueño en
 * /configuracion); si falta, `Negocio.nombre`.
 *
 * Logo, en este orden:
 *  1. el que subio el dueño (se guarda en la tabla `configuracion` del negocio, ver abajo);
 *  2. `Negocio.logoUrl` (ruta del sitio o https; asi el negocio inicial conserva `/marca/logo.png`);
 *  3. ninguno → placeholder neutro con las iniciales del nombre.
 *
 * DONDE SE GUARDA EL LOGO SUBIDO (decision documentada, el ticket pedia elegir):
 *  en la tabla `configuracion` del propio negocio (claves `logoMime`, `logoDatos` en base64 y
 *  `logoVersion` con el hash del contenido). Se descartaron:
 *   - archivo estatico por negocio: en Vercel el sistema de archivos es de solo lectura;
 *   - Vercel Blob: agrega una dependencia y un token, y no se puede probar contra Postgres local.
 *  Con la base el logo queda dentro del mismo respaldo, aislado por RLS como todo lo del negocio
 *  y sin servicios nuevos. Como `negocios` es de solo lectura para el rol de la app (F2.1), no se
 *  escribe `Negocio.logoUrl`: lo subido lo sirve `/marca/logo/<slug>` (src/app/marca/logo/[slug]/route.ts,
 *  publica a proposito: el proxy excluye `marca/` y el /login lo necesita sin sesion), con la
 *  version en la URL para cachearlo "para siempre" sin quedar viejo al cambiarlo.
 *  Si algun dia los logos pesan, se mueve a Blob cambiando solo `guardarLogoEnTx` / `leerLogo`.
 */

export const CLAVES_LOGO = { tipo: "logoMime", datos: "logoDatos", version: "logoVersion" } as const;

export type Marca = {
  nombre: string;
  /** URL del logo, o `null` si no hay (se muestran las iniciales). */
  logo: string | null;
  /** Tipo de imagen del logo, si se conoce (para los iconos del manifiesto). */
  logoTipo: TipoLogo | null;
  /** `true` si el logo lo subio el negocio (no es el de `Negocio.logoUrl`). */
  logoPropio: boolean;
  iniciales: string;
};

function armarMarca(nombre: string, logo: string | null, logoTipo: TipoLogo | null, logoPropio: boolean): Marca {
  return { nombre, logo, logoTipo, logoPropio, iniciales: inicialesDe(nombre) };
}

/** Sin sesion ni negocio elegido: ninguna marca de ningun negocio. */
export const MARCA_NEUTRA: Marca = armarMarca("Ventas", null, null, false);

/** Sin base (modo demo): el nombre del juego de datos de ejemplo y sin logo. */
function marcaDemo(): Marca {
  return armarMarca(DEMO_CONFIG.nombreNegocio ?? "Ventas", null, null, false);
}

const TIPOS: readonly string[] = ["image/png", "image/jpeg", "image/svg+xml"];

/** Marca de un negocio ya identificado. Corre en el contexto RLS de ese negocio. */
async function marcaDeNegocioEnTx(tx: TxNegocio, negocioId: string): Promise<Marca | null> {
  const negocio = await tx.negocio.findUnique({ where: { id: negocioId } });
  if (!negocio) return null;
  // Sin `logoDatos`: es el archivo entero y no hace falta para armar la URL.
  const filas = await tx.configuracion.findMany({
    where: { negocioId, clave: { in: ["nombreNegocio", CLAVES_LOGO.tipo, CLAVES_LOGO.version] } },
  });
  const cfg = new Map(filas.map((f) => [f.clave, f.valor]));
  const nombre = cfg.get("nombreNegocio")?.trim() || negocio.nombre;

  const version = cfg.get(CLAVES_LOGO.version);
  const tipo = cfg.get(CLAVES_LOGO.tipo);
  if (version && /^[0-9a-f]{8,64}$/.test(version) && tipo && TIPOS.includes(tipo)) {
    return armarMarca(nombre, `/marca/logo/${negocio.slug}?v=${version}`, tipo as TipoLogo, true);
  }
  const url = logoUrlSegura(negocio.logoUrl);
  return armarMarca(nombre, url, url ? tipoPorExtension(url) : null, false);
}

/**
 * La marca del negocio de la SESION (navbar, titulo, manifiesto, comprobante). Sin sesion
 * (p. ej. /login) devuelve la marca neutra, sin avisos: en /login la marca sale del negocio
 * elegido, ver `getMarcaPorSlug`. Cacheado por pedido.
 */
export const getMarca = cache(async (): Promise<Marca> => {
  const { usuarioActual } = await import("@/lib/auth");
  const usuario = await usuarioActual();
  if (!usuario) return MARCA_NEUTRA;
  return conRespaldo(
    async () => (await conNegocio(usuario.negocioId, (tx) => marcaDeNegocioEnTx(tx, usuario.negocioId))) ?? MARCA_NEUTRA,
    marcaDemo,
  );
});

/**
 * La marca del negocio con ese slug, para /login (todavia no hay sesion). Un slug mal formado,
 * reservado, inexistente o de un negocio inactivo da la marca neutra: la pantalla no distingue
 * "no existe" de "sin logo". Nunca lanza.
 */
export const getMarcaPorSlug = cache(async (slug: string | null | undefined): Promise<Marca> => {
  if (!slug || !slugValido(slug)) return MARCA_NEUTRA;
  try {
    const negocio = await prisma.negocio.findUnique({ where: { slug: normalizarSlug(slug) }, select: { id: true, activo: true } });
    if (!negocio || !negocio.activo) return MARCA_NEUTRA;
    return (await conNegocio(negocio.id, (tx) => marcaDeNegocioEnTx(tx, negocio.id))) ?? MARCA_NEUTRA;
  } catch (error) {
    console.error("[marca] No se pudo leer la marca del negocio:", error);
    return MARCA_NEUTRA;
  }
});

// ─── Logo subido ─────────────────────────────────────────────────────────────

async function hashDelContenido(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Guarda (o reemplaza) el logo del negocio. `logo` viene de `validarLogo`. Devuelve la version. */
export async function guardarLogoEnTx(tx: TxNegocio, negocioId: string, logo: LogoValidado): Promise<string> {
  const version = await hashDelContenido(logo.bytes);
  const valores: Record<string, string> = {
    [CLAVES_LOGO.tipo]: logo.tipo,
    [CLAVES_LOGO.datos]: Buffer.from(logo.bytes).toString("base64"),
    [CLAVES_LOGO.version]: version,
  };
  for (const [clave, valor] of Object.entries(valores)) {
    await tx.configuracion.upsert({
      where: { negocioId_clave: { negocioId, clave } },
      update: { valor },
      create: { negocioId, clave, valor },
    });
  }
  return version;
}

/** Quita el logo subido: el negocio vuelve a `Negocio.logoUrl` o a las iniciales. */
export async function quitarLogoEnTx(tx: TxNegocio, negocioId: string): Promise<void> {
  // `negocioId` explicito ademas de RLS: con un rol que se salta RLS (superusuario, migracion)
  // no puede borrar el logo de otro negocio.
  await tx.configuracion.deleteMany({ where: { negocioId, clave: { in: Object.values(CLAVES_LOGO) } } });
}

export type LogoGuardado = { tipo: TipoLogo; bytes: Uint8Array; version: string };

/**
 * El logo subido por el negocio con ese slug, o `null` (sin logo propio, slug invalido,
 * inexistente o inactivo). Lo usa la ruta publica `/marca/logo/<slug>`.
 */
export async function leerLogoPorSlug(slug: string): Promise<LogoGuardado | null> {
  if (!slugValido(slug)) return null;
  const negocio = await prisma.negocio.findUnique({ where: { slug: normalizarSlug(slug) }, select: { id: true, activo: true } });
  if (!negocio || !negocio.activo) return null;
  const filas = await conNegocio(negocio.id, (tx) =>
    tx.configuracion.findMany({ where: { negocioId: negocio.id, clave: { in: Object.values(CLAVES_LOGO) } } }),
  );
  const cfg = new Map(filas.map((f) => [f.clave, f.valor]));
  const tipo = cfg.get(CLAVES_LOGO.tipo);
  const datos = cfg.get(CLAVES_LOGO.datos);
  const version = cfg.get(CLAVES_LOGO.version);
  if (!tipo || !TIPOS.includes(tipo) || !datos || !version) return null;
  return { tipo: tipo as TipoLogo, bytes: new Uint8Array(Buffer.from(datos, "base64")), version };
}
