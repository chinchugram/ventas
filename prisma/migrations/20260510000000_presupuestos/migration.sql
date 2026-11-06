-- Ola 7.2: presupuestos.
-- Los precios se congelan en la linea; los totales NO se guardan (se calculan
-- como los de la venta). "Vencido" tampoco: se calcula con fecha + validezDias.

-- CreateEnum
CREATE TYPE "EstadoPresupuesto" AS ENUM ('ABIERTO', 'CONVERTIDO', 'ANULADO');

-- CreateTable
CREATE TABLE "presupuestos" (
    "id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "clienteId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "validezDias" INTEGER NOT NULL DEFAULT 15,
    "observaciones" TEXT,
    "estado" "EstadoPresupuesto" NOT NULL DEFAULT 'ABIERTO',
    "ventaId" UUID,
    "duplicadoDeId" UUID,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "presupuestos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presupuesto_items" (
    "id" UUID NOT NULL,
    "presupuestoId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precioUnitario" DECIMAL(14,4) NOT NULL,
    "ivaPct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "presupuesto_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "presupuestos_ventaId_key" ON "presupuestos"("ventaId");

-- CreateIndex
CREATE INDEX "presupuestos_clienteId_idx" ON "presupuestos"("clienteId");

-- CreateIndex
CREATE INDEX "presupuestos_estado_idx" ON "presupuestos"("estado");

-- CreateIndex
CREATE INDEX "presupuestos_fecha_idx" ON "presupuestos"("fecha");

-- CreateIndex
CREATE INDEX "presupuestos_duplicadoDeId_idx" ON "presupuestos"("duplicadoDeId");

-- CreateIndex
CREATE UNIQUE INDEX "presupuestos_anio_numero_key" ON "presupuestos"("anio", "numero");

-- CreateIndex
CREATE INDEX "presupuesto_items_presupuestoId_idx" ON "presupuesto_items"("presupuestoId");

-- CreateIndex
CREATE INDEX "presupuesto_items_articuloId_idx" ON "presupuesto_items"("articuloId");

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_duplicadoDeId_fkey" FOREIGN KEY ("duplicadoDeId") REFERENCES "presupuestos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_presupuestoId_fkey" FOREIGN KEY ("presupuestoId") REFERENCES "presupuestos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "articulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La base es la ultima linea de defensa.
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_numero_check" CHECK ("numero" > 0);
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_validez_check" CHECK ("validezDias" > 0);
-- CONVERTIDO <=> tiene venta. Un presupuesto no puede quedar convertido sin venta ni con venta sin estarlo.
ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_convertido_venta_check"
  CHECK (("estado" = 'CONVERTIDO') = ("ventaId" IS NOT NULL));
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_cantidad_check" CHECK ("cantidad" > 0);
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_precio_check" CHECK ("precioUnitario" >= 0);
ALTER TABLE "presupuesto_items" ADD CONSTRAINT "presupuesto_items_iva_check" CHECK ("ivaPct" >= 0 AND "ivaPct" <= 100);
