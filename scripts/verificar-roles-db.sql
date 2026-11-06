-- Verificacion de los roles y permisos del multi-tenant (VTA-21). Solo LEE el catalogo: es seguro
-- correrla sobre cualquier base ya migrada, tambien una real, con cualquier rol que pueda conectarse:
--
--   psql "$DATABASE_URL_MIGRACIONES" -X -v ON_ERROR_STOP=1 -f scripts/verificar-roles-db.sql
--
-- Hay que correrla DESPUES de migrar y de volver a correr scripts/crear-roles-db.sql, y tambien
-- despues de restaurar un respaldo completo (el volcado va sin permisos). Cualquier incumplimiento
-- lanza una excepcion con lo que falta.
DO $$
DECLARE
  dueno_funcion TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventas_app') THEN RAISE EXCEPTION 'falta el rol ventas_app'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventas_migrador') THEN RAISE EXCEPTION 'falta el rol ventas_migrador'; END IF;
  IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'ventas_app') THEN
    RAISE EXCEPTION 'ventas_app es superusuario o tiene BYPASSRLS: RLS no aislaria los negocios (tambien si hereda de otro rol)';
  END IF;
  -- Un rol miembro de otro con BYPASSRLS/SUPERUSER (por ejemplo neon_superuser) lo hereda en sus permisos de tabla.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
      JOIN pg_roles padre ON padre.oid = m.roleid
      JOIN pg_roles hijo ON hijo.oid = m.member
     WHERE hijo.rolname = 'ventas_app' AND (padre.rolsuper OR padre.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'ventas_app es miembro de un rol con SUPERUSER o BYPASSRLS';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'ventas_migrador') THEN
    RAISE EXCEPTION 'ventas_migrador no tiene BYPASSRLS (backfills, respaldo por negocio y usuarios_por_negocio() lo necesitan)';
  END IF;
  IF to_regclass('public.negocios') IS NULL THEN RAISE EXCEPTION 'la base no esta migrada: no existe la tabla negocios'; END IF;
  IF NOT has_table_privilege('ventas_app', 'public.negocios', 'SELECT')
     OR NOT has_table_privilege('ventas_app', 'public.negocios', 'INSERT')
     OR NOT has_table_privilege('ventas_app', 'public.negocios', 'UPDATE') THEN
    RAISE EXCEPTION 'ventas_app necesita SELECT, INSERT y UPDATE sobre negocios: re-correr scripts/crear-roles-db.sql';
  END IF;
  IF has_table_privilege('ventas_app', 'public.negocios', 'DELETE') THEN RAISE EXCEPTION 'ventas_app puede borrar negocios'; END IF;
  IF to_regprocedure('public.usuarios_por_negocio()') IS NULL THEN RAISE EXCEPTION 'falta la funcion usuarios_por_negocio()'; END IF;
  IF NOT has_function_privilege('ventas_app', 'public.usuarios_por_negocio()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ventas_app necesita EXECUTE sobre usuarios_por_negocio(): re-correr scripts/crear-roles-db.sql';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'public.usuarios_por_negocio()'::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'usuarios_por_negocio() es ejecutable por PUBLIC (tras restaurar un respaldo): REVOKE ALL ON FUNCTION public.usuarios_por_negocio() FROM PUBLIC y re-correr scripts/crear-roles-db.sql';
  END IF;
  SELECT r.rolname INTO dueno_funcion FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid = 'public.usuarios_por_negocio()'::regprocedure;
  IF NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = dueno_funcion) THEN
    RAISE EXCEPTION 'el dueno de usuarios_por_negocio() (%) no tiene BYPASSRLS: la funcion devolveria 0 filas', dueno_funcion;
  END IF;
  IF has_table_privilege('ventas_app', 'public._prisma_migrations', 'SELECT') THEN
    RAISE EXCEPTION 'ventas_app puede leer _prisma_migrations';
  END IF;
  -- Ninguna tabla de datos debe tener un dueno distinto del que migra: ALTER/CREATE TRIGGER fallarian.
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner NOT IN (dueno_funcion)) THEN
    RAISE EXCEPTION 'hay tablas cuyo dueno no es % (quien creo usuarios_por_negocio()): %', dueno_funcion,
      (SELECT string_agg(tablename || ' (' || tableowner || ')', ', ') FROM pg_tables WHERE schemaname = 'public' AND tableowner NOT IN (dueno_funcion));
  END IF;
  RAISE NOTICE 'roles y permisos OK: ventas_app sin BYPASSRLS, SELECT/INSERT/UPDATE (no DELETE) en negocios, EXECUTE en usuarios_por_negocio() (no PUBLIC); ventas_migrador con BYPASSRLS y dueno de las tablas';
END $$;
