-- Verificacion post-migracion 20260601000000_negocio + 20260601020000_negocio_produccion
-- (la corre scripts/test-negocio-migracion.sh, pero sirve sobre cualquier base migrada
-- a fondo: las 26 tablas de datos, con configuracion y las 3 de produccion de la ola 6).
-- Cualquier incumplimiento lanza una excepcion.
DO $$
DECLARE
  c RECORD; n BIGINT; nid UUID; total INT := 0;
BEGIN
  SELECT count(*) INTO n FROM negocios;
  IF n <> 1 THEN RAISE EXCEPTION 'Tiene que haber un negocio y hay %', n; END IF;
  SELECT id INTO nid FROM negocios WHERE slug = 'hl-laser' AND nombre = 'HL Laser' AND activo;
  IF nid IS NULL THEN RAISE EXCEPTION 'Falta el negocio HL Laser (hl-laser)'; END IF;

  FOR c IN SELECT table_name, is_nullable, column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'negocioId' ORDER BY table_name LOOP
    total := total + 1;
    IF c.column_default IS NOT NULL THEN RAISE EXCEPTION '% tiene DEFAULT en negocioId', c.table_name; END IF;
    -- usuarios y sesiones admiten NULL: es la cuenta (y la sesion) del SUPERADMIN, que no tiene negocio.
    IF c.is_nullable = 'YES' AND c.table_name NOT IN ('usuarios', 'sesiones') THEN
      RAISE EXCEPTION '% deberia tener negocioId NOT NULL', c.table_name;
    END IF;
    IF c.is_nullable = 'NO' AND c.table_name IN ('usuarios', 'sesiones') THEN
      RAISE EXCEPTION '%.negocioId tiene que ser nullable (SUPERADMIN)', c.table_name;
    END IF;
    -- Ninguna fila sin negocio (hoy ni siquiera usuarios) y todas de HL Laser.
    EXECUTE format('SELECT count(*) FROM %I WHERE "negocioId" IS DISTINCT FROM $1', c.table_name) INTO n USING nid;
    IF n > 0 THEN RAISE EXCEPTION '% tiene % filas que no son de HL Laser', c.table_name, n; END IF;
  END LOOP;
  IF total <> 26 THEN RAISE EXCEPTION 'Se esperaban 26 tablas con negocioId (22 + configuracion + 3 de produccion) y hay %', total; END IF;
  -- Las 3 tablas de produccion (ola 6) estan entre ellas, con FK RESTRICT, indice y los triggers de negocio.
  FOR c IN SELECT unnest(ARRAY['trabajos_produccion', 'trabajo_tiempos', 'trabajo_consumos']) AS tabla LOOP
    SELECT count(*) INTO n FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = c.tabla AND column_name = 'negocioId' AND is_nullable = 'NO';
    IF n <> 1 THEN RAISE EXCEPTION '% no tiene negocioId NOT NULL', c.tabla; END IF;
    SELECT count(*) INTO n FROM pg_constraint
      WHERE conrelid = format('public.%I', c.tabla)::regclass AND contype = 'f' AND conname = c.tabla || '_negocioId_fkey' AND confdeltype = 'r';
    IF n <> 1 THEN RAISE EXCEPTION '% no tiene la FK negocioId con ON DELETE RESTRICT', c.tabla; END IF;
    SELECT count(*) INTO n FROM pg_indexes WHERE schemaname = 'public' AND tablename = c.tabla AND indexname = c.tabla || '_negocioId_idx';
    IF n <> 1 THEN RAISE EXCEPTION '% no tiene indice por negocioId', c.tabla; END IF;
    SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = format('public.%I', c.tabla)::regclass AND NOT tgisinternal
      AND tgname = c.tabla || '_negocio_inmutable';
    IF n <> 1 THEN RAISE EXCEPTION '% no tiene el trigger negocio_inmutable', c.tabla; END IF;
    SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = format('public.%I', c.tabla)::regclass AND NOT tgisinternal
      AND tgname LIKE '%\_mismo\_negocio';
    IF n < 2 THEN RAISE EXCEPTION '% no tiene sus triggers negocio_igual_al_padre (hay %)', c.tabla, n; END IF;
  END LOOP;

  -- Los triggers de comprobantes se desactivan durante el backfill: tienen que volver.
  SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'O';
  IF n > 0 THEN RAISE EXCEPTION 'Quedaron % triggers desactivados', n; END IF;

  -- Toda tabla de datos tiene negocioId (configuracion lo lleva en su clave compuesta).
  SELECT count(*) INTO n FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    AND t.table_name NOT IN ('negocios', 'configuracion', '_prisma_migrations')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns k
                    WHERE k.table_schema = 'public' AND k.table_name = t.table_name AND k.column_name = 'negocioId');
  IF n > 0 THEN RAISE EXCEPTION '% tablas de datos sin negocioId', n; END IF;
END $$;

-- Insertar sin negocio tiene que fallar (no hay DEFAULT).
DO $$
BEGIN
  BEGIN
    INSERT INTO maquinas (id, nombre, "actualizadoEn") VALUES (gen_random_uuid(), 'sin negocio', now());
    RAISE EXCEPTION 'Se pudo insertar una maquina sin negocioId';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
END $$;
