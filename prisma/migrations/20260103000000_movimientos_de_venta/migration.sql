-- Etapa 2: cada movimiento de stock puede apuntar a la venta que lo origino,
-- para poder revertir exactamente lo descontado si la venta se anula.
ALTER TABLE "movimientos_stock" ADD COLUMN "ventaId" UUID;

CREATE INDEX "movimientos_stock_ventaId_idx" ON "movimientos_stock"("ventaId");

ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_ventaId_fkey"
  FOREIGN KEY ("ventaId") REFERENCES "ventas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
