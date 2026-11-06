-- Ola 5 (5.1): facturacion electronica, sin conexion real con ARCA.
-- Unica migracion de la ola. Agrega la condicion frente al IVA y el DNI del
-- cliente, y los comprobantes (factura / nota de credito) como FOTO de la venta:
-- emisor, receptor, lineas e importes por alicuota se copian al emitir.
--
-- La base es la ultima linea de defensa (ver docs/fiscal-5.1-decisiones.md):
--   * CHECK: numero > 0, punto de venta 1-99999, codigo ARCA coherente con el
--     tipo, importes >= 0, total = neto + IVA, la C no discrimina IVA, EMITIDO
--     <=> CAE de 14 digitos y vencimiento, nota de credito <=> comprobante
--     asociado, documento del receptor coherente con su tipo ARCA.
--   * Indices unicos parciales: numero vigente por (ambiente, punto, tipo), un
--     solo PENDIENTE por (ambiente, punto, tipo), una sola factura vigente por
--     venta, una sola nota de credito vigente por factura.
--   * Triggers: un comprobante nace PENDIENTE; de un PENDIENTE solo cambia el
--     resultado (estado, CAE, vencimiento, observaciones); EMITIDO y RECHAZADO
--     son inmutables; las lineas y alicuotas no se tocan; uno real (no SIMULADO)
--     no se borra; los importes cierran con sus lineas y alicuotas (diferido, al
--     confirmar); una venta con factura vigente no se anula sin nota de credito.
--
-- "Vigente" = PENDIENTE o EMITIDO. Un RECHAZADO queda como registro del intento
-- y NO ocupa el numero: el siguiente intento reusa ese numero, que es lo que
-- exige ARCA (el proximo a autorizar es siempre el ultimo autorizado + 1).

-- CreateEnum
CREATE TYPE "CondicionIva" AS ENUM ('CONSUMIDOR_FINAL', 'RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');

-- CreateEnum
CREATE TYPE "TipoComprobante" AS ENUM ('FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C');

-- CreateEnum
CREATE TYPE "AmbienteFiscal" AS ENUM ('SIMULADO', 'HOMOLOGACION', 'PRODUCCION');

