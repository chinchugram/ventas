-- Verificacion post-migracion 20260601000000_negocio (la corre
-- scripts/test-negocio-migracion.sh, pero sirve sobre cualquier base migrada).
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
    IF c.is_nullable = 'YES' AND c.table_name <> 'usuarios' THEN
      RAISE EXCEPTION '% deberia tener negocioId NOT NULL', c.table_name;
    END IF;
    IF c.is_nullable = 'NO' AND c.table_name = 'usuarios' THEN
      RAISE EXCEPTION 'usuarios.negocioId tiene que ser nullable (SUPERADMIN)';
    END IF;
    -- Ninguna fila sin negocio (hoy ni siquiera usuarios) y todas de HL Laser.
    EXECUTE format('SELECT count(*) FROM %I WHERE "negocioId" IS DISTINCT FROM $1', c.table_name) INTO n USING nid;
    IF n > 0 THEN RAISE EXCEPTION '% tiene % filas que no son de HL Laser', c.table_name, n; END IF;
  END LOOP;
  IF total <> 22 THEN RAISE EXCEPTION 'Se esperaban 22 tablas con negocioId y hay %', total; END IF;

  -- Los triggers de comprobantes se desactivan durante el backfill: tienen que volver.
  SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'O';
  IF n > 0 THEN RAISE EXCEPTION 'Quedaron % triggers desactivados', n; END IF;

  -- Toda tabla de datos (menos configuracion, que es de F1.2) tiene negocioId.
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
