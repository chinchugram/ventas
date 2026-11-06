-- 8.2: trazabilidad de la ola 7. Quien creo cada presupuesto y lista de precios,
-- y quien registro cada contacto de cobranza.
-- Nullable: lo historico (de antes de los usuarios) queda en NULL y se muestra "—".
-- RESTRICT: un usuario con historial no se borra (baja logica con `activo = false`).

ALTER TABLE "presupuestos" ADD COLUMN "usuarioId" UUID;
ALTER TABLE "contactos_cobranza" ADD COLUMN "usuarioId" UUID;
ALTER TABLE "listas_precios" ADD COLUMN "usuarioId" UUID;

CREATE INDEX "presupuestos_usuarioId_idx" ON "presupuestos"("usuarioId");
CREATE INDEX "contactos_cobranza_usuarioId_idx" ON "contactos_cobranza"("usuarioId");
CREATE INDEX "listas_precios_usuarioId_idx" ON "listas_precios"("usuarioId");

ALTER TABLE "presupuestos" ADD CONSTRAINT "presupuestos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contactos_cobranza" ADD CONSTRAINT "contactos_cobranza_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "listas_precios" ADD CONSTRAINT "listas_precios_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
