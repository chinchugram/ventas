-- Multi-tenant F1.2: unicos por negocio, `configuracion` con clave compuesta,
-- triggers de comprobantes con `negocioId` y "el hijo es del mismo negocio que el padre".
--
-- Antes de esta migracion varias restricciones eran globales y dos negocios se
-- habrian chocado (mismo numero de venta, mismo CUIT de cliente, misma serie
-- fiscal). Todo corre en la transaccion de la migracion.
--
-- Decisiones:
--   * Los nombres de los indices que maneja Prisma siguen su convencion
--     (`<tabla>_<col1>_<col2>_key`) para que `prisma migrate dev` no vea deriva.
--   * `clientes_cuit_unico` y los de comprobantes son parciales: Prisma no los
--     conoce, quedan solo en SQL (como hasta ahora).
--   * `usuarios.negocioId` es nullable (SUPERADMIN futuro) y en un indice unico
--     los NULL no chocan entre si: el indice parcial `usuarios_usuario_key`
--     mantiene unico el usuario de quienes no tienen negocio (conserva el nombre
--     viejo, que algunas pruebas esperan en el mensaje de error).
--   * "El hijo es del mismo negocio que el padre" va con TRIGGERS y no con FK
--     compuestas `(id, negocioId)`: una FK compuesta obliga a cambiar todas las
--     relaciones de Prisma (y todo el codigo que las usa). El trigger es generico
--     (`negocio_igual_al_padre`) y se instala por cada FK de una tabla de datos.
--     Para que el trigger no se pueda esquivar moviendo el padre de negocio,
--     `negocioId` queda inmutable (`negocio_inmutable`).
--   * Un usuario SIN negocio (SUPERADMIN) puede figurar como autor (`usuarioId`)
--     de filas de cualquier negocio; un usuario CON negocio, solo del suyo.

-- ─── 1. Unicos por negocio ────────────────────────────────────────────────────

DROP INDEX "ventas_anio_numero_key";
CREATE UNIQUE INDEX "ventas_negocioId_anio_numero_key" ON "ventas"("negocioId", "anio", "numero");

DROP INDEX "presupuestos_anio_numero_key";
CREATE UNIQUE INDEX "presupuestos_negocioId_anio_numero_key" ON "presupuestos"("negocioId", "anio", "numero");

DROP INDEX "clientes_cuit_unico";
CREATE UNIQUE INDEX "clientes_cuit_unico" ON "clientes"("negocioId", "cuit") WHERE "cuit" IS NOT NULL;

DROP INDEX "usuarios_usuario_key";
CREATE UNIQUE INDEX "usuarios_negocioId_usuario_key" ON "usuarios"("negocioId", "usuario");
CREATE UNIQUE INDEX "usuarios_usuario_key" ON "usuarios"("usuario") WHERE "negocioId" IS NULL;

DROP INDEX "listas_precios_nombre_key";
CREATE UNIQUE INDEX "listas_precios_negocioId_nombre_key" ON "listas_precios"("negocioId", "nombre");

-- Comprobantes: la serie fiscal es del negocio (cada uno con su CUIT y punto de venta).
DROP INDEX "comprobantes_numero_vigente_key";
CREATE UNIQUE INDEX "comprobantes_numero_vigente_key"
  ON "comprobantes"("negocioId", "ambiente", "puntoVenta", "tipo", "numero")
  WHERE "estado" IN ('PENDIENTE', 'EMITIDO');
DROP INDEX "comprobantes_un_pendiente_por_serie_key";
CREATE UNIQUE INDEX "comprobantes_un_pendiente_por_serie_key"
  ON "comprobantes"("negocioId", "ambiente", "puntoVenta", "tipo")
  WHERE "estado" = 'PENDIENTE';
-- comprobantes_factura_vigente_por_venta_key (ventaId) y
-- comprobantes_nc_vigente_por_factura_key (comprobanteAsociadoId) siguen igual:
-- los ids son UUID, no pueden chocar entre negocios.

-- ─── 2. Configuracion: clave primaria (negocioId, clave) ──────────────────────

