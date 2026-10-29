-- Ola 4.2: trazabilidad. Quien cargo cada venta, cobro, compra y movimiento de stock.
-- Nullable: lo historico (de antes de los usuarios) queda en NULL y se muestra "—".
-- RESTRICT: un usuario con historial no se borra (baja logica con `activo = false`).

ALTER TABLE "ventas" ADD COLUMN "usuarioId" UUID;
ALTER TABLE "pagos" ADD COLUMN "usuarioId" UUID;
ALTER TABLE "compras" ADD COLUMN "usuarioId" UUID;
ALTER TABLE "movimientos_stock" ADD COLUMN "usuarioId" UUID;

CREATE INDEX "ventas_usuarioId_idx" ON "ventas"("usuarioId");
CREATE INDEX "pagos_usuarioId_idx" ON "pagos"("usuarioId");
CREATE INDEX "compras_usuarioId_idx" ON "compras"("usuarioId");
CREATE INDEX "movimientos_stock_usuarioId_idx" ON "movimientos_stock"("usuarioId");

ALTER TABLE "ventas" ADD CONSTRAINT "ventas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compras" ADD CONSTRAINT "compras_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
