import type { PrismaClient } from "@/generated/prisma/client";
import { ErrorDeNegocio } from "@/lib/acciones";
import {
  armarValorDeCookie,
  debeRenovar,
  estaEnPausa,
  formatoDeTokenValido,
  generarToken,
  HASH_FALSO,
  hashDeToken,
  hashearClave,
  leerValorDeCookie,
  necesitaRehash,
  normalizarSlug,
  normalizarUsuario,
  problemaDeClave,
  problemaDeUsuario,
  registrarFallo,
  slugValido,
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

const CAMPOS_SESION = { id: true, negocioId: true, usuario: true, nombre: true, rol: true, activo: true } as const;

function aUsuarioSesion(u: { id: string; negocioId: string | null; usuario: string; nombre: string; rol: Rol }, negocioId: string): UsuarioSesion {
  return { id: u.id, negocioId: u.negocioId ?? negocioId, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
}

// ─── Contexto de negocio ──────────────────────────────────────────────────────
// `usuarios` y `sesiones` estan bajo RLS (VTA-8): sin `app.negocio_id` no se ve ni se
// escribe nada. El login y la sesion tienen que declarar el negocio ANTES de leer. Este
// nucleo recibe un cliente cualquiera (el proxy tiene el suyo, los tests tambien), asi que
// abre el contexto aca en vez de usar `conNegocio` (que usa el singleton de la app).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Corre `fn` dentro de una transaccion con `app.negocio_id` fijado (`set_config(..., true)`:
 * vive solo hasta el fin de la transaccion). Si `db` ya es una transaccion, fija el negocio
 * en ella y sigue en la misma. Cada llamada es una transaccion corta: NO envolver en una
 * sola la verificacion de la clave (scrypt) ni mas de lo necesario.
 */
export async function conNegocioEn<T>(db: Db, negocioId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (typeof negocioId !== "string" || !UUID.test(negocioId)) {
    throw new Error("conNegocioEn: negocioId invalido (se espera un UUID).");
  }
  const correr = async (tx: Tx): Promise<T> => {
    await tx.$queryRaw`SELECT set_config('app.negocio_id', ${negocioId}, true)`;
    return fn(tx);
  };
  // El cliente de una transaccion tambien tiene `$transaction` (anidada, sin concurrencia): lo que
  // distingue al cliente real es `$connect`.
  const cliente = db as PrismaClient;
  return typeof cliente.$connect === "function" ? cliente.$transaction((tx) => correr(tx)) : correr(db as Tx);
}

// ─── Negocio por slug (pantalla de /login) ────────────────────────────────────

export type NegocioDeLogin = { id: string; slug: string; nombre: string };

/**
 * El negocio ACTIVO con ese slug, o `null` (no existe, esta suspendido o el slug no tiene la
 * forma valida). `negocios` es la tabla global, sin RLS: se lee sin contexto. Quien llama no
 * debe distinguir los casos hacia afuera: el login responde igual en todos.
 */
export async function negocioDeLogin(db: Db, slugTipeado: string): Promise<NegocioDeLogin | null> {
  const slug = normalizarSlug(slugTipeado);
  if (!slugValido(slug)) return null;
  const negocio = await db.negocio.findUnique({ where: { slug }, select: { id: true, slug: true, nombre: true, activo: true } });
  return negocio && negocio.activo ? { id: negocio.id, slug: negocio.slug, nombre: negocio.nombre } : null;
}

/**
 * Hay al menos un negocio cargado (activo o no). Sin ninguno, nadie puede entrar y en
 * produccion el sitio responde 503 con instrucciones. Reemplaza al viejo `hayUsuarios`:
 * `usuarios` esta bajo RLS y sin negocio no se puede contar; `negocios` es global.
 */
export async function hayNegocios(db: Db): Promise<boolean> {
  return (await db.negocio.findFirst({ select: { id: true } })) !== null;
}

// ─── Login ────────────────────────────────────────────────────────────────────

export type ResultadoCredenciales = { ok: true; usuario: UsuarioSesion } | { ok: false };

/**
 * Verifica usuario y clave DENTRO de un negocio (el usuario `laura` del negocio A y el de B
 * son filas distintas, con su propio conteo de fallos y su propia pausa). Devuelve
 * `{ ok: false }` sin decir por que (usuario inexistente, inactivo, en pausa o clave
 * incorrecta) y en todos los casos hace un calculo de scrypt, para que el tiempo de
 * respuesta tampoco lo diga.
 *
 * Contra los intentos en paralelo: antes de verificar, el intento se anota como
 * fallo con un UPDATE condicionado al estado leido (compare-and-swap). Si otro
 * intento cambio la fila en el medio, o si con ese fallo el usuario entra en
 * pausa, los que vienen detras ya no se verifican. Asi nadie puede probar cien
 * claves a la vez antes de que se registre el primer fallo, y no se mantiene
 * ninguna fila bloqueada mientras corre scrypt (que tarda ~0,3 s): cada paso con base
 * es su propia transaccion corta (`conNegocioEn`), y scrypt corre entre ellas.
 */
export async function verificarCredenciales(
  db: Db,
  negocioId: string,
  usuarioTipeado: string,
  clave: string,
  ahora: Date = new Date(),
): Promise<ResultadoCredenciales> {
  const usuario = normalizarUsuario(usuarioTipeado);
  const fila = await conNegocioEn(db, negocioId, (tx) => tx.usuario.findFirst({ where: { negocioId, usuario } }));

  if (!fila || !fila.activo || estaEnPausa(fila, ahora)) {
    await verificarClave(clave, HASH_FALSO);
    return { ok: false };
  }

  // Se anota el fallo por adelantado; si la clave resulta correcta se borra.
  const fallo = registrarFallo(fila, ahora);
  const reservado = await conNegocioEn(db, negocioId, (tx) =>
    tx.usuario.updateMany({
      where: {
        id: fila.id,
        negocioId,
        intentosFallidos: fila.intentosFallidos,
        ultimoFalloEn: fila.ultimoFalloEn,
        OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }],
      },
      data: fallo,
    }),
  );
  if (reservado.count === 0) {
    // Otro intento contra el mismo usuario se adelanto: este no se verifica.
    await verificarClave(clave, HASH_FALSO);
    return { ok: false };
  }

  if (!(await verificarClave(clave, fila.hashClave))) return { ok: false };

  const hashNuevo = necesitaRehash(fila.hashClave) ? await hashearClave(clave) : null;
  await conNegocioEn(db, negocioId, (tx) =>
    tx.usuario.update({
      where: { id: fila.id },
      data: {
        intentosFallidos: 0,
        ultimoFalloEn: null,
        bloqueadoHasta: null,
        // Si cambiaron los parametros de scrypt, la clave se rehashea ahora que se conoce.
        ...(hashNuevo ? { hashClave: hashNuevo } : {}),
      },
    }),
  );
  return { ok: true, usuario: aUsuarioSesion(fila, negocioId) };
}