ALTER TABLE "configuracion" ADD COLUMN "negocioId" UUID;
UPDATE "configuracion" SET "negocioId" = (SELECT "id" FROM "negocios" WHERE "slug" = 'hl-laser');
ALTER TABLE "configuracion" ALTER COLUMN "negocioId" SET NOT NULL;
ALTER TABLE "configuracion" DROP CONSTRAINT "configuracion_pkey";
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_pkey" PRIMARY KEY ("negocioId", "clave");
ALTER TABLE "configuracion" ADD CONSTRAINT "configuracion_negocioId_fkey"
  FOREIGN KEY ("negocioId") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── 3. Triggers de comprobantes: todo filtra por negocio ─────────────────────
-- Revision de las 4 funciones `comprobantes_validar_*` + `comprobantes_verificar_importes`
-- + `ventas_validar_anulacion_facturada`:
--   * validar_alta: BUSCABA venta y factura asociada por id; ahora exige ademas que
--     sean del mismo negocio que el comprobante. CAMBIA.
--   * validar_cambio: compara OLD y NEW completos (incluido `negocioId`); no busca
--     nada en otras tablas. SIN CAMBIO.
--   * validar_baja: solo mira el ambiente de la fila. SIN CAMBIO.
--   * validar_detalle: busca el comprobante padre por id; ahora exige mismo negocio. CAMBIA.
--   * verificar_importes: suma lineas y alicuotas del comprobante; ahora solo cuenta
--     las del mismo negocio (una linea ajena no puede "cerrar" los importes). CAMBIA.
--   * ventas_validar_anulacion_facturada: busca facturas y NC de la venta; ahora
--     solo del mismo negocio. CAMBIA.

CREATE OR REPLACE FUNCTION "comprobantes_validar_alta"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  estado_venta TEXT;
  negocio_venta UUID;
  asociado RECORD;
BEGIN
  IF NEW."estado" <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'Un comprobante se crea PENDIENTE (el numero se guarda antes de pedir el CAE)'
      USING ERRCODE = 'check_violation';
  END IF;
  -- La venta (si no existe, la FK lo rechaza despues) tiene que ser del mismo negocio.
  SELECT v."estado"::text, v."negocioId" INTO estado_venta, negocio_venta FROM "ventas" v WHERE v."id" = NEW."ventaId";
  IF FOUND AND NEW."negocioId" IS NOT NULL AND negocio_venta IS DISTINCT FROM NEW."negocioId" THEN
    RAISE EXCEPTION 'El comprobante y su venta tienen que ser del mismo negocio' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."tipo" IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C') THEN
    IF estado_venta = 'ANULADA' THEN
      RAISE EXCEPTION 'No se factura una venta anulada' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT c."tipo"::text AS tipo, c."estado"::text AS estado, c."ventaId" AS venta, c."ambiente"::text AS ambiente,
           c."negocioId" AS negocio
      INTO asociado FROM "comprobantes" c WHERE c."id" = NEW."comprobanteAsociadoId";
    IF NOT FOUND
      OR asociado.tipo NOT IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C')
      OR asociado.estado <> 'EMITIDO'
      OR asociado.venta <> NEW."ventaId"
      OR asociado.negocio IS DISTINCT FROM NEW."negocioId"
      OR asociado.ambiente <> NEW."ambiente"::text
      OR right(asociado.tipo, 1) <> right(NEW."tipo"::text, 1) THEN
      RAISE EXCEPTION 'La nota de credito tiene que anular una factura EMITIDA de la misma venta, ambiente y letra (y negocio)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "comprobantes_validar_detalle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  estado_padre TEXT;
  negocio_padre UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'El detalle de un comprobante no se modifica' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT c."estado"::text, c."negocioId" INTO estado_padre, negocio_padre FROM "comprobantes" c WHERE c."id" = NEW."comprobanteId";
    IF estado_padre IS DISTINCT FROM 'PENDIENTE' THEN
      RAISE EXCEPTION 'El detalle se carga solo mientras el comprobante esta PENDIENTE' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."negocioId" IS NOT NULL AND negocio_padre IS DISTINCT FROM NEW."negocioId" THEN
      RAISE EXCEPTION 'El detalle y su comprobante tienen que ser del mismo negocio' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE: si viene en cascada, el comprobante ya no esta.
  IF EXISTS (SELECT 1 FROM "comprobantes" c WHERE c."id" = OLD."comprobanteId") THEN
    RAISE EXCEPTION 'El detalle de un comprobante no se borra' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION "comprobantes_verificar_importes"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  id_comprobante UUID;
  c RECORD;
  lineas RECORD;
  alicuotas RECORD;
