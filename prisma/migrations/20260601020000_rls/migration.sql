-- Multi-tenant F2.1: aislamiento entre negocios forzado por Postgres (Row Level Security).
--
-- Hasta aca `negocioId` era una columna: filtrar por ella dependia de que cada consulta
-- se acordara del WHERE. Desde esta migracion lo exige la base: en cada tabla con
-- `negocioId` solo se ven y se escriben las filas del negocio que la transaccion declara
-- con `SELECT set_config('app.negocio_id', '<uuid>', true)` (helper `conNegocio`,
-- src/lib/negocio.ts).
--
-- Decisiones:
--   * `ENABLE` + `FORCE` ROW LEVEL SECURITY: FORCE hace que la politica tambien rija al
--     DUENO de la tabla (sin FORCE, el rol que migra veria todo sin darse cuenta).
--     Sigue saltandose la politica quien tiene SUPERUSER o BYPASSRLS: por eso la app
--     conecta con `ventas_app` (sin ninguno de los dos) y las migraciones con
--     `ventas_migrador` (BYPASSRLS, para poder rellenar datos de todos los negocios).
--   * Una sola politica `FOR ALL` por tabla, con USING (que filas se ven / se pueden
--     tocar) y WITH CHECK (que filas se pueden escribir) iguales. Un INSERT/UPDATE que
--     deje la fila con otro `negocioId` lo rechaza la base ("violates row-level security
--     policy").
--   * Falla cerrado: sin `app.negocio_id` (nunca definido, o ya fuera de la transaccion:
--     Postgres lo deja en '' despues de un `set_config(..., true)`) la condicion es
--     `negocioId = NULL`, que nunca es verdadera -> no se ve ni se escribe nada.
--     `NULLIF(..., '')` evita que el '' rompa con "invalid input syntax for type uuid".
--   * `negocios` es la unica tabla global: SIN RLS. El rol de la app solo la LEE (el
--     login resuelve slug -> id antes de tener contexto; el SUPERADMIN lista negocios).
--     Altas/bajas de negocios las hace un rol de migracion/administracion.
--   * `usuarios.negocioId` es NULL para el futuro SUPERADMIN: esas filas no matchean
--     ninguna politica, o sea que desde un contexto de negocio no se ven. El login del
--     SUPERADMIN necesita un camino propio (F4.1).
--   * Permisos: si existe el rol `ventas_app` se le otorga SELECT/INSERT/UPDATE/DELETE
--     en las tablas de datos (solo SELECT en `negocios`) y USAGE en las secuencias; si
--     todavia no existe (base sin los dos roles) la migracion sigue y los permisos los
--     da `scripts/crear-roles-db.sql`. Las tablas que se creen despues deben agregarse
--     a la lista de abajo en su propia migracion (`npm run test:rls` lo verifica).

DO $$
DECLARE
  t TEXT;
  sin_cubrir TEXT;
  tablas TEXT[] := ARRAY[
    'clientes', 'materiales', 'maquinas', 'articulos', 'listas_precios', 'lista_precio_items',
    'recetas', 'receta_componentes', 'ventas', 'venta_items', 'pagos', 'compras', 'compra_items',
    'movimientos_stock', 'contactos_cobranza', 'presupuestos', 'presupuesto_items',
    'usuarios', 'sesiones', 'comprobantes', 'comprobante_items', 'comprobante_iva',
    'configuracion', 'trabajos_produccion', 'trabajo_tiempos', 'trabajo_consumos'
  ];
BEGIN
  -- Red de seguridad: toda tabla con `negocioId` tiene que estar en la lista.
  SELECT string_agg(c.table_name, ', ') INTO sin_cubrir
    FROM information_schema.columns c
    JOIN information_schema.tables tb USING (table_schema, table_name)
   WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
     AND c.column_name = 'negocioId' AND NOT (c.table_name = ANY (tablas));
  IF sin_cubrir IS NOT NULL THEN
    RAISE EXCEPTION 'Tablas con negocioId sin politica RLS: %', sin_cubrir;
  END IF;

  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "aislamiento_negocio" ON %I '
      'USING ("negocioId" = NULLIF(current_setting(''app.negocio_id'', true), '''')::uuid) '
      'WITH CHECK ("negocioId" = NULLIF(current_setting(''app.negocio_id'', true), '''')::uuid)',
      t);
  END LOOP;

  -- Permisos del rol de la app (si ya existe).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventas_app') THEN
    FOREACH t IN ARRAY tablas LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ventas_app', t);
    END LOOP;
    GRANT SELECT ON "negocios" TO ventas_app;
    GRANT USAGE ON SCHEMA public TO ventas_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ventas_app;
  ELSE
    RAISE NOTICE 'El rol ventas_app no existe: crealo con scripts/crear-roles-db.sql';
  END IF;
END $$;