/**
 * Sesion recien abierta. `valorCookie` es lo que va en la cookie (`<negocioId>.<token>`);
 * el `token` solo se guarda hasheado en la base.
 */
export type SesionNueva = { token: string; negocioId: string; valorCookie: string; expiraEn: Date };

/**
 * TRANSITORIO, ya no es "el unico negocio": devuelve el negocio de la SESION del pedido
 * (`getNegocioId`). Queda con este nombre porque lo importan las acciones y consultas de
 * F3.x (`negocioUnico(prisma)`); hay que renombrar esos llamadores a `getNegocioId()` y
 * borrar este alias.
 *
 * @deprecated Usar `getNegocioId()` de `@/lib/negocio`.
 */
export async function negocioUnico(_db?: Db): Promise<string> {
  const { getNegocioId } = await import("@/lib/negocio");
  return getNegocioId();
}

/**
 * TRANSITORIO: lo importa `negocioDeLaSesion` (`src/lib/queries/dashboard.ts`, F3.5), que lo
 * llama con el usuario de la SESION del pedido. Devuelve el negocio de esa sesion (no mira
 * `usuarios`: bajo RLS sin contexto no se ve nada). `negocioDeLaSesion` debe pasar a
 * `usuario.negocioId`; despues se borra este alias.
 *
 * @deprecated Usar `usuario.negocioId` o `getNegocioId()`.
 */
export async function negocioDeUsuario(_db?: Db, _usuarioId?: string): Promise<string> {
  return negocioUnico();
}

/** Abre una sesion: token nuevo (nunca se reutiliza uno que traiga el navegador). Limpia las vencidas del usuario. */
export async function crearSesion(db: Db, negocioId: string, usuarioId: string, ahora: Date = new Date()): Promise<SesionNueva> {
  const token = generarToken();
  const expiraEn = vencimientoDesde(ahora);
  await conNegocioEn(db, negocioId, async (tx) => {
    await tx.sesion.deleteMany({ where: { usuarioId, expiraEn: { lte: ahora } } });
    await tx.sesion.create({
      data: { negocioId, tokenHash: hashDeToken(token), usuarioId, creadaEn: ahora, renovadaEn: ahora, expiraEn },
    });
  });
  return { token, negocioId, valorCookie: armarValorDeCookie(negocioId, token), expiraEn };
}

