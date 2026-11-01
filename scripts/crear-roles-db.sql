-- Roles de base de datos para el aislamiento por negocio (multi-tenant F2.1).
-- Idempotente: se puede correr las veces que haga falta. Lo corre un superusuario
-- (o el dueno de la base) sobre la base de la app:
--
--   psql "$DATABASE_URL_ADMIN" -v ON_ERROR_STOP=1 \
--        -v app_password="'clave-de-la-app'" -v migrador_password="'clave-del-migrador'" \
--        -f scripts/crear-roles-db.sql
--
-- Local: sin -v se usan las claves de desarrollo `ventas_app` / `ventas_migrador`.
-- En produccion/Neon pasar claves reales (los roles de Neon se crean desde su consola o
-- con este mismo script; `BYPASSRLS` en el migrador solo existe si el rol que corre el
-- script puede otorgarlo).
--
--   ventas_app        La app en runtime. NO es superusuario, NO tiene BYPASSRLS y no es
--                     dueno de ninguna tabla: las politicas RLS le rigen siempre.
--                     En `negocios` lee, inserta y actualiza (RLS: solo en contexto de SUPERADMIN); nunca borra.
--   ventas_migrador   Dueno del esquema: corre `prisma migrate deploy` y los backfills.
--                     Tiene BYPASSRLS para poder tocar todos los negocios.

\if :{?app_password}
\else
  \set app_password '''ventas_app'''
\endif
\if :{?migrador_password}
\else
  \set migrador_password '''ventas_migrador'''
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventas_app') AS crear_app \gset
\if :crear_app
  CREATE ROLE ventas_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
\endif
ALTER ROLE ventas_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :app_password;

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventas_migrador') AS crear_migrador \gset
\if :crear_migrador
  CREATE ROLE ventas_migrador LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
\endif
ALTER ROLE ventas_migrador WITH LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :migrador_password;

-- Esquema de la base actual: el migrador lo usa y crea objetos; la app solo lo recorre.
GRANT ALL ON SCHEMA public TO ventas_migrador;
GRANT USAGE ON SCHEMA public TO ventas_app;

-- Permisos sobre lo que ya existe (la migracion 20260601020000_rls hace lo mismo si el
-- rol ya existia al migrar). Si las tablas todavia no existen, no pasa nada.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ventas_app;
DO $$
BEGIN
  IF to_regclass('public.negocios') IS NOT NULL THEN
    -- negocios: la app lee, inserta y actualiza (solo en contexto de SUPERADMIN: lo fuerza RLS), nunca borra.
    REVOKE DELETE ON "negocios" FROM ventas_app;
  END IF;
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM ventas_app;
  END IF;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ventas_app;
DO $$
BEGIN
  IF to_regprocedure('public.usuarios_por_negocio()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.usuarios_por_negocio() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.usuarios_por_negocio() TO ventas_app;
  END IF;
END $$;

-- A proposito NO hay ALTER DEFAULT PRIVILEGES: una tabla nueva debe traer en SU migracion
-- el RLS, la politica y el GRANT a ventas_app. Si falta, la app falla fuerte
-- ("permission denied") en vez de quedar con una tabla abierta o sin aislar.