-- CreateEnum
CREATE TYPE "EstadoComprobante" AS ENUM ('PENDIENTE', 'EMITIDO', 'RECHAZADO');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "condicionIva" "CondicionIva" NOT NULL DEFAULT 'CONSUMIDOR_FINAL',
ADD COLUMN     "dni" TEXT;

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" UUID NOT NULL,
    "ambiente" "AmbienteFiscal" NOT NULL,
    "tipo" "TipoComprobante" NOT NULL,
    "codigoArca" INTEGER NOT NULL,
    "puntoVenta" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "EstadoComprobante" NOT NULL DEFAULT 'PENDIENTE',
    "emisorRazonSocial" TEXT NOT NULL,
    "emisorCuit" TEXT NOT NULL,
    "emisorCondicionIva" "CondicionIva" NOT NULL,
    "emisorDomicilio" TEXT NOT NULL,
    "emisorInicioActividades" DATE NOT NULL,
    "emisorIibb" TEXT,
    "receptorNombre" TEXT NOT NULL,
    "receptorDocTipo" INTEGER NOT NULL,
    "receptorDocNro" TEXT NOT NULL,
    "receptorCondicionIva" "CondicionIva" NOT NULL,
    "receptorDomicilio" TEXT,
    "importeNeto" DECIMAL(14,2) NOT NULL,
    "importeIva" DECIMAL(14,2) NOT NULL,
    "importeTotal" DECIMAL(14,2) NOT NULL,
    "cae" TEXT,
    "caeVencimiento" DATE,
    "observaciones" TEXT,
    "comprobanteAsociadoId" UUID,
    "ventaId" UUID NOT NULL,
    "usuarioId" UUID,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobante_items" (
    "id" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precioUnitario" DECIMAL(14,4) NOT NULL,
    "ivaPct" DECIMAL(5,2) NOT NULL,
    "subtotalNeto" DECIMAL(14,2) NOT NULL,
    "subtotalIva" DECIMAL(14,2) NOT NULL,
    "subtotalBruto" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "comprobante_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobante_iva" (
    "id" UUID NOT NULL,
    "comprobanteId" UUID NOT NULL,
    "alicuotaPct" DECIMAL(5,2) NOT NULL,
    "codigoArca" INTEGER NOT NULL,
    "baseImponible" DECIMAL(14,2) NOT NULL,
    "importe" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "comprobante_iva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comprobantes_ventaId_idx" ON "comprobantes"("ventaId");

-- CreateIndex
CREATE INDEX "comprobantes_comprobanteAsociadoId_idx" ON "comprobantes"("comprobanteAsociadoId");

-- CreateIndex
CREATE INDEX "comprobantes_usuarioId_idx" ON "comprobantes"("usuarioId");

-- CreateIndex
CREATE INDEX "comprobantes_fecha_idx" ON "comprobantes"("fecha");

-- CreateIndex
CREATE INDEX "comprobantes_estado_idx" ON "comprobantes"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_items_comprobanteId_orden_key" ON "comprobante_items"("comprobanteId", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "comprobante_iva_comprobanteId_alicuotaPct_key" ON "comprobante_iva"("comprobanteId", "alicuotaPct");

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_comprobanteAsociadoId_fkey" FOREIGN KEY ("comprobanteAsociadoId") REFERENCES "comprobantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "comprobantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobante_iva" ADD CONSTRAINT "comprobante_iva_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "comprobantes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Cliente ──────────────────────────────────────────────────────────────────

-- DNI normalizado: solo digitos, 7 u 8.
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_dni_check" CHECK ("dni" IS NULL OR "dni" ~ '^[0-9]{7,8}$');

-- ─── Comprobante: CHECK ───────────────────────────────────────────────────────

ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_numero_check" CHECK ("numero" > 0);
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_punto_venta_check" CHECK ("puntoVenta" BETWEEN 1 AND 99999);
-- Codigos ARCA: factura A 1, B 6, C 11; nota de credito A 3, B 8, C 13.
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_codigo_arca_check" CHECK (
  ("tipo" = 'FACTURA_A' AND "codigoArca" = 1) OR
  ("tipo" = 'FACTURA_B' AND "codigoArca" = 6) OR
  ("tipo" = 'FACTURA_C' AND "codigoArca" = 11) OR
  ("tipo" = 'NOTA_CREDITO_A' AND "codigoArca" = 3) OR
  ("tipo" = 'NOTA_CREDITO_B' AND "codigoArca" = 8) OR
  ("tipo" = 'NOTA_CREDITO_C' AND "codigoArca" = 13)
);
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_importes_check"
  CHECK ("importeNeto" >= 0 AND "importeIva" >= 0 AND "importeTotal" >= 0);
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_total_check"
  CHECK ("importeTotal" = "importeNeto" + "importeIva");
-- La C (emisor monotributista) no discrimina IVA.
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_c_sin_iva_check"
  CHECK ("tipo" NOT IN ('FACTURA_C', 'NOTA_CREDITO_C') OR "importeIva" = 0);
-- EMITIDO <=> CAE (14 digitos) y vencimiento. Ni un PENDIENTE ni un RECHAZADO tienen CAE.
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_cae_check"
  CHECK (("estado" = 'EMITIDO') = ("cae" IS NOT NULL) AND ("cae" IS NULL OR "cae" ~ '^[0-9]{14}$'));
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_cae_vencimiento_check"
  CHECK (("estado" = 'EMITIDO') = ("caeVencimiento" IS NOT NULL));
-- Un rechazo siempre dice por que.
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_rechazo_motivo_check"
  CHECK ("estado" <> 'RECHAZADO' OR ("observaciones" IS NOT NULL AND btrim("observaciones") <> ''));