export type ResultadoLogin = ({ ok: true; usuario: UsuarioSesion; negocio: NegocioDeLogin } & SesionNueva) | { ok: false };

/**
 * Verifica y, si corresponde, abre la sesion. Lo usa la accion de /login. El negocio se
 * elige por slug; uno inexistente, inactivo o con forma invalida da lo mismo que una clave
 * incorrecta (mismo resultado y mismo tiempo). La sesion queda atada al negocio del slug.
 */
export async function iniciarSesion(
  db: Db,
  slug: string,
  usuario: string,
  clave: string,
  ahora: Date = new Date(),
): Promise<ResultadoLogin> {
  const negocio = await negocioDeLogin(db, slug);
  if (!negocio) {
    await verificarClave(clave, HASH_FALSO);
    return { ok: false };
  }
  const verificado = await verificarCredenciales(db, negocio.id, usuario, clave, ahora);
  if (!verificado.ok) return { ok: false };
  const sesion = await crearSesion(db, negocio.id, verificado.usuario.id, ahora);
  return { ok: true, usuario: verificado.usuario, negocio, ...sesion };
}

// ─── Sesion de cada pedido ────────────────────────────────────────────────────

export type SesionResuelta = {
  usuario: UsuarioSesion;
  /** Nuevo vencimiento si la sesion se extendio en este pedido (hay que reenviar la cookie). */
  renovadaHasta: Date | null;
};

/**
 * Usuario de la cookie, consultando la base cada vez: la sesion tiene que existir (en el
 * negocio de la cookie, que es solo una pista: ver `leerValorDeCookie`), no estar vencida,
 * el negocio tiene que estar activo y su usuario tiene que ser de ese negocio y estar
 * activo. Una baja corta la sesion en el pedido siguiente. Las sesiones vencidas o de
 * usuarios dados de baja se borran al encontrarlas.
 *
 * Con `renovar`, si paso mas de un dia desde la ultima extension, el vencimiento
 * se corre a 30 dias desde ahora (renovacion deslizante, una escritura por dia).
 */
export async function resolverSesion(
  db: Db,
  valorCookie: string | null | undefined,
  ahora: Date = new Date(),
  { renovar = false }: { renovar?: boolean } = {},
): Promise<SesionResuelta | null> {
  const cookie = leerValorDeCookie(valorCookie);
  if (!cookie) return null;
  const { negocioId, token } = cookie;

  return conNegocioEn(db, negocioId, async (tx) => {
    const sesion = await tx.sesion.findUnique({
      where: { tokenHash: hashDeToken(token) },
      select: {
        id: true,
        negocioId: true,
        expiraEn: true,
        renovadaEn: true,
        negocio: { select: { activo: true } },
        usuario: { select: CAMPOS_SESION },
      },
    });
    // Con RLS esto ya es imposible; se comprueba igual por si el rol de la conexion se salta las politicas.
    if (!sesion || sesion.negocioId !== negocioId || sesion.usuario.negocioId !== negocioId) return null;

    if (sesion.expiraEn.getTime() <= ahora.getTime() || !sesion.usuario.activo) {
      await tx.sesion.deleteMany({ where: { id: sesion.id } });
      return null;
    }
    // Negocio suspendido: nadie entra. La sesion no se borra (al reactivarlo, sigue valiendo).
    if (!sesion.negocio.activo) return null;

    let renovadaHasta: Date | null = null;
    if (renovar && debeRenovar(sesion.renovadaEn, ahora)) {
      const expiraEn = vencimientoDesde(ahora);
      // Condicionado a `renovadaEn`: si llegan varios pedidos juntos, escribe uno solo.
      const { count } = await tx.sesion.updateMany({
        where: { id: sesion.id, renovadaEn: sesion.renovadaEn },
        data: { renovadaEn: ahora, expiraEn },
      });
      if (count > 0) renovadaHasta = expiraEn;
    }

    return { usuario: aUsuarioSesion(sesion.usuario, negocioId), renovadaHasta };
  });
}