BEGIN
  IF TG_TABLE_NAME = 'comprobantes' THEN
    id_comprobante := NEW."id";
  ELSE
    id_comprobante := NEW."comprobanteId";
  END IF;
  SELECT * INTO c FROM "comprobantes" WHERE "id" = id_comprobante;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*) AS n, coalesce(sum("subtotalNeto"), 0) AS neto, coalesce(sum("subtotalIva"), 0) AS iva,
         coalesce(sum("subtotalBruto"), 0) AS bruto
    INTO lineas FROM "comprobante_items" WHERE "comprobanteId" = id_comprobante AND "negocioId" = c."negocioId";
  SELECT count(*) AS n, coalesce(sum("baseImponible"), 0) AS base, coalesce(sum("importe"), 0) AS importe
    INTO alicuotas FROM "comprobante_iva" WHERE "comprobanteId" = id_comprobante AND "negocioId" = c."negocioId";

  IF lineas.n = 0 OR lineas.bruto <> c."importeTotal" THEN
    RAISE EXCEPTION 'Comprobante %: las lineas no suman el total', id_comprobante USING ERRCODE = 'check_violation';
  END IF;
  IF c."tipo" IN ('FACTURA_C', 'NOTA_CREDITO_C') THEN
    IF alicuotas.n > 0 THEN
      RAISE EXCEPTION 'Comprobante %: la C no discrimina IVA', id_comprobante USING ERRCODE = 'check_violation';
    END IF;
  ELSIF alicuotas.n = 0
     OR alicuotas.base <> c."importeNeto" OR alicuotas.importe <> c."importeIva"
     OR lineas.neto <> c."importeNeto" OR lineas.iva <> c."importeIva" THEN
    RAISE EXCEPTION 'Comprobante %: el neto y el IVA no cierran con las alicuotas y las lineas', id_comprobante
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "ventas_validar_anulacion_facturada"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."estado" = 'ANULADA' AND OLD."estado" <> 'ANULADA' AND EXISTS (
    SELECT 1 FROM "comprobantes" f
    WHERE f."ventaId" = NEW."id"
      AND f."negocioId" = NEW."negocioId"
      AND f."tipo" IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C')
      AND f."estado" IN ('PENDIENTE', 'EMITIDO')
      AND NOT EXISTS (
        SELECT 1 FROM "comprobantes" nc
        WHERE nc."comprobanteAsociadoId" = f."id" AND nc."negocioId" = f."negocioId" AND nc."estado" = 'EMITIDO'
      )
  ) THEN
    RAISE EXCEPTION 'La venta tiene una factura vigente: para anularla primero hay que emitir la nota de credito'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. El hijo es del mismo negocio que el padre ─────────────────────────────

-- Uso: CREATE TRIGGER ... EXECUTE FUNCTION negocio_igual_al_padre('<tabla padre>', '<columna FK>')
CREATE FUNCTION "negocio_igual_al_padre"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tabla_padre TEXT := TG_ARGV[0];
  columna TEXT := TG_ARGV[1];
  id_padre UUID;
  existe BOOLEAN;
  negocio_padre UUID;