-- Nota de credito <=> comprobante asociado (y nunca a si misma).
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_asociado_check" CHECK (
  ("tipo" IN ('NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C')) = ("comprobanteAsociadoId" IS NOT NULL)
  AND "comprobanteAsociadoId" IS DISTINCT FROM "id"
);
-- Foto del emisor: CUIT normalizado; el RI emite A/B, el monotributista emite C.
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_emisor_check" CHECK (
  "emisorCuit" ~ '^[0-9]{11}$'
  AND btrim("emisorRazonSocial") <> ''
  AND btrim("emisorDomicilio") <> ''
  AND "emisorCondicionIva" IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO')
  AND ("tipo" IN ('FACTURA_C', 'NOTA_CREDITO_C')) = ("emisorCondicionIva" = 'MONOTRIBUTO')
);
-- Foto del receptor: 80 CUIT (11 digitos), 96 DNI (7-8), 99 sin identificar ("0").
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_receptor_check" CHECK (
  btrim("receptorNombre") <> ''
  AND (
    ("receptorDocTipo" = 80 AND "receptorDocNro" ~ '^[0-9]{11}$') OR
    ("receptorDocTipo" = 96 AND "receptorDocNro" ~ '^[0-9]{7,8}$') OR
    ("receptorDocTipo" = 99 AND "receptorDocNro" = '0')
  )
);
-- La A es solo para un responsable inscripto identificado con CUIT.
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_receptor_a_check" CHECK (
  "tipo" NOT IN ('FACTURA_A', 'NOTA_CREDITO_A')
  OR ("receptorCondicionIva" = 'RESPONSABLE_INSCRIPTO' AND "receptorDocTipo" = 80)
);

-- ─── Lineas y alicuotas: CHECK ────────────────────────────────────────────────

ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_orden_check" CHECK ("orden" > 0);
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_cantidad_check" CHECK ("cantidad" > 0);
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_importes_check" CHECK (
  "precioUnitario" >= 0 AND "subtotalNeto" >= 0 AND "subtotalIva" >= 0 AND "subtotalBruto" >= 0
  AND "subtotalBruto" = "subtotalNeto" + "subtotalIva"
);
ALTER TABLE "comprobante_items" ADD CONSTRAINT "comprobante_items_iva_check" CHECK ("ivaPct" >= 0 AND "ivaPct" <= 100);

ALTER TABLE "comprobante_iva" ADD CONSTRAINT "comprobante_iva_importes_check" CHECK ("baseImponible" >= 0 AND "importe" >= 0);
-- Alicuotas ARCA: 0% 3, 2,5% 9, 5% 8, 10,5% 4, 21% 5, 27% 6.
ALTER TABLE "comprobante_iva" ADD CONSTRAINT "comprobante_iva_alicuota_check" CHECK (
  ("alicuotaPct" = 0 AND "codigoArca" = 3) OR
  ("alicuotaPct" = 2.5 AND "codigoArca" = 9) OR
  ("alicuotaPct" = 5 AND "codigoArca" = 8) OR
  ("alicuotaPct" = 10.5 AND "codigoArca" = 4) OR
  ("alicuotaPct" = 21 AND "codigoArca" = 5) OR
  ("alicuotaPct" = 27 AND "codigoArca" = 6)
);

-- ─── Indices unicos parciales ─────────────────────────────────────────────────

-- Un numero vigente por (ambiente, punto de venta, tipo). Los RECHAZADO no lo ocupan.
CREATE UNIQUE INDEX "comprobantes_numero_vigente_key" ON "comprobantes"("ambiente", "puntoVenta", "tipo", "numero")
  WHERE "estado" IN ('PENDIENTE', 'EMITIDO');
-- Un solo PENDIENTE por (ambiente, punto de venta, tipo): mientras no se sabe si
-- el anterior se autorizo, no se sabe cual es el proximo numero.
CREATE UNIQUE INDEX "comprobantes_un_pendiente_por_serie_key" ON "comprobantes"("ambiente", "puntoVenta", "tipo")
  WHERE "estado" = 'PENDIENTE';