/** Cierra la sesion de esta cookie (borra la fila). No falla si ya no existia. */
export async function cerrarSesion(db: Db, valorCookie: string | null | undefined): Promise<void> {
  const cookie = leerValorDeCookie(valorCookie);
  if (!cookie) return;
  await conNegocioEn(db, cookie.negocioId, (tx) =>
    tx.sesion.deleteMany({ where: { tokenHash: hashDeToken(cookie.token), negocioId: cookie.negocioId } }),
  );
}

/**
 * Cierra todas las sesiones de un usuario: para la baja o el cambio de clave (4.4). `db`
 * tiene que llevar el contexto del negocio del usuario (una transaccion de `conNegocio`).
 */
export async function cerrarSesionesDeUsuario(db: Db, usuarioId: string): Promise<number> {
  const { count } = await db.sesion.deleteMany({ where: { usuarioId } });
  return count;
}

// ─── Alta ─────────────────────────────────────────────────────────────────────

export type DatosUsuarioNuevo = { usuario: string; nombre: string; rol: Rol; clave: string };

/**
 * Negocio para un alta: el indicado, o el del contexto de la transaccion (`conNegocio`), o,
 * sin contexto (CLI y siembra con el rol migrador), el unico que haya. Con mas de uno y sin
 * indicar cual, falla: nunca se adivina.
 */
async function negocioParaAlta(tx: Tx, indicado: string | undefined): Promise<string> {
  if (indicado) return indicado;
  const filas = await tx.$queryRaw<{ v: string | null }[]>`SELECT nullif(current_setting('app.negocio_id', true), '') AS v`;
  if (filas[0]?.v) return filas[0].v;
  const negocios = await tx.negocio.findMany({ select: { id: true }, take: 2 });
  if (negocios.length === 1) return negocios[0]!.id;
  throw new ErrorDeNegocio(negocios.length === 0 ? "No hay ningún negocio." : "Hay más de un negocio: falta indicar cuál.");
}

/**
 * Alta de un usuario EN un negocio, con validacion. Lanza `ErrorDeNegocio` con un mensaje
 * para mostrar. Escribe `negocioId` (bajo RLS, sin el la politica WITH CHECK rechaza el
 * alta). Las acciones de la app lo pasan siempre (el de la sesion); si falta, ver
 * `negocioParaAlta`. El nombre de usuario es unico por negocio: puede repetirse en otro.
 */
export async function crearUsuarioEnTx(tx: Tx, datos: DatosUsuarioNuevo & { negocioId?: string }): Promise<UsuarioSesion> {
  const negocioId = await negocioParaAlta(tx, datos.negocioId);
  const usuario = normalizarUsuario(datos.usuario);
  const nombre = datos.nombre.trim();
  const problema = problemaDeUsuario(usuario) ?? problemaDeClave(datos.clave);
  if (problema) throw new ErrorDeNegocio(problema);
  if (nombre.length === 0 || nombre.length > 80) throw new ErrorDeNegocio("El nombre debe tener entre 1 y 80 caracteres.");

  if (await tx.usuario.findFirst({ where: { negocioId, usuario }, select: { id: true } })) {
    throw new ErrorDeNegocio(`Ya existe un usuario "${usuario}".`);
  }
  const creado = await tx.usuario.create({
    data: { negocioId, usuario, nombre, rol: datos.rol, hashClave: await hashearClave(datos.clave) },
  });
  return aUsuarioSesion(creado, negocioId);
}

/**
 * Alta del primer dueno de un negocio (`npm run usuarios:crear-dueno`). Se niega si ya hay
 * algun dueno en ESE negocio, aunque este dado de baja: por esta via no se crea un segundo.
 * Un lock de transaccion (por negocio) evita que dos corridas simultaneas creen dos.
 */
export async function crearDuenoEnTx(
  tx: Tx,
  datos: Omit<DatosUsuarioNuevo, "rol"> & { negocioId?: string },
): Promise<UsuarioSesion> {
  const negocioId = await negocioParaAlta(tx, datos.negocioId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('crear-dueno:' || ${negocioId}, 0))`;
  const existente = await tx.usuario.findFirst({ where: { negocioId, rol: "DUENO" }, select: { usuario: true, activo: true } });
  if (existente) {
    throw new ErrorDeNegocio(
      `Ya existe un dueño (usuario "${existente.usuario}"${existente.activo ? "" : ", dado de baja"}). ` +
        "Este comando solo crea el primero; los demás usuarios se administran desde la app.",
    );
  }
  return crearUsuarioEnTx(tx, { negocioId, usuario: datos.usuario, nombre: datos.nombre, clave: datos.clave, rol: "DUENO" });
}
