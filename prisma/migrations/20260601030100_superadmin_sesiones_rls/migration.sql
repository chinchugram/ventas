-- Multi-tenant F4.3 (2/2): el SUPERADMIN puede existir y operar sin negocio, sin romper el
-- aislamiento de los usuarios de un negocio.
--
-- Hasta aca `sesiones.negocioId` era NOT NULL y las politicas RLS de `usuarios`/`sesiones`
-- solo mostraban filas con el `negocioId` del contexto: un usuario sin negocio no se veia
-- desde ningun lado. Decisiones:
--
--   * Contexto de SUPERADMIN: la transaccion declara `app.superadmin = 'on'`
--     (`set_config(..., true)`: vive solo dentro de la transaccion, como `app.negocio_id`;
--     helpers `conSuperadmin` en src/lib/negocio.ts y `conSuperadminEn` en dominio/auth.ts).
--     Es el mismo modelo de confianza que `app.negocio_id`: lo fija el codigo del servidor,
--     nunca un dato del cliente.
--   * `usuarios` y `sesiones`: la politica sigue siendo UNA sola (FOR ALL, USING = WITH CHECK)
--     y agrega una rama: tambien son visibles/escribibles las filas con `negocioId IS NULL`
--     cuando el contexto es de SUPERADMIN. Un contexto de negocio nunca ve esas filas (sin la
--     marca la rama es falsa), y un contexto de SUPERADMIN sin negocio solo ve filas sin
--     negocio: NO ve ni toca usuarios, sesiones ni datos de ningun negocio. (Para dar de alta
--     el primer dueno de un negocio nuevo el codigo declara ADEMAS `app.negocio_id` de ese
--     negocio recien creado, que todavia esta vacio.)
--   * CHECK `usuarios_superadmin_sin_negocio`: rol SUPERADMIN <=> sin negocio. Un SUPERADMIN
--     con negocio o un dueno/empleado sin negocio no pueden existir.
--   * `sesiones.negocioId` admite NULL (la sesion del SUPERADMIN). El trigger
--     `sesiones_usuarioId_mismo_negocio` pasa a exigir que sea IGUAL al del usuario (antes un
--     usuario sin negocio era "autor valido" en cualquier negocio: para una sesion eso seria
--     entrar al negocio de otro con la cuenta del SUPERADMIN, o al reves).
--   * `negocios` (global, la leen el login y el SUPERADMIN) ahora tiene RLS: lectura libre
--     (el login resuelve slug -> id antes de tener contexto); alta y cambios solo con
--     `app.superadmin = 'on'`. Nunca DELETE (baja logica). La app (ventas_app) recibe
--     INSERT/UPDATE: sin la politica, cualquier error de la app podria tocar negocios ajenos.
--   * El SUPERADMIN ve del negocio "nombre, estado y cantidad de usuarios, nada mas": la
--     cantidad sale de `usuarios_por_negocio()`, una funcion SECURITY DEFINER que solo
--     devuelve conteos y solo responde con `app.superadmin = 'on'`. Corre con los permisos de
--     su dueno (el migrador, BYPASSRLS): si el dueno no tuviera BYPASSRLS devolveria 0 filas
--     (falla cerrado), nunca datos de mas.

-- ─── 1. Usuarios ──────────────────────────────────────────────────────────────

ALTER TABLE "usuarios" ADD COLUMN "debeCambiarClave" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "usuarios"
  ADD CONSTRAINT "usuarios_superadmin_sin_negocio" CHECK (("rol" = 'SUPERADMIN') = ("negocioId" IS NULL));

-- ─── 2. Sesiones sin negocio (SUPERADMIN) ─────────────────────────────────────

ALTER TABLE "sesiones" ALTER COLUMN "negocioId" DROP NOT NULL;

DROP TRIGGER "sesiones_usuarioId_mismo_negocio" ON "sesiones";

CREATE FUNCTION "sesion_mismo_negocio_que_su_usuario"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  existe BOOLEAN;
  negocio_usuario UUID;
BEGIN
  SELECT true, "negocioId" INTO existe, negocio_usuario FROM "usuarios" WHERE "id" = NEW."usuarioId";
  -- Estricto: un usuario que no se ve desde este contexto (o que no existe) no puede tener sesion aca.
  IF existe IS NULL THEN
    RAISE EXCEPTION 'sesiones.usuarioId apunta a un usuario que no existe o es de otro negocio'
      USING ERRCODE = 'check_violation';
  END IF;
  IF negocio_usuario IS DISTINCT FROM NEW."negocioId" THEN
    RAISE EXCEPTION 'sesiones.negocioId tiene que ser el negocio del usuario (el SUPERADMIN, sin negocio, solo tiene sesiones sin negocio)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sesiones_usuarioId_mismo_negocio"
  BEFORE INSERT OR UPDATE OF "negocioId", "usuarioId" ON "sesiones"
  FOR EACH ROW EXECUTE FUNCTION "sesion_mismo_negocio_que_su_usuario"();

-- ─── 3. Politicas de usuarios y sesiones ──────────────────────────────────────

DO $$
DECLARE
  t TEXT;
  condicion TEXT :=
    '"negocioId" = NULLIF(current_setting(''app.negocio_id'', true), '''')::uuid '
    'OR ("negocioId" IS NULL AND current_setting(''app.superadmin'', true) = ''on'')';
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios', 'sesiones'] LOOP
    EXECUTE format('DROP POLICY "aislamiento_negocio" ON %I', t);
    EXECUTE format('CREATE POLICY "aislamiento_negocio" ON %I USING (%s) WITH CHECK (%s)', t, condicion, condicion);
  END LOOP;
END $$;

-- ─── 4. negocios: lectura libre, alta y cambios solo del SUPERADMIN ───────────

ALTER TABLE "negocios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "negocios" FORCE ROW LEVEL SECURITY;

CREATE POLICY "negocios_lectura" ON "negocios" FOR SELECT USING (true);
CREATE POLICY "negocios_alta_superadmin" ON "negocios" FOR INSERT
  WITH CHECK (current_setting('app.superadmin', true) = 'on');
CREATE POLICY "negocios_cambio_superadmin" ON "negocios" FOR UPDATE
  USING (current_setting('app.superadmin', true) = 'on')
  WITH CHECK (current_setting('app.superadmin', true) = 'on');

-- ─── 5. Cantidad de usuarios por negocio (solo conteos) ───────────────────────

CREATE FUNCTION "usuarios_por_negocio"() RETURNS TABLE ("negocioId" UUID, "usuarios" INTEGER, "activos" INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u."negocioId", count(*)::int, (count(*) FILTER (WHERE u."activo"))::int
    FROM "usuarios" u
   WHERE current_setting('app.superadmin', true) = 'on' AND u."negocioId" IS NOT NULL
   GROUP BY u."negocioId"
$$;
REVOKE ALL ON FUNCTION "usuarios_por_negocio"() FROM PUBLIC;

-- ─── 6. Permisos de ventas_app (si el rol ya existe; si no, scripts/crear-roles-db.sql) ───

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventas_app') THEN
    GRANT INSERT, UPDATE ON "negocios" TO ventas_app;
    GRANT EXECUTE ON FUNCTION "usuarios_por_negocio"() TO ventas_app;
  ELSE
    RAISE NOTICE 'El rol ventas_app no existe: crealo con scripts/crear-roles-db.sql';
  END IF;
END $$;
