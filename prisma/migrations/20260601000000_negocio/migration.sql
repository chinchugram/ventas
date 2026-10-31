-- Multi-tenant F1.1: tabla `negocios` y `negocioId` en todas las tablas de datos.
--
-- Hoy ninguna tabla tiene dueno. Esta migracion crea el negocio "HL Laser"
-- (slug `hl-laser`) y se lo asigna a TODAS las filas existentes. Pasos por tabla:
-- columna nullable -> rellenar -> SET NOT NULL. Sin DEFAULT (ni temporal ni
-- permanente): despues de migrar, toda fila nueva tiene que decir de que negocio es.
--
-- Decisiones:
--   * `negocioId` va en TODAS las tablas de datos, tambien en las hijas
--     (venta_items, pagos, receta_componentes, comprobante_items, ...), para que
--     RLS (F2.1) filtre por una columna propia sin joins.
--   * `usuarios.negocioId` queda NULLABLE: solo el futuro SUPERADMIN va sin negocio.
--     Hoy todos los usuarios quedan con negocio.
--   * `configuracion` no se toca: la resuelve F1.2.
--   * Los unicos (numero de venta por anio, nombre de lista, usuario, ...) siguen
--     globales: pasan a ser por negocio en F1.2.
--   * FK `ON DELETE RESTRICT`: un negocio con datos no se borra (baja logica).
--   * Indices: uno por `negocioId` en cada tabla; en las grandes (ventas, pagos,
--     movimientos_stock, comprobantes) `negocioId` es la primera columna de los
--     indices compuestos, que cubren tambien las consultas solo por negocio.
--   * `comprobantes`, `comprobante_items` y `comprobante_iva` tienen triggers que
--     vuelven inmutable lo fiscal (un UPDATE de un comprobante EMITIDO falla). El
--     backfill es una asignacion de dueno, no un cambio fiscal: los triggers se
--     desactivan solo durante el UPDATE de esas tres tablas y se reactivan en el
--     acto (todo dentro de la transaccion de la migracion).

-- CreateTable
CREATE TABLE "negocios" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "negocios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "negocios_slug_key" ON "negocios"("slug");

-- Negocio de las filas existentes (y primer negocio de una base vacia).
INSERT INTO "negocios" ("id", "nombre", "slug", "actualizadoEn")
VALUES (gen_random_uuid(), 'HL Laser', 'hl-laser', CURRENT_TIMESTAMP);

-- ─── 1. Columna nullable ──────────────────────────────────────────────────────

ALTER TABLE "clientes" ADD COLUMN "negocioId" UUID;
ALTER TABLE "materiales" ADD COLUMN "negocioId" UUID;
ALTER TABLE "maquinas" ADD COLUMN "negocioId" UUID;
ALTER TABLE "articulos" ADD COLUMN "negocioId" UUID;
ALTER TABLE "listas_precios" ADD COLUMN "negocioId" UUID;
ALTER TABLE "lista_precio_items" ADD COLUMN "negocioId" UUID;
ALTER TABLE "recetas" ADD COLUMN "negocioId" UUID;
ALTER TABLE "receta_componentes" ADD COLUMN "negocioId" UUID;
ALTER TABLE "ventas" ADD COLUMN "negocioId" UUID;
ALTER TABLE "venta_items" ADD COLUMN "negocioId" UUID;
ALTER TABLE "pagos" ADD COLUMN "negocioId" UUID;
ALTER TABLE "compras" ADD COLUMN "negocioId" UUID;
ALTER TABLE "compra_items" ADD COLUMN "negocioId" UUID;
ALTER TABLE "movimientos_stock" ADD COLUMN "negocioId" UUID;
ALTER TABLE "contactos_cobranza" ADD COLUMN "negocioId" UUID;
ALTER TABLE "presupuestos" ADD COLUMN "negocioId" UUID;
ALTER TABLE "presupuesto_items" ADD COLUMN "negocioId" UUID;
ALTER TABLE "usuarios" ADD COLUMN "negocioId" UUID;
ALTER TABLE "sesiones" ADD COLUMN "negocioId" UUID;
ALTER TABLE "comprobantes" ADD COLUMN "negocioId" UUID;
ALTER TABLE "comprobante_items" ADD COLUMN "negocioId" UUID;
ALTER TABLE "comprobante_iva" ADD COLUMN "negocioId" UUID;

-- ─── 2. Backfill: todas las filas existentes son de "HL Laser" ────────────────

