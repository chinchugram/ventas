import type { PrismaClient } from "@/generated/prisma/client";
import { ErrorDeNegocio } from "@/lib/acciones";
import {
  debeRenovar,
  estaEnPausa,
  formatoDeTokenValido,
  generarToken,
  HASH_FALSO,
  hashDeToken,
  hashearClave,
  necesitaRehash,
  normalizarUsuario,
  problemaDeClave,
  problemaDeUsuario,
  registrarFallo,
  vencimientoDesde,
  verificarClave,
  type Rol,
  type UsuarioSesion,
} from "@/lib/auth-pura";
import type { Tx } from "./tx";

// Nucleo de la autenticacion: login, sesiones y alta de usuarios. Recibe el
// cliente de Prisma (o un `tx`) y la hora: no depende de Next ni de cookies, asi
// lo usan el proxy, `src/lib/auth.ts`, el script de alta del dueno y
// `npm run test:auth:db` (scripts/test-auth.ts).

export type Db = PrismaClient | Tx;

const CAMPOS_SESION = { id: true, usuario: true, nombre: true, rol: true, activo: true } as const;

function aUsuarioSesion(u: { id: string; usuario: string; nombre: string; rol: Rol }): UsuarioSesion {
  return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export type ResultadoCredenciales = { ok: true; usuario: UsuarioSesion } | { ok: false };

/**
 * Verifica usuario y clave. Devuelve `{ ok: false }` sin decir por que (usuario
 * inexistente, inactivo, en pausa o clave incorrecta) y en todos los casos hace
 * un calculo de scrypt, para que el tiempo de respuesta tampoco lo diga.
 *
 * Contra los intentos en paralelo: antes de verificar, el intento se anota como
 * fallo con un UPDATE condicionado al estado leido (compare-and-swap). Si otro
 * intento cambio la fila en el medio, o si con ese fallo el usuario entra en
 * pausa, los que vienen detras ya no se verifican. Asi nadie puede probar cien
 * claves a la vez antes de que se registre el primer fallo, y no se mantiene
 * ninguna fila bloqueada mientras corre scrypt (que tarda ~0,3 s).
 */
export async function verificarCredenciales(
  db: Db,
  usuarioTipeado: string,
  clave: string,
  ahora: Date = new Date(),
): Promise<ResultadoCredenciales> {
  const fila = await db.usuario.findUnique({ where: { usuario: normalizarUsuario(usuarioTipeado) } });

  if (!fila || !fila.activo || estaEnPausa(fila, ahora)) {
    await verificarClave(clave, HASH_FALSO);
    return { ok: false };
  }

  // Se anota el fallo por adelantado; si la clave resulta correcta se borra.
  const fallo = registrarFallo(fila, ahora);
  const reservado = await db.usuario.updateMany({
    where: {
      id: fila.id,
      intentosFallidos: fila.intentosFallidos,
      ultimoFalloEn: fila.ultimoFalloEn,
      OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }],
    },
    data: fallo,
  });
  if (reservado.count === 0) {
    // Otro intento contra el mismo usuario se adelanto: este no se verifica.
    await verificarClave(clave, HASH_FALSO);
    return { ok: false };
  }

  if (!(await verificarClave(clave, fila.hashClave))) return { ok: false };

  await db.usuario.update({
    where: { id: fila.id },
    data: {
      intentosFallidos: 0,
      ultimoFalloEn: null,
      bloqueadoHasta: null,
      // Si cambiaron los parametros de scrypt, la clave se rehashea ahora que se conoce.
      ...(necesitaRehash(fila.hashClave) ? { hashClave: await hashearClave(clave) } : {}),
    },
  });
  return { ok: true, usuario: aUsuarioSesion(fila) };
}

export type SesionNueva = { token: string; expiraEn: Date };

/**
 * TRANSITORIO (VTA-22): el unico negocio que hay. Existe solo para que las
 * server actions tengan de donde sacar el `negocioId` explicito que piden las
 * funciones de dominio hasta que VTA-8 traiga el contexto de negocio de la
 * sesion. Con mas de un negocio falla: ahi ya no hay "el" negocio.
 */
export async function negocioUnico(db: Db): Promise<string> {
  const negocios = await db.negocio.findMany({ select: { id: true }, take: 2 });
  if (negocios.length === 1) return negocios[0]!.id;
  throw new ErrorDeNegocio(negocios.length === 0 ? "No hay ningún negocio." : "Hay más de un negocio: falta elegir cuál.");
}

/**
 * Negocio con el que se abre la sesion de un usuario: el suyo. Transitorio
 * (VTA-22): un usuario sin negocio (dado de alta antes de que el alta lo
 * asigne) usa el negocio unico si hay uno solo. El contexto de negocio de verdad
 * es de VTA-8.
 */
export async function negocioDeUsuario(db: Db, usuarioId: string): Promise<string> {
  const u = await db.usuario.findUnique({ where: { id: usuarioId }, select: { negocioId: true } });
  return u?.negocioId ?? (await negocioUnico(db));
}

/** Abre una sesion: token nuevo (nunca se reutiliza uno que traiga el navegador). Limpia las vencidas del usuario. */
export async function crearSesion(db: Db, negocioId: string, usuarioId: string, ahora: Date = new Date()): Promise<SesionNueva> {
  await db.sesion.deleteMany({ where: { usuarioId, expiraEn: { lte: ahora } } });
  const token = generarToken();
  const expiraEn = vencimientoDesde(ahora);
  await db.sesion.create({
    data: { negocioId, tokenHash: hashDeToken(token), usuarioId, creadaEn: ahora, renovadaEn: ahora, expiraEn },
  });
  return { token, expiraEn };
}

export type ResultadoLogin = ({ ok: true; usuario: UsuarioSesion } & SesionNueva) | { ok: false };

