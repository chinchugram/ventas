/**
 * Prueba el aislamiento entre negocios por Row Level Security (multi-tenant F2.1),
 * solo contra Postgres LOCAL.
 *
 *   npm run test:rls
 *
 * Variables (ver .env.example):
 *   DATABASE_URL              rol `ventas_app` (sin SUPERUSER ni BYPASSRLS): el que usa la app.
 *   DATABASE_URL_MIGRACIONES  rol `ventas_migrador` (BYPASSRLS, dueno de las tablas): siembra y
 *                             limpia los datos de prueba y lee el estado real de la base.
 * La base debe tener TODAS las migraciones aplicadas con ventas_migrador y los roles creados
 * (scripts/crear-roles-db.sql). Ejemplo con un Postgres en un socket propio:
 *
 *   DATABASE_URL="postgresql://ventas_app:ventas_app@localhost:5477/ventas?host=/tmp/pgsock7" \
 *   DATABASE_URL_MIGRACIONES="postgresql://ventas_migrador:ventas_migrador@localhost:5477/ventas?host=/tmp/pgsock7" \
 *   npm run test:rls
 *
 * Siembra dos negocios (A y B) con una fila en CADA tabla con `negocioId` y, parado en el A
 * (y despues en el B), comprueba POR CADA TABLA:
 *   - SELECT no ve filas del otro negocio y ve todas las propias;
 *   - UPDATE y DELETE sobre filas del otro negocio no tocan nada;
 *   - INSERT con `negocioId` del otro negocio y UPDATE que muevan una fila al otro negocio son
 *     rechazados por WITH CHECK (con los triggers de usuario apagados, para que el rechazo sea
 *     solo de la politica; y tambien con los triggers prendidos);
 *   - un INSERT con el `negocioId` del contexto no lo rechaza la politica;
 *   - sin contexto no se ve ni se escribe nada.
 * Ademas: toda tabla con `negocioId` tiene RLS ENABLE + FORCE y su politica; `negocios` es la
 * unica global (la lee cualquiera; solo el SUPERADMIN la escribe, y nunca se borra); el SUPERADMIN
 * (`app.superadmin = 'on'`, filas con `negocioId` NULL en `usuarios` y `sesiones`) no ve ni escribe
 * datos de ningun negocio y ningun contexto de negocio ve al SUPERADMIN; el rol de la app no se
 * salta RLS; el contexto no se filtra entre conexiones ni entre transacciones. Cada comprobacion de escritura se deshace
 * (rollback) y al final se borran los dos negocios sembrados.
 */
import "dotenv/config";
import { Client, Pool } from "pg";
import { conNegocio, conSuperadmin, verificarRolDeLaApp } from "../src/lib/negocio";
import { prisma } from "../src/lib/prisma";

let fallos = 0;
let pruebas = 0;

// Prisma loguea cada error de las consultas que ESTE test provoca a proposito; se silencian.
for (const flujo of [process.stdout, process.stderr]) {
  const escribir = flujo.write.bind(flujo) as (...a: unknown[]) => boolean;
  flujo.write = ((chunk: string | Uint8Array, ...resto: unknown[]) =>
    String(chunk).includes("prisma:error") ? true : escribir(chunk, ...resto)) as typeof flujo.write;
}

function comprobar(ok: boolean, etiqueta: string, detalle = "") {
  pruebas += 1;
  if (!ok) fallos += 1;
  console.log(`${ok ? "OK   " : "FALLA"} ${etiqueta}${detalle && !ok ? ` -> ${detalle}` : ""}`);
}

// ─── Solo local ──────────────────────────────────────────────────────────────

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

const URL_APP = process.env.DATABASE_URL ?? "";
const URL_MIG = process.env.DATABASE_URL_MIGRACIONES ?? "";
if (!URL_APP || !URL_MIG) {
  console.error("Faltan DATABASE_URL (ventas_app) y DATABASE_URL_MIGRACIONES (ventas_migrador). Ver el encabezado de este archivo.");
  process.exit(1);
}
if (!esLocal(URL_APP) || !esLocal(URL_MIG)) {
  console.error("Este test solo corre contra Postgres local (localhost o socket unix). Nunca contra Neon.");
  process.exit(1);
}

// ─── Datos de prueba ─────────────────────────────────────────────────────────