UPDATE "clientes" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "materiales" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "maquinas" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "articulos" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "listas_precios" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "lista_precio_items" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "recetas" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "receta_componentes" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "ventas" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "venta_items" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "pagos" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "compras" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "compra_items" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "movimientos_stock" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "contactos_cobranza" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "presupuestos" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "presupuesto_items" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "usuarios" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
UPDATE "sesiones" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
ALTER TABLE "comprobantes" DISABLE TRIGGER USER;
UPDATE "comprobantes" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
ALTER TABLE "comprobantes" ENABLE TRIGGER USER;
ALTER TABLE "comprobante_items" DISABLE TRIGGER USER;
UPDATE "comprobante_items" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
ALTER TABLE "comprobante_items" ENABLE TRIGGER USER;
ALTER TABLE "comprobante_iva" DISABLE TRIGGER USER;
UPDATE "comprobante_iva" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
ALTER TABLE "comprobante_iva" ENABLE TRIGGER USER;

-- ─── 3. NOT NULL (salvo usuarios: SUPERADMIN futuro) ──────────────────────────

ALTER TABLE "clientes" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "materiales" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "maquinas" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "articulos" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "listas_precios" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "lista_precio_items" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "recetas" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "receta_componentes" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "ventas" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "venta_items" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "pagos" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "compras" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "compra_items" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "movimientos_stock" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "contactos_cobranza" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "presupuestos" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "presupuesto_items" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "sesiones" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "comprobantes" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "comprobante_items" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "comprobante_iva" ALTER COLUMN "negocioId" SET NOT NULL;

-- ─── 4. Claves foraneas ───────────────────────────────────────────────────────

ALTER TABLE "clientes" ADD CONSTRAINT "clientes_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "materiales" ADD CONSTRAINT "materiales_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "maquinas" ADD CONSTRAINT "maquinas_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "articulos" ADD CONSTRAINT "articulos_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "listas_precios" ADD CONSTRAINT "listas_precios_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lista_precio_items" ADD CONSTRAINT "lista_precio_items_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receta_componentes" ADD CONSTRAINT "receta_componentes_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compras" ADD CONSTRAINT "compras_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contactos_cobranza" ADD CONSTRAINT "contactos_cobranza_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comprobante_iva" ADD CONSTRAINT "comprobante_iva_negocioId_fkey" FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 5. Indices ───────────────────────────────────────────────────────────────

CREATE INDEX "clientes_negocioId_idx" ON "clientes"("negocioId");
CREATE INDEX "materiales_negocioId_idx" ON "materiales"("negocioId");
CREATE INDEX "maquinas_negocioId_idx" ON "maquinas"("negocioId");
CREATE INDEX "articulos_negocioId_idx" ON "articulos"("negocioId");
CREATE INDEX "listas_precios_negocioId_idx" ON "listas_precios"("negocioId");
CREATE INDEX "lista_precio_items_negocioId_idx" ON "lista_precio_items"("negocioId");
CREATE INDEX "recetas_negocioId_idx" ON "recetas"("negocioId");
CREATE INDEX "receta_componentes_negocioId_idx" ON "receta_componentes"("negocioId");
CREATE INDEX "ventas_negocioId_fecha_idx" ON "ventas"("negocioId", "fecha");
CREATE INDEX "ventas_negocioId_estado_idx" ON "ventas"("negocioId", "estado");
CREATE INDEX "venta_items_negocioId_idx" ON "venta_items"("negocioId");
CREATE INDEX "pagos_negocioId_fecha_idx" ON "pagos"("negocioId", "fecha");
CREATE INDEX "pagos_negocioId_ventaId_idx" ON "pagos"("negocioId", "ventaId");
CREATE INDEX "compras_negocioId_idx" ON "compras"("negocioId");
CREATE INDEX "compra_items_negocioId_idx" ON "compra_items"("negocioId");
CREATE INDEX "movimientos_stock_negocioId_materialId_creadoEn_idx" ON "movimientos_stock"("negocioId", "materialId", "creadoEn");
CREATE INDEX "contactos_cobranza_negocioId_idx" ON "contactos_cobranza"("negocioId");
CREATE INDEX "presupuestos_negocioId_idx" ON "presupuestos"("negocioId");
CREATE INDEX "presupuesto_items_negocioId_idx" ON "presupuesto_items"("negocioId");
CREATE INDEX "usuarios_negocioId_idx" ON "usuarios"("negocioId");
CREATE INDEX "sesiones_negocioId_idx" ON "sesiones"("negocioId");
CREATE INDEX "comprobantes_negocioId_fecha_idx" ON "comprobantes"("negocioId", "fecha");
CREATE INDEX "comprobantes_negocioId_estado_idx" ON "comprobantes"("negocioId", "estado");
CREATE INDEX "comprobante_items_negocioId_idx" ON "comprobante_items"("negocioId");
CREATE INDEX "comprobante_iva_negocioId_idx" ON "comprobante_iva"("negocioId");