-- Una sola factura vigente por venta.
CREATE UNIQUE INDEX "comprobantes_factura_vigente_por_venta_key" ON "comprobantes"("ventaId")
  WHERE "estado" IN ('PENDIENTE', 'EMITIDO') AND "tipo" IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C');
-- Una sola nota de credito vigente por factura (la NC es total).
CREATE UNIQUE INDEX "comprobantes_nc_vigente_por_factura_key" ON "comprobantes"("comprobanteAsociadoId")
  WHERE "estado" IN ('PENDIENTE', 'EMITIDO') AND "tipo" IN ('NOTA_CREDITO_A', 'NOTA_CREDITO_B', 'NOTA_CREDITO_C');

-- ─── Triggers ─────────────────────────────────────────────────────────────────

-- Alta: nace PENDIENTE (el numero se guarda antes de pedir el CAE). Una factura
-- no se hace sobre una venta anulada; una nota de credito anula una factura
-- EMITIDA de la misma venta, ambiente y letra.
CREATE FUNCTION "comprobantes_validar_alta"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  estado_venta TEXT;
  asociado RECORD;
BEGIN
  IF NEW."estado" <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'Un comprobante se crea PENDIENTE (el numero se guarda antes de pedir el CAE)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."tipo" IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C') THEN
    SELECT v."estado"::text INTO estado_venta FROM "ventas" v WHERE v."id" = NEW."ventaId";
    IF estado_venta = 'ANULADA' THEN
      RAISE EXCEPTION 'No se factura una venta anulada' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT c."tipo"::text AS tipo, c."estado"::text AS estado, c."ventaId" AS venta, c."ambiente"::text AS ambiente
      INTO asociado FROM "comprobantes" c WHERE c."id" = NEW."comprobanteAsociadoId";
    IF NOT FOUND
      OR asociado.tipo NOT IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C')
      OR asociado.estado <> 'EMITIDO'
      OR asociado.venta <> NEW."ventaId"
      OR asociado.ambiente <> NEW."ambiente"::text
      OR right(asociado.tipo, 1) <> right(NEW."tipo"::text, 1) THEN
      RAISE EXCEPTION 'La nota de credito tiene que anular una factura EMITIDA de la misma venta, ambiente y letra'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "comprobantes_validar_alta" BEFORE INSERT ON "comprobantes"
  FOR EACH ROW EXECUTE FUNCTION "comprobantes_validar_alta"();