/** Siembra una fila en cada tabla con `negocioId` para el negocio `neg` (corre con ventas_migrador). */
const SQL_CARGAR = `
CREATE OR REPLACE FUNCTION pg_temp.cargar(neg UUID, tag TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  u UUID := gen_random_uuid(); l UUID := gen_random_uuid(); c UUID := gen_random_uuid();
  m UUID := gen_random_uuid(); mq UUID := gen_random_uuid(); a UUID := gen_random_uuid();
  r UUID := gen_random_uuid(); v UUID := gen_random_uuid(); v2 UUID := gen_random_uuid();
  vi UUID := gen_random_uuid(); co UUID := gen_random_uuid(); p UUID := gen_random_uuid();
  tr UUID := gen_random_uuid(); f UUID := gen_random_uuid(); f2 UUID := gen_random_uuid();
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO usuarios (id, "negocioId", usuario, nombre, rol, "hashClave", "actualizadoEn")
    VALUES (u, neg, 'dueno', 'Dueño ' || tag, 'DUENO',
      'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now());
  INSERT INTO sesiones (id, "negocioId", "tokenHash", "usuarioId", "expiraEn")
    VALUES (gen_random_uuid(), neg, md5(random()::text) || md5(random()::text), u, now() + interval '1 day');
  INSERT INTO listas_precios (id, "negocioId", nombre, "descuentoPct", "actualizadoEn", "usuarioId")
    VALUES (l, neg, 'Mayorista', 10, now(), u);
  INSERT INTO clientes (id, "negocioId", nombre, cuit, "listaPrecioId", "actualizadoEn")
    VALUES (c, neg, 'Cliente ' || tag, '30712345671', l, now());
  INSERT INTO materiales (id, "negocioId", nombre, unidad, "stockActual", "stockMinimo", "costoUnitario", "actualizadoEn")
    VALUES (m, neg, 'Vinilo', 'M2', 10, 1, 100, now());
  INSERT INTO maquinas (id, "negocioId", nombre, "costoHora", "actualizadoEn") VALUES (mq, neg, 'Plotter', 2500, now());
  INSERT INTO articulos (id, "negocioId", nombre, "precioVenta", "actualizadoEn") VALUES (a, neg, 'Sticker', 1210, now());
  INSERT INTO lista_precio_items (id, "negocioId", "listaPrecioId", "articuloId", precio, "actualizadoEn")
    VALUES (gen_random_uuid(), neg, l, a, 1000, now());
  INSERT INTO recetas (id, "negocioId", "articuloId", "actualizadoEn") VALUES (r, neg, a, now());
  INSERT INTO receta_componentes (id, "negocioId", "recetaId", tipo, "materialId", "maquinaId", cantidad)
    VALUES (gen_random_uuid(), neg, r, 'MATERIAL', m, NULL, 0.5);
  INSERT INTO ventas (id, "negocioId", numero, anio, "clienteId", fecha, estado, "totalNeto", "totalIVA", "totalBruto", "costoTotal", "usuarioId", "actualizadoEn")
    VALUES (v, neg, 1, 2026, c, '2026-05-01', 'PENDIENTE', 1000, 210, 1210, 600, u, now()),
           (v2, neg, 2, 2026, c, '2026-05-02', 'PENDIENTE', 2000, 420, 2420, 1200, u, now());
  INSERT INTO venta_items (id, "negocioId", "ventaId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIVA", "subtotalBruto")
    VALUES (vi, neg, v, a, 'Sticker', 1, 1210, 21, 1000, 210, 1210);
  INSERT INTO pagos (id, "negocioId", "ventaId", "clienteId", fecha, monto, "usuarioId", "actualizadoEn")
    VALUES (gen_random_uuid(), neg, v, c, '2026-05-01', 500, u, now());
  INSERT INTO compras (id, "negocioId", fecha, proveedor, total, "actualizadoEn") VALUES (co, neg, '2026-04-20', 'Proveedor', 1000, now());
  INSERT INTO compra_items (id, "negocioId", "compraId", "materialId", cantidad, "costoUnitario", subtotal)
    VALUES (gen_random_uuid(), neg, co, m, 10, 100, 1000);
  INSERT INTO movimientos_stock (id, "negocioId", "materialId", tipo, cantidad, "stockResultante", "compraId")
    VALUES (gen_random_uuid(), neg, m, 'COMPRA', 10, 10, co);
  INSERT INTO contactos_cobranza (id, "negocioId", "clienteId", fecha, nota) VALUES (gen_random_uuid(), neg, c, '2026-05-10', 'Se llamó');
  INSERT INTO presupuestos (id, "negocioId", numero, anio, "clienteId", fecha, "actualizadoEn") VALUES (p, neg, 1, 2026, c, '2026-05-05', now());
  INSERT INTO presupuesto_items (id, "negocioId", "presupuestoId", "articuloId", descripcion, cantidad, "precioUnitario", "ivaPct")
    VALUES (gen_random_uuid(), neg, p, a, 'Sticker', 2, 1210, 21);
  INSERT INTO configuracion ("negocioId", clave, valor) VALUES (neg, 'ivaPorDefecto', '21');
  INSERT INTO trabajos_produccion (id, "negocioId", "ventaItemId", fecha, "usuarioId", "actualizadoEn") VALUES (tr, neg, vi, '2026-05-02', u, now());
  INSERT INTO trabajo_tiempos (id, "negocioId", "trabajoId", "maquinaId", minutos) VALUES (gen_random_uuid(), neg, tr, mq, 30);
  INSERT INTO trabajo_consumos (id, "negocioId", "trabajoId", "materialId", cantidad) VALUES (gen_random_uuid(), neg, tr, m, 1);
  -- Factura C (sin alicuotas) sobre la venta 1 y factura A (con alicuota) sobre la venta 2.
  INSERT INTO comprobantes (id, "negocioId", ambiente, tipo, "codigoArca", "puntoVenta", numero, fecha, estado,
    "emisorRazonSocial", "emisorCuit", "emisorCondicionIva", "emisorDomicilio", "emisorInicioActividades",
    "receptorNombre", "receptorDocTipo", "receptorDocNro", "receptorCondicionIva",
    "importeNeto", "importeIva", "importeTotal", "ventaId", "actualizadoEn")
    VALUES (f, neg, 'SIMULADO', 'FACTURA_C', 11, 1, 1, '2026-05-01', 'PENDIENTE',
      'HL Laser', '20123456786', 'MONOTRIBUTO', 'Calle 1', '2020-01-01',
      'Cliente', 99, '0', 'CONSUMIDOR_FINAL', 1210, 0, 1210, v, now()),
     (f2, neg, 'SIMULADO', 'FACTURA_A', 1, 1, 1, '2026-05-02', 'PENDIENTE',
      'HL Laser', '20123456786', 'RESPONSABLE_INSCRIPTO', 'Calle 1', '2020-01-01',
      'Cliente', 80, '30123456786', 'RESPONSABLE_INSCRIPTO', 2000, 420, 2420, v2, now());
  INSERT INTO comprobante_items (id, "negocioId", "comprobanteId", orden, descripcion, cantidad, "precioUnitario", "ivaPct", "subtotalNeto", "subtotalIva", "subtotalBruto")
    VALUES (gen_random_uuid(), neg, f, 1, 'Sticker', 1, 1210, 0, 1210, 0, 1210),
           (gen_random_uuid(), neg, f2, 1, 'Sticker x2', 2, 1210, 21, 2000, 420, 2420);
  INSERT INTO comprobante_iva (id, "negocioId", "comprobanteId", "alicuotaPct", "codigoArca", "baseImponible", importe)
    VALUES (gen_random_uuid(), neg, f2, 21, 5, 2000, 420);
  SET CONSTRAINTS ALL IMMEDIATE;  -- verifica ahora los importes de los comprobantes
END;
$$;`;