/** Verifica y, si corresponde, abre la sesion. Lo usa la accion de /login. */
export async function iniciarSesion(
  db: Db,
  usuario: string,
  clave: string,
  ahora: Date = new Date(),
): Promise<ResultadoLogin> {
  const verificado = await verificarCredenciales(db, usuario, clave, ahora);
  if (!verificado.ok) return { ok: false };
  const sesion = await crearSesion(db, await negocioDeUsuario(db, verificado.usuario.id), verificado.usuario.id, ahora);
  return { ok: true, usuario: verificado.usuario, ...sesion };
}

// ─── Sesion de cada pedido ────────────────────────────────────────────────────

export type SesionResuelta = {
  usuario: UsuarioSesion;
  /** Nuevo vencimiento si la sesion se extendio en este pedido (hay que reenviar la cookie). */
  renovadaHasta: Date | null;
};

/**
 * Usuario de un token de cookie, consultando la base cada vez: la sesion tiene
 * que existir, no estar vencida y su usuario tiene que estar activo. Una baja
 * corta la sesion en el pedido siguiente. Las sesiones vencidas o de usuarios
 * dados de baja se borran al encontrarlas.
 *
 * Con `renovar`, si paso mas de un dia desde la ultima extension, el vencimiento
 * se corre a 30 dias desde ahora (renovacion deslizante, una escritura por dia).
 */
export async function resolverSesion(
  db: Db,
  token: string | null | undefined,
  ahora: Date = new Date(),
  { renovar = false }: { renovar?: boolean } = {},
): Promise<SesionResuelta | null> {
  if (!formatoDeTokenValido(token)) return null;

  const sesion = await db.sesion.findUnique({
    where: { tokenHash: hashDeToken(token) },
    select: { id: true, expiraEn: true, renovadaEn: true, usuario: { select: CAMPOS_SESION } },
  });
  if (!sesion) return null;

  if (sesion.expiraEn.getTime() <= ahora.getTime() || !sesion.usuario.activo) {
    await db.sesion.deleteMany({ where: { id: sesion.id } });
    return null;
  }

  let renovadaHasta: Date | null = null;
  if (renovar && debeRenovar(sesion.renovadaEn, ahora)) {
    const expiraEn = vencimientoDesde(ahora);
    // Condicionado a `renovadaEn`: si llegan varios pedidos juntos, escribe uno solo.
    const { count } = await db.sesion.updateMany({
      where: { id: sesion.id, renovadaEn: sesion.renovadaEn },
      data: { renovadaEn: ahora, expiraEn },
    });
    if (count > 0) renovadaHasta = expiraEn;
  }

  return { usuario: aUsuarioSesion(sesion.usuario), renovadaHasta };
}

/** Cierra la sesion de este token (borra la fila). No falla si ya no existia. */
export async function cerrarSesion(db: Db, token: string | null | undefined): Promise<void> {
  if (!formatoDeTokenValido(token)) return;
  await db.sesion.deleteMany({ where: { tokenHash: hashDeToken(token) } });
}

/** Cierra todas las sesiones de un usuario: para la baja o el cambio de clave (4.4). */
export async function cerrarSesionesDeUsuario(db: Db, usuarioId: string): Promise<number> {
  const { count } = await db.sesion.deleteMany({ where: { usuarioId } });
  return count;
}

/** Hay al menos un usuario cargado. Sin ninguno, en produccion el sitio responde 503 con instrucciones. */
export async function hayUsuarios(db: Db): Promise<boolean> {
  return (await db.usuario.findFirst({ select: { id: true } })) !== null;
}

// ─── Alta ─────────────────────────────────────────────────────────────────────

export type DatosUsuarioNuevo = { usuario: string; nombre: string; rol: Rol; clave: string };

/** Alta de un usuario con validacion. Lanza `ErrorDeNegocio` con un mensaje para mostrar. */
export async function crearUsuarioEnTx(tx: Tx, datos: DatosUsuarioNuevo): Promise<UsuarioSesion> {
  const usuario = normalizarUsuario(datos.usuario);
  const nombre = datos.nombre.trim();
  const problema = problemaDeUsuario(usuario) ?? problemaDeClave(datos.clave);
  if (problema) throw new ErrorDeNegocio(problema);
  if (nombre.length === 0 || nombre.length > 80) throw new ErrorDeNegocio("El nombre debe tener entre 1 y 80 caracteres.");

  if (await tx.usuario.findUnique({ where: { usuario }, select: { id: true } })) {
    throw new ErrorDeNegocio(`Ya existe un usuario "${usuario}".`);
  }
  const creado = await tx.usuario.create({
    data: { usuario, nombre, rol: datos.rol, hashClave: await hashearClave(datos.clave) },
  });
  return aUsuarioSesion(creado);
}

/**
 * Alta del primer dueno (`npm run usuarios:crear-dueno`). Se niega si ya hay
 * algun dueno, aunque este dado de baja: por esta via no se crea un segundo.
 * Un lock de transaccion evita que dos corridas simultaneas creen dos.
 */
export async function crearDuenoEnTx(tx: Tx, datos: Omit<DatosUsuarioNuevo, "rol">): Promise<UsuarioSesion> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ventas:crear-dueno'))`;
  const existente = await tx.usuario.findFirst({ where: { rol: "DUENO" }, select: { usuario: true, activo: true } });
  if (existente) {
    throw new ErrorDeNegocio(
      `Ya existe un dueño (usuario "${existente.usuario}"${existente.activo ? "" : ", dado de baja"}). ` +
        "Este comando solo crea el primero; los demás usuarios se administran desde la app.",
    );
  }
  return crearUsuarioEnTx(tx, { ...datos, rol: "DUENO" });
}
