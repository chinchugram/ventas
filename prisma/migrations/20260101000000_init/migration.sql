-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UnidadMedida" AS ENUM ('M2', 'M', 'KG', 'L', 'U', 'HOJA', 'ROLLO');

-- CreateEnum
CREATE TYPE "TipoComponente" AS ENUM ('MATERIAL', 'MAQUINA', 'MANO_OBRA');

-- CreateEnum
CREATE TYPE "EstadoVenta" AS ENUM ('PENDIENTE', 'ENTREGADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO');

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "direccion" TEXT,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materiales" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" "UnidadMedida" NOT NULL,
    "stockActual" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stockMinimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "costoUnitario" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "precioVenta" DECIMAL(14,4),
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "materiales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maquinas" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "costoHora" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maquinas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articulos" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precioVenta" DECIMAL(14,4) NOT NULL,
    "ivaPct" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "esServicio" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "articulos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recetas" (
    "id" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "notas" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receta_componentes" (
    "id" UUID NOT NULL,
    "recetaId" UUID NOT NULL,
    "tipo" "TipoComponente" NOT NULL,
    "materialId" UUID,
    "maquinaId" UUID,
    "cantidad" DECIMAL(14,4) NOT NULL,
    "costoUnitarioOverride" DECIMAL(14,4),
    "notas" TEXT,

    CONSTRAINT "receta_componentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventas" (
    "id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "clienteId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "EstadoVenta" NOT NULL DEFAULT 'PENDIENTE',
    "observaciones" TEXT,
    "totalNeto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIVA" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalBruto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "costoTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ventas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venta_items" (
    "id" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precioUnitario" DECIMAL(14,4) NOT NULL,
    "ivaPct" DECIMAL(5,2) NOT NULL,
    "subtotalNeto" DECIMAL(14,2) NOT NULL,
    "subtotalIVA" DECIMAL(14,2) NOT NULL,
    "subtotalBruto" DECIMAL(14,2) NOT NULL,
    "costoUnitarioSnapshot" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "costoTotalSnapshot" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "venta_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "metodo" "MetodoPago" NOT NULL DEFAULT 'EFECTIVO',
    "notas" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,

    CONSTRAINT "configuracion_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE INDEX "clientes_activo_idx" ON "clientes"("activo");

-- CreateIndex
CREATE INDEX "clientes_nombre_idx" ON "clientes"("nombre");

-- CreateIndex
CREATE INDEX "materiales_activo_idx" ON "materiales"("activo");

-- CreateIndex
CREATE INDEX "materiales_nombre_idx" ON "materiales"("nombre");

-- CreateIndex
CREATE INDEX "maquinas_activo_idx" ON "maquinas"("activo");

-- CreateIndex
CREATE INDEX "articulos_activo_idx" ON "articulos"("activo");

-- CreateIndex
CREATE INDEX "articulos_nombre_idx" ON "articulos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "recetas_articuloId_key" ON "recetas"("articuloId");

-- CreateIndex
CREATE INDEX "receta_componentes_recetaId_idx" ON "receta_componentes"("recetaId");

-- CreateIndex
CREATE INDEX "receta_componentes_materialId_idx" ON "receta_componentes"("materialId");

-- CreateIndex
CREATE INDEX "receta_componentes_maquinaId_idx" ON "receta_componentes"("maquinaId");

-- CreateIndex
CREATE INDEX "ventas_fecha_idx" ON "ventas"("fecha");

-- CreateIndex
CREATE INDEX "ventas_clienteId_idx" ON "ventas"("clienteId");

-- CreateIndex
CREATE INDEX "ventas_estado_idx" ON "ventas"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "ventas_anio_numero_key" ON "ventas"("anio", "numero");

-- CreateIndex
CREATE INDEX "venta_items_ventaId_idx" ON "venta_items"("ventaId");

-- CreateIndex
CREATE INDEX "venta_items_articuloId_idx" ON "venta_items"("articuloId");

-- CreateIndex
CREATE INDEX "pagos_ventaId_idx" ON "pagos"("ventaId");

-- CreateIndex
CREATE INDEX "pagos_clienteId_idx" ON "pagos"("clienteId");

-- CreateIndex
CREATE INDEX "pagos_fecha_idx" ON "pagos"("fecha");

-- AddForeignKey
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "articulos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_componentes" ADD CONSTRAINT "receta_componentes_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_componentes" ADD CONSTRAINT "receta_componentes_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_componentes" ADD CONSTRAINT "receta_componentes_maquinaId_fkey" FOREIGN KEY ("maquinaId") REFERENCES "maquinas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "articulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Integridad que Prisma no puede expresar. Esto es la REAL ultima linea de
-- defensa: si un bug de la app intenta escribir algo incoherente, la base lo
-- rechaza. Prisma va a "adoptar" estas restricciones como el estado actual del
-- schema y no las va a volver a generar.
-- ============================================================================

-- Una linea de receta debe apuntar al recurso que corresponde a su tipo:
--   MATERIAL   -> materialId obligatorio, maquinaId ausente
--   MAQUINA    -> maquinaId obligatorio,  materialId ausente
--   MANO_OBRA  -> ninguno de los dos (el costo/hora sale de configuracion)
ALTER TABLE "receta_componentes" ADD CONSTRAINT "receta_componentes_tipo_coherente_check"
  CHECK (
    (tipo = 'MATERIAL'  AND "materialId" IS NOT NULL     AND "maquinaId" IS NULL) OR
    (tipo = 'MAQUINA'   AND "materialId" IS NULL         AND "maquinaId" IS NOT NULL) OR
    (tipo = 'MANO_OBRA' AND "materialId" IS NULL         AND "maquinaId" IS NULL)
  );

-- No se admiten cantidades cero o negativas: un costo siempre es > 0.
ALTER TABLE "receta_componentes" ADD CONSTRAINT "receta_componentes_cantidad_positiva_check"
  CHECK (cantidad > 0);

ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_cantidad_positiva_check"
  CHECK (cantidad > 0);

-- El override de costo, si existe, no puede ser negativo.
ALTER TABLE "receta_componentes" ADD CONSTRAINT "receta_componentes_override_no_negativo_check"
  CHECK ("costoUnitarioOverride" IS NULL OR "costoUnitarioOverride" >= 0);

-- Un pago siempre importa dinero positivo. El saldo de una venta NUNCA se
-- guarda: se calcula como totalBruto - SUM(pagos).
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_monto_positivo_check"
  CHECK (monto > 0);

-- Stock y precios no negativos.
ALTER TABLE "materiales" ADD CONSTRAINT "materiales_stock_no_negativo_check"
  CHECK ("stockActual" >= 0 AND "stockMinimo" >= 0);

ALTER TABLE "materiales" ADD CONSTRAINT "materiales_costos_no_negativos_check"
  CHECK ("costoUnitario" >= 0 AND ("precioVenta" IS NULL OR "precioVenta" >= 0));

ALTER TABLE "maquinas" ADD CONSTRAINT "maquinas_costo_hora_no_negativo_check"
  CHECK ("costoHora" >= 0);

ALTER TABLE "articulos" ADD CONSTRAINT "articulos_precio_no_negativo_check"
  CHECK ("precioVenta" >= 0 AND "ivaPct" >= 0);

ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_precios_no_negativos_check"
  CHECK ("precioUnitario" >= 0 AND "costoUnitarioSnapshot" >= 0);

-- El anio de la venta tiene que ser plausible. Evita que un error de carga de
-- un formulario contamine los reportes mensuales.
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_anio_plausible_check"
  CHECK (anio BETWEEN 2000 AND 2100);

-- CUIT unico, pero solo entre los que informaron uno (indice parcial: los NULL
-- no colisionan entre si, que es el comportamiento correcto en Postgres).
CREATE UNIQUE INDEX "clientes_cuit_unico" ON "clientes"("cuit") WHERE "cuit" IS NOT NULL;

-- Indice parcial para el reporte que mas se consulta: ventas con saldo
-- pendiente. Es el caso "quien me debe", la pregunta del dia a dia.
CREATE INDEX "pagos_ventaId_monto_idx" ON "pagos"("ventaId", "monto");

-- ============================================================================
-- Configuracion inicial. Se siembran aca y no en el seed porque el costo/hora
-- de mano de obra es un dato de arranque del negocio, no un dato de demo: sin
-- el, ninguna receta de MANO_OBRA se puede costear.
-- ============================================================================
INSERT INTO "configuracion" ("clave", "valor") VALUES
  ('nombreNegocio',     'Mi Negocio'),
  ('moneda',            'ARS'),
  ('ivaDefault',        '21'),
  ('costoHoraManoObra',  '0'),
  ('margenObjetivo',    '40');