/** Orden de borrado (hijos antes que padres) para limpiar los negocios sembrados. */
const ORDEN_BORRADO = [
  "comprobante_iva", "comprobante_items", "comprobantes", "trabajo_consumos", "trabajo_tiempos",
  "trabajos_produccion", "movimientos_stock", "pagos", "presupuesto_items", "presupuestos",
  "venta_items", "ventas", "compra_items", "compras", "contactos_cobranza", "receta_componentes",
  "recetas", "lista_precio_items", "clientes", "listas_precios", "articulos", "materiales",
  "maquinas", "sesiones", "configuracion", "usuarios",
];

// ─── Utilidades de consulta ──────────────────────────────────────────────────

class Deshacer extends Error {}

/** Texto completo de un error (Prisma esconde el mensaje de Postgres en `meta`/`cause`). */
function mensajeDe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const partes = [e.message];
  const extra = e as unknown as { meta?: unknown; cause?: unknown };
  if (extra.meta) partes.push(JSON.stringify(extra.meta));
  if (extra.cause) partes.push(mensajeDe(extra.cause));
  return partes.join(" | ");
}

type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

/** Corre `fn` dentro de `conNegocio(neg)` y SIEMPRE deshace al final (nada queda escrito). */
async function probar<T>(neg: string, fn: (tx: Parameters<Parameters<typeof conNegocio>[1]>[0]) => Promise<T>): Promise<Resultado<T>> {
  let valor: T | undefined;
  try {
    await conNegocio(neg, async (tx) => {
      valor = await fn(tx);
      throw new Deshacer();
    });
  } catch (e) {
    if (!(e instanceof Deshacer)) return { ok: false, error: mensajeDe(e) };
  }
  return { ok: true, valor: valor as T };
}

const esRls = (r: Resultado<unknown>) => !r.ok && /row-level security/i.test(r.error);

const q = (tabla: string) => `"${tabla}"`;

const INSERT_PLANTILLA = (tabla: string) =>
  `INSERT INTO ${q(tabla)} SELECT (jsonb_populate_record(NULL::${q(tabla)}, $1::jsonb || jsonb_build_object('id', gen_random_uuid()::text, 'negocioId', $2::text))).*`;

// ─── Principal ───────────────────────────────────────────────────────────────

