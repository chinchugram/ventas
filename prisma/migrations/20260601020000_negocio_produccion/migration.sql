-- Multi-tenant F1.3 (VTA-24): `negocioId` en las tablas de produccion de la ola 6
-- (`trabajos_produccion`, `trabajo_tiempos`, `trabajo_consumos`).
--
-- La ola 6 (migracion 20260401000000_produccion) entro a `multitenant` despues de F1.1/F1.2
-- y sus tablas quedaron sin dueno. Esta migracion sigue el patron de
-- 20260601000000_negocio (columna nullable -> backfill al negocio `hl-laser` -> NOT NULL ->
-- FK RESTRICT -> indice) y de 20260601010000_unicos_por_negocio (trigger
-- `negocio_inmutable` y `negocio_igual_al_padre` por cada FK de la tabla).
--
-- Decisiones:
--   * Columna propia tambien en las hijas (`trabajo_tiempos`, `trabajo_consumos`), igual que
--     `venta_items` o `pagos`: RLS (F2.1) filtra sin joins.
--   * Sin DEFAULT: toda fila nueva dice de que negocio es.
--   * Estas tablas no tienen triggers de inmutabilidad propios, asi que el backfill no
--     necesita desactivar nada.
--   * Los unicos (`trabajo_tiempos(trabajoId, maquinaId)`, `trabajo_consumos(trabajoId, materialId)`,
--     el parcial `trabajos_produccion_vigente_key` por `ventaItemId`) no cambian: todos
--     cuelgan de ids UUID, que no pueden chocar entre negocios.

-- ─── 1. Columna nullable ──────────────────────────────────────────────────────

ALTER TABLE "trabajos_produccion" ADD COLUMN "negocioId" UUID;
ALTER TABLE "trabajo_tiempos" ADD COLUMN "negocioId" UUID;
ALTER TABLE "trabajo_consumos" ADD COLUMN "negocioId" UUID;

-- ─── 2. Backfill: todas las filas existentes son de "HL Laser" ────────────────

UPDATE "trabajos_produccion" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "trabajo_tiempos" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "trabajo_consumos" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');

-- ─── 3. NOT NULL ──────────────────────────────────────────────────────────────

ALTER TABLE "trabajos_produccion" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "trabajo_tiempos" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "trabajo_consumos" ALTER COLUMN "negocioId" SET NOT NULL;

-- ─── 4. Claves foraneas ───────────────────────────────────────────────────────

ALTER TABLE "trabajos_produccion" ADD CONSTRAINT "trabajos_produccion_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajo_tiempos" ADD CONSTRAINT "trabajo_tiempos_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajo_consumos" ADD CONSTRAINT "trabajo_consumos_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 5. Indices ───────────────────────────────────────────────────────────────

CREATE INDEX "trabajos_produccion_negocioId_idx" ON "trabajos_produccion"("negocioId");
CREATE INDEX "trabajo_tiempos_negocioId_idx" ON "trabajo_tiempos"("negocioId");
CREATE INDEX "trabajo_consumos_negocioId_idx" ON "trabajo_consumos"("negocioId");

-- ─── 6. Triggers: negocio inmutable y "el hijo es del mismo negocio que el padre" ──

DO $$
DECLARE
  t TEXT;
  f RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['trabajos_produccion', 'trabajo_tiempos', 'trabajo_consumos'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF "negocioId" ON %I FOR EACH ROW WHEN (OLD."negocioId" IS DISTINCT FROM NEW."negocioId") EXECUTE FUNCTION "negocio_inmutable"()',
      t || '_negocio_inmutable', t);
  END LOOP;

  -- (hijo, columna FK, padre). Un usuario sin negocio (SUPERADMIN) puede figurar como autor.
  FOR f IN SELECT * FROM (VALUES
    ('trabajos_produccion', 'ventaItemId', 'venta_items'),
    ('trabajos_produccion', 'usuarioId', 'usuarios'),
    ('trabajo_tiempos', 'trabajoId', 'trabajos_produccion'),
    ('trabajo_tiempos', 'maquinaId', 'maquinas'),
    ('trabajo_consumos', 'trabajoId', 'trabajos_produccion'),
    ('trabajo_consumos', 'materialId', 'materiales')
  ) AS x(hijo, columna, padre) LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "negocioId", %I ON %I FOR EACH ROW EXECUTE FUNCTION "negocio_igual_al_padre"(%L, %L)',
      f.hijo || '_' || f.columna || '_mismo_negocio', f.columna, f.hijo, f.padre, f.columna);
  END LOOP;
END $$;