-- Cambios: de un PENDIENTE solo se registra el resultado del emisor (estado,
-- CAE, vencimiento, observaciones). EMITIDO y RECHAZADO no cambian mas.
-- `actualizadoEn` es lo unico inocuo (Prisma lo toca en cada update).
CREATE FUNCTION "comprobantes_validar_cambio"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."estado" IN ('EMITIDO', 'RECHAZADO') THEN
    IF (to_jsonb(NEW) - 'actualizadoEn') IS DISTINCT FROM (to_jsonb(OLD) - 'actualizadoEn') THEN
      RAISE EXCEPTION 'Un comprobante % no se modifica', OLD."estado" USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (to_jsonb(NEW) - ARRAY['estado', 'cae', 'caeVencimiento', 'observaciones', 'actualizadoEn'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['estado', 'cae', 'caeVencimiento', 'observaciones', 'actualizadoEn']) THEN
    RAISE EXCEPTION 'De un comprobante PENDIENTE solo se registra el resultado del emisor'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "comprobantes_validar_cambio" BEFORE UPDATE ON "comprobantes"
  FOR EACH ROW EXECUTE FUNCTION "comprobantes_validar_cambio"();

-- Baja: solo los SIMULADO (datos de desarrollo y pruebas). Uno de homologacion
-- o produccion no se borra nunca.
CREATE FUNCTION "comprobantes_validar_baja"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."ambiente" <> 'SIMULADO' THEN
    RAISE EXCEPTION 'Un comprobante de % no se borra', OLD."ambiente" USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "comprobantes_validar_baja" BEFORE DELETE ON "comprobantes"
  FOR EACH ROW EXECUTE FUNCTION "comprobantes_validar_baja"();

-- Lineas y alicuotas: se cargan solo mientras el comprobante esta PENDIENTE (en
-- la misma operacion que lo crea), no se modifican y no se borran sueltas (solo
-- en cascada, junto con un comprobante SIMULADO).
CREATE FUNCTION "comprobantes_validar_detalle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  estado_padre TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'El detalle de un comprobante no se modifica' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT c."estado"::text INTO estado_padre FROM "comprobantes" c WHERE c."id" = NEW."comprobanteId";
    IF estado_padre IS DISTINCT FROM 'PENDIENTE' THEN
      RAISE EXCEPTION 'El detalle se carga solo mientras el comprobante esta PENDIENTE' USING ERRCODE = 'check_violation';
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

CREATE TRIGGER "comprobante_items_validar_detalle" BEFORE INSERT OR UPDATE OR DELETE ON "comprobante_items"
  FOR EACH ROW EXECUTE FUNCTION "comprobantes_validar_detalle"();
CREATE TRIGGER "comprobante_iva_validar_detalle" BEFORE INSERT OR UPDATE OR DELETE ON "comprobante_iva"
  FOR EACH ROW EXECUTE FUNCTION "comprobantes_validar_detalle"();

-- Los importes cierran. Diferido: se verifica al confirmar la transaccion, cuando
-- ya estan la cabecera, las lineas y las alicuotas.
--   * Las lineas suman el total.
--   * A y B: al menos una alicuota; bases = neto e importes = IVA, y los netos e
--     IVA de las lineas tambien.
--   * C: sin alicuotas (no discrimina IVA).
CREATE FUNCTION "comprobantes_verificar_importes"() RETURNS trigger LANGUAGE plpgsql AS $$
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
    INTO lineas FROM "comprobante_items" WHERE "comprobanteId" = id_comprobante;
  SELECT count(*) AS n, coalesce(sum("baseImponible"), 0) AS base, coalesce(sum("importe"), 0) AS importe
    INTO alicuotas FROM "comprobante_iva" WHERE "comprobanteId" = id_comprobante;

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

CREATE CONSTRAINT TRIGGER "comprobantes_verificar_importes" AFTER INSERT ON "comprobantes"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "comprobantes_verificar_importes"();
CREATE CONSTRAINT TRIGGER "comprobante_items_verificar_importes" AFTER INSERT ON "comprobante_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "comprobantes_verificar_importes"();
CREATE CONSTRAINT TRIGGER "comprobante_iva_verificar_importes" AFTER INSERT ON "comprobante_iva"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "comprobantes_verificar_importes"();

-- ─── Venta ────────────────────────────────────────────────────────────────────

-- Una venta con factura vigente no se anula hasta que una nota de credito
-- EMITIDA la anule (una factura PENDIENTE tampoco: todavia puede autorizarse).
CREATE FUNCTION "ventas_validar_anulacion_facturada"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."estado" = 'ANULADA' AND OLD."estado" <> 'ANULADA' AND EXISTS (
    SELECT 1 FROM "comprobantes" f
    WHERE f."ventaId" = NEW."id"
      AND f."tipo" IN ('FACTURA_A', 'FACTURA_B', 'FACTURA_C')
      AND f."estado" IN ('PENDIENTE', 'EMITIDO')
      AND NOT EXISTS (
        SELECT 1 FROM "comprobantes" nc
        WHERE nc."comprobanteAsociadoId" = f."id" AND nc."estado" = 'EMITIDO'
      )
  ) THEN
    RAISE EXCEPTION 'La venta tiene una factura vigente: para anularla primero hay que emitir la nota de credito'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ventas_validar_anulacion_facturada" BEFORE UPDATE OF "estado" ON "ventas"
  FOR EACH ROW EXECUTE FUNCTION "ventas_validar_anulacion_facturada"();
