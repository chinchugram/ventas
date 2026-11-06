-- Etapa 2: stock real. Compras (entradas) y libro de movimientos.

CREATE TYPE "TipoMovimiento" AS ENUM ('COMPRA', 'VENTA', 'AJUSTE');

CREATE TABLE "compras" (
    "id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "proveedor" TEXT NOT NULL,
    "comprobante" TEXT,
    "notas" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compras_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compra_items" (
    "id" UUID NOT NULL,
    "compraId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "costoUnitario" DECIMAL(14,4) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "compra_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "movimientos_stock" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "stockResultante" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT,
    "compraId" UUID,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "compras_fecha_idx" ON "compras"("fecha");
CREATE INDEX "compra_items_compraId_idx" ON "compra_items"("compraId");
CREATE INDEX "compra_items_materialId_idx" ON "compra_items"("materialId");
CREATE INDEX "movimientos_stock_materialId_creadoEn_idx" ON "movimientos_stock"("materialId", "creadoEn");
CREATE INDEX "movimientos_stock_compraId_idx" ON "movimientos_stock"("compraId");

ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_compraId_fkey"
  FOREIGN KEY ("compraId") REFERENCES "compras"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materiales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materiales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_compraId_fkey"
  FOREIGN KEY ("compraId") REFERENCES "compras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Una compra compra algo: cantidad y costo positivos, total no negativo.
ALTER TABLE "compra_items" ADD CONSTRAINT "compra_items_valores_check"
  CHECK ("cantidad" > 0 AND "costoUnitario" >= 0 AND "subtotal" >= 0);

ALTER TABLE "compras" ADD CONSTRAINT "compras_total_no_negativo_check"
  CHECK ("total" >= 0);

-- Un movimiento que no mueve nada no es un movimiento, y el saldo nunca es negativo.
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_valores_check"
  CHECK ("cantidad" <> 0 AND "stockResultante" >= 0);