BEGIN
  id_padre := (to_jsonb(NEW) ->> columna)::uuid;
  -- Sin padre, o sin negocio (lo rechaza el NOT NULL con su mensaje de siempre).
  IF id_padre IS NULL OR NEW."negocioId" IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT true, "negocioId" FROM %I WHERE "id" = $1', tabla_padre)
    INTO existe, negocio_padre USING id_padre;
  -- Padre inexistente: lo rechaza la FK.
  IF existe IS NULL THEN
    RETURN NEW;
  END IF;
  -- Un usuario sin negocio (SUPERADMIN) puede figurar como autor en cualquier negocio.
  IF tabla_padre = 'usuarios' AND negocio_padre IS NULL THEN
    RETURN NEW;
  END IF;
  IF negocio_padre IS DISTINCT FROM NEW."negocioId" THEN
    RAISE EXCEPTION '%.% apunta a una fila de % de otro negocio', TG_TABLE_NAME, columna, tabla_padre
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- `negocioId` no se cambia nunca: si no, mover el padre dejaria hijos de otro negocio.
CREATE FUNCTION "negocio_inmutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: el negocio de una fila no se cambia', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;

DO $$
DECLARE
  t TEXT;
  f RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clientes', 'materiales', 'maquinas', 'articulos', 'listas_precios', 'lista_precio_items',
    'recetas', 'receta_componentes', 'ventas', 'venta_items', 'pagos', 'compras', 'compra_items',
    'movimientos_stock', 'contactos_cobranza', 'presupuestos', 'presupuesto_items', 'sesiones',
    'comprobantes', 'comprobante_items', 'comprobante_iva', 'configuracion'
  ] LOOP
    -- WHEN: el trigger solo se evalua si el negocio cambia de verdad (Prisma reescribe todo el UPDATE).
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF "negocioId" ON %I FOR EACH ROW WHEN (OLD."negocioId" IS DISTINCT FROM NEW."negocioId") EXECUTE FUNCTION "negocio_inmutable"()',
      t || '_negocio_inmutable', t);
  END LOOP;

  -- (hijo, columna FK, padre). Las FK de comprobantes a la venta y a la factura asociada,
  -- y las de comprobante_items/iva al comprobante, las cubren las funciones de la seccion 3.
  FOR f IN SELECT * FROM (VALUES
    ('clientes', 'listaPrecioId', 'listas_precios'),
    ('listas_precios', 'usuarioId', 'usuarios'),
    ('lista_precio_items', 'listaPrecioId', 'listas_precios'),
    ('lista_precio_items', 'articuloId', 'articulos'),
    ('recetas', 'articuloId', 'articulos'),
    ('receta_componentes', 'recetaId', 'recetas'),
    ('receta_componentes', 'materialId', 'materiales'),
    ('receta_componentes', 'maquinaId', 'maquinas'),
    ('ventas', 'clienteId', 'clientes'),
    ('ventas', 'usuarioId', 'usuarios'),
    ('venta_items', 'ventaId', 'ventas'),
    ('venta_items', 'articuloId', 'articulos'),
    ('pagos', 'ventaId', 'ventas'),
    ('pagos', 'clienteId', 'clientes'),
    ('pagos', 'usuarioId', 'usuarios'),
    ('compras', 'usuarioId', 'usuarios'),
    ('compra_items', 'compraId', 'compras'),
    ('compra_items', 'materialId', 'materiales'),
    ('movimientos_stock', 'materialId', 'materiales'),
    ('movimientos_stock', 'compraId', 'compras'),
    ('movimientos_stock', 'ventaId', 'ventas'),
    ('movimientos_stock', 'usuarioId', 'usuarios'),
    ('contactos_cobranza', 'clienteId', 'clientes'),
    ('contactos_cobranza', 'usuarioId', 'usuarios'),
    ('presupuestos', 'clienteId', 'clientes'),
    ('presupuestos', 'usuarioId', 'usuarios'),
    ('presupuestos', 'ventaId', 'ventas'),
    ('presupuestos', 'duplicadoDeId', 'presupuestos'),
    ('presupuesto_items', 'presupuestoId', 'presupuestos'),
    ('presupuesto_items', 'articuloId', 'articulos'),
    ('sesiones', 'usuarioId', 'usuarios'),
    ('comprobantes', 'usuarioId', 'usuarios')
  ) AS x(hijo, columna, padre) LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "negocioId", %I ON %I FOR EACH ROW EXECUTE FUNCTION "negocio_igual_al_padre"(%L, %L)',
      f.hijo || '_' || f.columna || '_mismo_negocio', f.columna, f.hijo, f.padre, f.columna);
  END LOOP;
END $$;