async function main() {
  const mig = new Client({ connectionString: URL_MIG });
  await mig.connect();
  const fila = async <T extends object>(sql: string, params: unknown[] = []) => (await mig.query<T>(sql, params)).rows;

  const limpiar = async () => {
    const ids = (await fila<{ id: string }>(`SELECT id FROM negocios WHERE slug IN ('test-rls-a', 'test-rls-b')`)).map((x) => x.id);
    await mig.query(`DELETE FROM sesiones WHERE "usuarioId" IN (SELECT id FROM usuarios WHERE "negocioId" IS NULL AND usuario LIKE 'test-rls-super%')`);
    await mig.query(`DELETE FROM usuarios WHERE "negocioId" IS NULL AND usuario LIKE 'test-rls-super%'`);
    if (ids.length === 0) return;
    await mig.query("BEGIN");
    try {
      // Los triggers fiscales impiden borrar comprobantes: se apagan solo para esta limpieza (dentro de la transaccion).
      for (const t of ["comprobantes", "comprobante_items", "comprobante_iva"]) await mig.query(`ALTER TABLE ${q(t)} DISABLE TRIGGER USER`);
      for (const t of ORDEN_BORRADO) await mig.query(`DELETE FROM ${q(t)} WHERE "negocioId" = ANY($1::uuid[])`, [ids]);
      await mig.query(`DELETE FROM negocios WHERE id = ANY($1::uuid[])`, [ids]);
      for (const t of ["comprobantes", "comprobante_items", "comprobante_iva"]) await mig.query(`ALTER TABLE ${q(t)} ENABLE TRIGGER USER`);
      await mig.query("COMMIT");
    } catch (e) {
      await mig.query("ROLLBACK");
      throw e;
    }
  };

  // Tablas con `negocioId` (de la base real, no de una lista a mano: una tabla nueva sin RLS rompe el test).
  const tablas = (await fila<{ t: string }>(
    `SELECT c.table_name AS t FROM information_schema.columns c
       JOIN information_schema.tables tb USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.column_name = 'negocioId'
      ORDER BY 1`,
  )).map((x) => x.t);
  const todas = (await fila<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  )).map((x) => x.t);

  console.log(`\n── Estructura (${tablas.length} tablas con negocioId) ──`);
  const sinNegocioId = todas.filter((t) => !tablas.includes(t) && t !== "negocios" && t !== "_prisma_migrations");
  comprobar(sinNegocioId.length === 0, "toda tabla de datos tiene negocioId (salvo negocios)", sinNegocioId.join(", "));
  const rls = await fila<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`,
  );
  const politicas = await fila<{ tablename: string; policyname: string; cmd: string; qual: string; with_check: string }>(
    `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public'`,
  );
  for (const t of tablas) {
    const r = rls.find((x) => x.relname === t);
    comprobar(!!r?.relrowsecurity && !!r?.relforcerowsecurity, `${t}: ENABLE + FORCE ROW LEVEL SECURITY`);
    const ps = politicas.filter((p) => p.tablename === t);
    const p = ps[0];
    comprobar(
      ps.length === 1 && p?.cmd === "ALL" && !!p.qual?.includes("app.negocio_id") && !!p.with_check?.includes("app.negocio_id") && p.qual === p.with_check,
      `${t}: una politica FOR ALL con USING y WITH CHECK iguales sobre app.negocio_id`,
      JSON.stringify(ps),
    );
  }
  // usuarios y sesiones: ademas de su negocio, el SUPERADMIN (marca de la transaccion) ve las filas sin negocio.
  for (const t of ["usuarios", "sesiones"]) {
    const p = politicas.find((x) => x.tablename === t);
    comprobar(
      !!p && /app\.superadmin/.test(p.qual) && /"negocioId" IS NULL/.test(p.qual) && p.qual === p.with_check,
      `${t}: la politica admite las filas sin negocio solo con app.superadmin = 'on'`,
      JSON.stringify(p),
    );
  }
  const neg = rls.find((x) => x.relname === "negocios");
  comprobar(!!neg && neg.relrowsecurity && neg.relforcerowsecurity, "negocios: ENABLE + FORCE ROW LEVEL SECURITY");
  const polNeg = politicas.filter((p) => p.tablename === "negocios");
  comprobar(
    polNeg.length === 3 &&
      polNeg.some((p) => p.cmd === "SELECT" && p.qual === "true") &&
      polNeg.some((p) => p.cmd === "INSERT" && /app\.superadmin/.test(p.with_check)) &&
      polNeg.some((p) => p.cmd === "UPDATE" && /app\.superadmin/.test(p.qual) && /app\.superadmin/.test(p.with_check)) &&
      !polNeg.some((p) => p.cmd === "DELETE" || p.cmd === "ALL"),
    "negocios: lectura libre, alta y cambio solo con app.superadmin = 'on', sin politica de borrado",
    JSON.stringify(polNeg),
  );
  const restriccion = await fila<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'usuarios_superadmin_sin_negocio'`,
  );
  comprobar(restriccion.length === 1, "usuarios: CHECK rol SUPERADMIN <=> sin negocio", restriccion[0]?.def ?? "no existe");

  const rol = (await prisma.$queryRaw<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)[0];
  comprobar(!!rol && !rol.rolsuper && !rol.rolbypassrls, `el rol de la app (${rol?.rolname}) no es superusuario ni tiene BYPASSRLS`);
  const dueno = (await fila<{ dueno: string; bypass: boolean }>(
    `SELECT tableowner AS dueno, (SELECT rolbypassrls FROM pg_roles WHERE rolname = tableowner) AS bypass FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ventas'`,
  ))[0];
  comprobar(!!dueno && dueno.dueno !== rol?.rolname, `la app no es duena de las tablas (dueno: ${dueno?.dueno})`);
  await verificarRolDeLaApp(prisma);
  comprobar(true, "verificarRolDeLaApp acepta el rol de la app");

  // ─── Siembra ───
  console.log("\n── Siembra de dos negocios ──");
  await limpiar();
  const ids: Record<"A" | "B", string> = { A: "", B: "" };
  for (const [k, slug] of [["A", "test-rls-a"], ["B", "test-rls-b"]] as const) {
    ids[k] = (await fila<{ id: string }>(`INSERT INTO negocios (id, nombre, slug, "actualizadoEn") VALUES (gen_random_uuid(), $1, $2, now()) RETURNING id`, [`Negocio ${k} (test RLS)`, slug]))[0]!.id;
  }
  await mig.query(SQL_CARGAR);
  for (const k of ["A", "B"] as const) {
    await mig.query("BEGIN");
    try {
      await mig.query(`SELECT pg_temp.cargar($1::uuid, $2)`, [ids[k], k]);
      await mig.query("COMMIT");
    } catch (e) {
      await mig.query("ROLLBACK");
      throw e;
    }
  }

  try {
    const cuentas = new Map<string, Record<"A" | "B", number>>();
    const plantillas = new Map<string, Record<"A" | "B", string>>();
    for (const t of tablas) {
      const c = { A: 0, B: 0 };
      const pl = { A: "", B: "" };
      for (const k of ["A", "B"] as const) {
        c[k] = Number((await fila<{ n: string }>(`SELECT count(*) AS n FROM ${q(t)} WHERE "negocioId" = $1`, [ids[k]]))[0]!.n);
        pl[k] = (await fila<{ j: string }>(`SELECT to_jsonb(r)::text AS j FROM ${q(t)} r WHERE "negocioId" = $1 LIMIT 1`, [ids[k]]))[0]?.j ?? "";
      }
      cuentas.set(t, c);
      plantillas.set(t, pl);
    }
    const sinFilas = tablas.filter((t) => cuentas.get(t)!.A === 0 || cuentas.get(t)!.B === 0);
    comprobar(sinFilas.length === 0, "cada negocio tiene al menos una fila en cada tabla con negocioId", sinFilas.join(", "));

    // ─── Por tabla, desde cada negocio ───
    for (const [yo, otro] of [["A", "B"], ["B", "A"]] as const) {
      console.log(`\n── Parado en el negocio ${yo} (el otro es ${otro}) ──`);
      for (const t of tablas) {
        const mias = cuentas.get(t)![yo];
        const plMia = plantillas.get(t)![yo];

        const todo = await probar(ids[yo], (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)}`));
        comprobar(todo.ok && todo.valor[0]?.n === mias, `${t}: SELECT ve solo sus ${mias} fila(s)`, JSON.stringify(todo));
        const delOtro = await probar(ids[yo], (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)} WHERE "negocioId" = $1::uuid`, ids[otro]));
        comprobar(delOtro.ok && delOtro.valor[0]?.n === 0, `${t}: SELECT no ve filas del otro negocio`, JSON.stringify(delOtro));

        const upd = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(`UPDATE ${q(t)} SET "negocioId" = "negocioId" WHERE "negocioId" = $1::uuid`, ids[otro]));
        comprobar(upd.ok && upd.valor === 0, `${t}: UPDATE sobre filas del otro negocio no toca ninguna`, JSON.stringify(upd));
        // SELECT ... FOR UPDATE respeta la politica de UPDATE sin disparar los triggers de inmutabilidad (comprobantes).
        const bloqueables = await probar(ids[yo], (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${q(t)} FOR UPDATE) s`));
        comprobar(bloqueables.ok && bloqueables.valor[0]?.n === mias, `${t}: solo puede tomar para modificar sus ${mias} fila(s)`, JSON.stringify(bloqueables));
        const del = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(`DELETE FROM ${q(t)} WHERE "negocioId" = $1::uuid`, ids[otro]));
        comprobar(del.ok && del.valor === 0, `${t}: DELETE sobre filas del otro negocio no borra ninguna`, JSON.stringify(del));

        // Con los triggers de usuario prendidos: igual se rechaza (por la politica o por el trigger de negocio).
        const insConTriggers = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(INSERT_PLANTILLA(t), plMia, ids[otro]));
        comprobar(!insConTriggers.ok, `${t}: INSERT con negocioId del otro negocio es rechazado`, JSON.stringify(insConTriggers));
        const movConTriggers = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(`UPDATE ${q(t)} SET "negocioId" = $1::uuid`, ids[otro]));
        comprobar(!movConTriggers.ok, `${t}: UPDATE que pasa una fila propia al otro negocio es rechazado`, JSON.stringify(movConTriggers));
      }
    }

    // ─── Politica pura: triggers de usuario apagados, para que el rechazo sea solo de RLS ───
    console.log("\n── WITH CHECK de la politica (triggers de usuario apagados) ──");
    for (const t of tablas) await mig.query(`ALTER TABLE ${q(t)} DISABLE TRIGGER USER`);
    try {
      for (const [yo, otro] of [["A", "B"], ["B", "A"]] as const) {
        for (const t of tablas) {
          const plMia = plantillas.get(t)![yo];
          const ins = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(INSERT_PLANTILLA(t), plMia, ids[otro]));
          comprobar(esRls(ins), `[${yo}] ${t}: INSERT con negocioId ajeno -> "violates row-level security policy"`, JSON.stringify(ins));
          const updTodo = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(`UPDATE ${q(t)} SET "negocioId" = "negocioId"`));
          comprobar(updTodo.ok && updTodo.valor === cuentas.get(t)![yo], `[${yo}] ${t}: UPDATE sin WHERE toca solo las propias (${cuentas.get(t)![yo]})`, JSON.stringify(updTodo));
          const delTodo = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(`DELETE FROM ${q(t)} WHERE "negocioId" <> $1::uuid`, ids[yo]));
          comprobar(delTodo.ok && delTodo.valor === 0, `[${yo}] ${t}: DELETE de las filas que no son del contexto no borra ninguna`, JSON.stringify(delTodo));
          const mov = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(`UPDATE ${q(t)} SET "negocioId" = $1::uuid`, ids[otro]));
          comprobar(esRls(mov), `[${yo}] ${t}: UPDATE de negocioId a uno ajeno -> "violates row-level security policy"`, JSON.stringify(mov));
          // Control positivo: con el negocioId del contexto la politica NO rechaza (puede chocar con un unico, que es otra cosa).
          const propio = await probar(ids[yo], (tx) => tx.$executeRawUnsafe(INSERT_PLANTILLA(t), plMia, ids[yo]));
          comprobar(!esRls(propio), `[${yo}] ${t}: INSERT con el negocioId del contexto no lo rechaza la politica`, JSON.stringify(propio));
        }
      }
      for (const t of tablas) {
        let rechazado = "";
        try {
          await prisma.$executeRawUnsafe(INSERT_PLANTILLA(t), plantillas.get(t)!.A, ids.A);
        } catch (e) {
          rechazado = mensajeDe(e);
        }
        comprobar(/row-level security/i.test(rechazado), `[sin contexto] ${t}: INSERT -> "violates row-level security policy"`, rechazado || "no fallo");
      }
    } finally {
      for (const t of tablas) await mig.query(`ALTER TABLE ${q(t)} ENABLE TRIGGER USER`);
    }

    // ─── Sin contexto ───
    console.log("\n── Sin contexto (cliente suelto, sin conNegocio) ──");
    for (const t of tablas) {
      const n = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)}`);
      comprobar(n[0]?.n === 0, `${t}: sin contexto no se ve nada (hay ${cuentas.get(t)!.A + cuentas.get(t)!.B} filas)`, JSON.stringify(n));
      const u = await prisma.$executeRawUnsafe(`UPDATE ${q(t)} SET "negocioId" = "negocioId"`);
      comprobar(u === 0, `${t}: sin contexto UPDATE no toca nada`, String(u));
      const d = await prisma.$executeRawUnsafe(`DELETE FROM ${q(t)}`);
      comprobar(d === 0, `${t}: sin contexto DELETE no borra nada`, String(d));
      let rechazado = "";
      try {
        await prisma.$executeRawUnsafe(INSERT_PLANTILLA(t), plantillas.get(t)!.A, ids.A);
      } catch (e) {
        rechazado = mensajeDe(e);
      }
      comprobar(rechazado !== "", `${t}: sin contexto INSERT es rechazado`, "no fallo");
    }

    // ─── El contexto no se filtra ───
    console.log("\n── El contexto vive solo dentro de la transaccion ──");
    // 1. Misma conexion, transaccion tras transaccion (pool de 1: fuerza reutilizar la conexion).
    const unica = new Pool({ connectionString: URL_APP, max: 1 });
    try {
      const antes = (await unica.query(`SELECT current_setting('app.negocio_id', true) AS v`)).rows[0].v;
      await unica.query("BEGIN");
      await unica.query(`SELECT set_config('app.negocio_id', $1, true)`, [ids.A]);
      const dentro = (await unica.query(`SELECT count(*)::int AS n FROM ventas`)).rows[0].n;
      await unica.query("COMMIT");
      const despues = (await unica.query(`SELECT current_setting('app.negocio_id', true) AS v`)).rows[0].v;
      const sinCtx = (await unica.query(`SELECT count(*)::int AS n FROM ventas`)).rows[0].n;
      comprobar(!antes && dentro > 0 && !despues && sinCtx === 0, "set_config(..., true): al terminar la transaccion la conexion vuelve a no tener contexto", JSON.stringify({ antes, dentro, despues, sinCtx }));
      // Una transaccion que falla (ROLLBACK) tampoco deja contexto.
      await unica.query("BEGIN");
      await unica.query(`SELECT set_config('app.negocio_id', $1, true)`, [ids.B]);
      await unica.query("ROLLBACK");
      const trasRollback = (await unica.query(`SELECT current_setting('app.negocio_id', true) AS v`)).rows[0].v;
      comprobar(!trasRollback, "tras un ROLLBACK la conexion no conserva el contexto", String(trasRollback));
      // SET (sin LOCAL) es el error clasico: ese si se filtraria. Confirmamos que la politica lo notaria, o sea
      // que el helper usa set_config(true) y no SET de sesion.
      await unica.query(`SELECT set_config('app.negocio_id', $1, false)`, [ids.A]);
      const filtrado = (await unica.query(`SELECT count(*)::int AS n FROM ventas`)).rows[0].n;
      await unica.query(`RESET app.negocio_id`);
      comprobar(filtrado > 0, "control: un set_config de SESION (is_local=false) SI se filtraria (por eso el helper usa true)", String(filtrado));
    } finally {
      await unica.end();
    }
    // 2. Muchas conexiones del pool a la vez: despues de conNegocio, ninguna conexion conserva contexto.
    const rondas = 40;
    await Promise.all(
      Array.from({ length: rondas }, (_, i) => conNegocio(ids[i % 2 === 0 ? "A" : "B"], (tx) => tx.$queryRawUnsafe(`SELECT count(*) FROM ventas`))),
    );
    const sueltas = await Promise.all(
      Array.from({ length: rondas }, () => prisma.$queryRawUnsafe<{ n: number; v: string | null }[]>(`SELECT count(*)::int AS n, current_setting('app.negocio_id', true) AS v FROM ventas`)),
    );
    comprobar(sueltas.every((s) => s[0]?.n === 0 && !s[0]?.v), `${rondas} consultas sueltas sobre el pool, tras ${rondas} conNegocio concurrentes, no ven nada ni heredan contexto`);
    // 3. Concurrencia: cada conNegocio ve solo lo suyo aunque corran al mismo tiempo.
    const mezcla = await Promise.all(
      Array.from({ length: rondas }, (_, i) => {
        const k = i % 2 === 0 ? "A" : "B";
        return conNegocio(ids[k], async (tx) => {
          const r = await tx.$queryRawUnsafe<{ n: number; ajenas: number }[]>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE "negocioId" <> $1::uuid)::int AS ajenas FROM ventas`, ids[k]);
          return r[0]!;
        });
      }),
    );
    comprobar(mezcla.every((r) => r.n === 2 && r.ajenas === 0), "conNegocio concurrentes (A y B mezclados) ven siempre solo las ventas propias");

    // ─── El helper ───
    console.log("\n── Helper conNegocio ──");
    for (const malo of ["", "no-es-uuid", "x' OR '1'='1", ids.A + "; DROP TABLE ventas"]) {
      let msg = "";
      try {
        await conNegocio(malo, async () => 1);
      } catch (e) {
        msg = mensajeDe(e);
      }
      comprobar(/negocioId invalido/.test(msg), `rechaza negocioId invalido ${JSON.stringify(malo)}`, msg);
    }
    const devuelve = await conNegocio(ids.A, async (tx) => (await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('app.negocio_id', true) AS v`)[0]!.v);
    comprobar(devuelve === ids.A, "dentro de fn, app.negocio_id es el negocio pedido y fn devuelve su valor");
    const antes = await conNegocio(ids.A, async (tx) => Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM clientes`))[0]!.n));
    let revertido = false;
    try {
      await conNegocio(ids.A, async (tx) => {
        await tx.$executeRawUnsafe(INSERT_PLANTILLA("articulos"), plantillas.get("articulos")!.A, ids.A);
        throw new Error("falla a proposito");
      });
    } catch {
      revertido = true;
    }
    const nArt = await conNegocio(ids.A, async (tx) => Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM articulos`))[0]!.n));
    comprobar(revertido && nArt === cuentas.get("articulos")!.A && antes === cuentas.get("clientes")!.A, "si fn lanza, la transaccion se deshace");
    const creado = await conNegocio(ids.A, async (tx) => {
      await tx.$executeRawUnsafe(INSERT_PLANTILLA("articulos"), plantillas.get("articulos")!.A, ids.A);
      return true;
    });
    const nArt2 = await conNegocio(ids.A, async (tx) => Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM articulos`))[0]!.n));
    comprobar(creado && nArt2 === cuentas.get("articulos")!.A + 1, "una escritura con el negocio propio se confirma");
    const vistoPorB = await conNegocio(ids.B, async (tx) => Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM articulos`))[0]!.n));
    comprobar(vistoPorB === cuentas.get("articulos")!.B, "lo que escribio A no aparece en B");

    // ─── Tabla global ───
    console.log("\n── Tabla global negocios ──");
    const lee = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM negocios WHERE slug IN ('test-rls-a', 'test-rls-b')`;
    comprobar(lee[0]?.n === 2, "la app lee negocios sin contexto (login: slug -> id)");
    const leeDesdeA = await probar(ids.A, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM negocios WHERE slug IN ('test-rls-a', 'test-rls-b')`));
    comprobar(leeDesdeA.ok && leeDesdeA.valor[0]?.n === 2, "y tambien desde un contexto de negocio");
    const rechazo = async (sql: string, ...args: unknown[]) => {
      let msg = "";
      try {
        await prisma.$executeRawUnsafe(sql, ...args);
      } catch (e) {
        msg = mensajeDe(e);
      }
      return msg;
    };
    const INS_NEG = `INSERT INTO negocios (id, nombre, slug, "actualizadoEn") VALUES (gen_random_uuid(), 'x', 'x-rls', now())`;
    comprobar(/row-level security/i.test(await rechazo(INS_NEG)), "sin contexto la app no puede crear negocios (RLS)");
    const insDesdeA = await probar(ids.A, (tx) => tx.$executeRawUnsafe(INS_NEG));
    comprobar(esRls(insDesdeA), "desde un contexto de negocio tampoco", JSON.stringify(insDesdeA));
    const updDesdeA = await probar(ids.A, (tx) => tx.$executeRawUnsafe(`UPDATE negocios SET activo = false WHERE id = $1::uuid`, ids.A));
    comprobar(updDesdeA.ok && updDesdeA.valor === 0, "un negocio no puede darse de baja (ni modificar) desde su contexto: 0 filas", JSON.stringify(updDesdeA));
    const updSinCtx = await prisma.$executeRawUnsafe(`UPDATE negocios SET activo = activo WHERE slug IN ('test-rls-a', 'test-rls-b')`);
    comprobar(updSinCtx === 0, "sin contexto UPDATE sobre negocios no toca nada", String(updSinCtx));
    comprobar(/permission denied/i.test(await rechazo(`DELETE FROM negocios WHERE slug = 'x-rls'`)), "la app no puede borrar negocios (sin permiso de DELETE)");
    const delSup = await probar(ids.A, (tx) => tx.$executeRawUnsafe(`SET LOCAL app.superadmin = 'on'`).then(() => tx.$executeRawUnsafe(`DELETE FROM negocios WHERE slug = 'x-rls'`)));
    comprobar(!delSup.ok && /permission denied/i.test(delSup.error), "ni el SUPERADMIN: los negocios no se borran (baja logica)", JSON.stringify(delSup));

    // ─── SUPERADMIN ───
    console.log("\n── SUPERADMIN (app.superadmin = 'on', sin negocio) ──");
    // Cuenta y sesion del SUPERADMIN, sembradas con el migrador (se borran en `limpiar`).
    const supId = (await fila<{ id: string }>(
      `INSERT INTO usuarios (id, "negocioId", usuario, nombre, rol, "hashClave", "actualizadoEn")
       VALUES (gen_random_uuid(), NULL, 'test-rls-super', 'Super', 'SUPERADMIN', 'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now()) RETURNING id`,
    ))[0]!.id;
    await mig.query(`INSERT INTO sesiones (id, "negocioId", "tokenHash", "usuarioId", "expiraEn") VALUES (gen_random_uuid(), NULL, md5(random()::text) || md5(random()::text), $1::uuid, now() + interval '1 day')`, [supId]);

    // 1. Ningun contexto de negocio ve al SUPERADMIN, ni sin contexto.
    for (const [k, id] of [["A", ids.A], ["B", ids.B]] as const) {
      for (const t of ["usuarios", "sesiones"]) {
        const r = await probar(id, (tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)} WHERE "negocioId" IS NULL`));
        comprobar(r.ok && r.valor[0]?.n === 0, `[${k}] ${t}: un contexto de negocio no ve las filas sin negocio (SUPERADMIN)`, JSON.stringify(r));
      }
    }
    for (const t of ["usuarios", "sesiones"]) {
      const n = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${q(t)} WHERE "negocioId" IS NULL`);
      comprobar(n[0]?.n === 0, `${t}: sin contexto tampoco se ven las filas sin negocio`, JSON.stringify(n));
    }

    // 2. El contexto de SUPERADMIN solo ve filas sin negocio: de ninguna tabla con negocioId ve datos de un negocio.
    for (const t of tablas) {
      const r = await conSuperadmin(async (tx) => {
        const todo = await tx.$queryRawUnsafe<{ n: number; propias: number }[]>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE "negocioId" IS NOT NULL)::int AS propias FROM ${q(t)}`);
        return todo[0]!;
      });
      comprobar(r.propias === 0, `${t}: el SUPERADMIN no ve ninguna fila de un negocio`, JSON.stringify(r));
      comprobar(["usuarios", "sesiones"].includes(t) ? r.n >= 1 : r.n === 0, `${t}: ${["usuarios", "sesiones"].includes(t) ? "ve su propia cuenta/sesion" : "no ve nada"}`, JSON.stringify(r));
    }

    // 3. No escribe en ninguna tabla de un negocio (solo RLS: triggers apagados).
    for (const t of tablas) await mig.query(`ALTER TABLE ${q(t)} DISABLE TRIGGER USER`);
    try {
      for (const t of tablas) {
        const r = await conSuperadmin(async (tx) => {
          try {
            await tx.$executeRawUnsafe(INSERT_PLANTILLA(t), plantillas.get(t)!.A, ids.A);
            return "inserto";
          } catch (e) {
            return mensajeDe(e);
          }
        }).catch((e) => mensajeDe(e));
        comprobar(/row-level security/i.test(r), `${t}: el SUPERADMIN no puede insertar filas de un negocio`, r);
        const upd = await conSuperadmin((tx) => tx.$executeRawUnsafe(`UPDATE ${q(t)} SET "negocioId" = "negocioId" WHERE "negocioId" = $1::uuid`, ids.A));
        const del = await conSuperadmin((tx) => tx.$executeRawUnsafe(`DELETE FROM ${q(t)} WHERE "negocioId" = $1::uuid`, ids.A));
        comprobar(upd === 0 && del === 0, `${t}: ni modificar ni borrar las de un negocio`, `${upd}/${del}`);
      }
      // Control positivo: una cuenta y una sesion sin negocio SI las acepta (se deshace).
      let ctrl = "";
      try {
        await conSuperadmin(async (tx) => {
          await tx.$executeRawUnsafe(
            `INSERT INTO usuarios (id, "negocioId", usuario, nombre, rol, "hashClave", "actualizadoEn") VALUES (gen_random_uuid(), NULL, 'test-rls-super2', 'S2', 'SUPERADMIN', 'scrypt$ln=14,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', now())`,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO sesiones (id, "negocioId", "tokenHash", "usuarioId", "expiraEn") VALUES (gen_random_uuid(), NULL, md5(random()::text) || md5(random()::text), $1::uuid, now() + interval '1 day')`,
            supId,
          );
          throw new Deshacer();
        });
      } catch (e) {
        ctrl = e instanceof Deshacer ? "ok" : mensajeDe(e);
      }
      comprobar(ctrl === "ok", "control positivo: el SUPERADMIN puede crear su cuenta y su sesion (sin negocio)", ctrl);
    } finally {
      for (const t of tablas) await mig.query(`ALTER TABLE ${q(t)} ENABLE TRIGGER USER`);
    }

    // 4. Escribe negocios (alta y cambio) y los lee todos.
    let alta: { baja: number; todos: number } | string = "";
    try {
      await conSuperadmin(async (tx) => {
        await tx.$executeRawUnsafe(INS_NEG);
        const baja = await tx.$executeRawUnsafe(`UPDATE negocios SET activo = false WHERE id = $1::uuid`, ids.A);
        const todos = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM negocios WHERE slug IN ('test-rls-a', 'test-rls-b', 'x-rls')`);
        throw Object.assign(new Deshacer(), { baja, todos: todos[0]!.n });
      });
    } catch (e) {
      alta = e instanceof Deshacer ? (e as unknown as { baja: number; todos: number }) : mensajeDe(e);
    }
    const quedoX = await fila<{ n: string }>(`SELECT count(*) AS n FROM negocios WHERE slug = 'x-rls'`);
    comprobar(typeof alta !== "string" && alta.baja === 1 && alta.todos === 3 && quedoX[0]?.n === "0", "el SUPERADMIN crea un negocio, da de baja otro y ve todos (se deshace)", JSON.stringify(alta));

    // 5. Cantidad de usuarios por negocio: solo conteos y solo para el SUPERADMIN.
    const cuentasReales = Object.fromEntries(
      await Promise.all(
        (["A", "B"] as const).map(async (k) => [k, Number((await fila<{ n: string }>(`SELECT count(*) AS n FROM usuarios WHERE "negocioId" = $1`, [ids[k]]))[0]!.n)] as const),
      ),
    );
    const porNegocio = await conSuperadmin((tx) => tx.$queryRaw<{ negocioId: string; usuarios: number; activos: number }[]>`SELECT * FROM usuarios_por_negocio()`);
    const deA = porNegocio.find((x) => x.negocioId === ids.A);
    const deB = porNegocio.find((x) => x.negocioId === ids.B);
    comprobar(deA?.usuarios === cuentasReales.A && deB?.usuarios === cuentasReales.B && deA?.activos === cuentasReales.A, "usuarios_por_negocio() da la cantidad de usuarios de cada negocio", JSON.stringify(porNegocio));
    comprobar(porNegocio.every((x) => x.negocioId !== null), "...y nunca cuenta al SUPERADMIN (sin negocio)");
    const desdeNegocio = await probar(ids.A, (tx) => tx.$queryRawUnsafe<unknown[]>(`SELECT * FROM usuarios_por_negocio()`));
    comprobar(desdeNegocio.ok && desdeNegocio.valor.length === 0, "desde un contexto de negocio no devuelve nada", JSON.stringify(desdeNegocio));
    const sinCtx = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM usuarios_por_negocio()`);
    comprobar(sinCtx.length === 0, "sin contexto no devuelve nada", JSON.stringify(sinCtx));
    const publico = await fila<{ n: string }>(`SELECT count(*) AS n FROM information_schema.routine_privileges WHERE routine_name = 'usuarios_por_negocio' AND grantee = 'PUBLIC'`);
    comprobar(publico[0]?.n === "0", "usuarios_por_negocio() no es ejecutable por PUBLIC");

    // 6. Con ambas marcas (alta de un negocio nuevo) ve el negocio declarado + las cuentas sin negocio, nada de los otros.
    const ambos = await conSuperadmin(
      async (tx) => (await tx.$queryRawUnsafe<{ propias: number; ajenas: number; sin: number }[]>(
        `SELECT count(*) FILTER (WHERE "negocioId" = $1::uuid)::int AS propias, count(*) FILTER (WHERE "negocioId" <> $1::uuid)::int AS ajenas, count(*) FILTER (WHERE "negocioId" IS NULL)::int AS sin FROM usuarios`,
        ids.A,
      ))[0]!,
      { negocioId: ids.A },
    );
    comprobar(ambos.propias === cuentasReales.A && ambos.ajenas === 0 && ambos.sin >= 1, "con el negocio declarado ademas, ve ese negocio y las cuentas sin negocio, no otros", JSON.stringify(ambos));
  } finally {
    await limpiar().catch((e) => {
      fallos += 1;
      console.log(`FALLA no se pudo limpiar los negocios de prueba: ${mensajeDe(e)}`);
    });
    const quedan = await fila<{ n: string }>(`SELECT count(*) AS n FROM negocios WHERE slug IN ('test-rls-a', 'test-rls-b')`);
    comprobar(quedan[0]?.n === "0", "limpieza: no quedan negocios de prueba");
    await mig.end();
    await prisma.$disconnect();
  }

  console.log(`\n${pruebas - fallos}/${pruebas} comprobaciones OK`);
  if (fallos > 0) {
    console.error(`\nFALLO: ${fallos} comprobacion(es) con error.`);
    process.exit(1);
  }
  console.log("RLS: todo bien.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
