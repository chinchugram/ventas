-- Ola 6.0: modelo de producción. Lo que de verdad se usó en cada trabajo (minutos de
-- máquina, minutos de mano de obra y materiales) para calcular el margen real.
-- Un trabajo por línea de venta (VentaItem). Los costos unitarios quedan congelados al
-- cargarlo. El consumo real NO mueve stock por sí solo.
-- Va antes que las migraciones de la ola 7: solo depende de tablas anteriores.

-- CreateTable
CREATE TABLE "trabajos_produccion" (
    "id" UUID NOT NULL,
    "ventaItemId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "minutosManoObra" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "costoHoraManoObraSnapshot" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notas" TEXT,
    "anuladoEn" TIMESTAMPTZ(3),
    "motivoAnulacion" TEXT,
    "usuarioId" UUID,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trabajos_produccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trabajo_tiempos" (
    "id" UUID NOT NULL,
    "trabajoId" UUID NOT NULL,
    "maquinaId" UUID NOT NULL,
    "minutos" DECIMAL(10,2) NOT NULL,
    "costoHoraSnapshot" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "trabajo_tiempos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trabajo_consumos" (
    "id" UUID NOT NULL,
    "trabajoId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "costoUnitarioSnapshot" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "trabajo_consumos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trabajos_produccion_ventaItemId_idx" ON "trabajos_produccion"("ventaItemId");
CREATE INDEX "trabajos_produccion_fecha_idx" ON "trabajos_produccion"("fecha");
CREATE INDEX "trabajos_produccion_usuarioId_idx" ON "trabajos_produccion"("usuarioId");
CREATE UNIQUE INDEX "trabajo_tiempos_trabajoId_maquinaId_key" ON "trabajo_tiempos"("trabajoId", "maquinaId");
CREATE INDEX "trabajo_tiempos_maquinaId_idx" ON "trabajo_tiempos"("maquinaId");
CREATE UNIQUE INDEX "trabajo_consumos_trabajoId_materialId_key" ON "trabajo_consumos"("trabajoId", "materialId");
CREATE INDEX "trabajo_consumos_materialId_idx" ON "trabajo_consumos"("materialId");

-- Un solo trabajo vigente por línea de venta (los anulados quedan de historial).
CREATE UNIQUE INDEX "trabajos_produccion_vigente_key" ON "trabajos_produccion"("ventaItemId") WHERE "anuladoEn" IS NULL;

-- AddForeignKey (nunca en cascada: tienen historial)
ALTER TABLE "trabajos_produccion" ADD CONSTRAINT "trabajos_produccion_ventaItemId_fkey" FOREIGN KEY ("ventaItemId") REFERENCES "venta_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajos_produccion" ADD CONSTRAINT "trabajos_produccion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajo_tiempos" ADD CONSTRAINT "trabajo_tiempos_trabajoId_fkey" FOREIGN KEY ("trabajoId") REFERENCES "trabajos_produccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajo_tiempos" ADD CONSTRAINT "trabajo_tiempos_maquinaId_fkey" FOREIGN KEY ("maquinaId") REFERENCES "maquinas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajo_consumos" ADD CONSTRAINT "trabajo_consumos_trabajoId_fkey" FOREIGN KEY ("trabajoId") REFERENCES "trabajos_produccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajo_consumos" ADD CONSTRAINT "trabajo_consumos_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materiales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas en la base (última línea de defensa).
ALTER TABLE "trabajos_produccion" ADD CONSTRAINT "trabajos_produccion_valores_check"
  CHECK ("minutosManoObra" >= 0 AND "costoHoraManoObraSnapshot" >= 0);
ALTER TABLE "trabajos_produccion" ADD CONSTRAINT "trabajos_produccion_anulacion_check"
  CHECK (("anuladoEn" IS NULL) = ("motivoAnulacion" IS NULL)
         AND ("motivoAnulacion" IS NULL OR length(btrim("motivoAnulacion")) > 0));
ALTER TABLE "trabajo_tiempos" ADD CONSTRAINT "trabajo_tiempos_valores_check"
  CHECK ("minutos" >= 0 AND "costoHoraSnapshot" >= 0);
ALTER TABLE "trabajo_consumos" ADD CONSTRAINT "trabajo_consumos_valores_check"
  CHECK ("cantidad" >= 0 AND "costoUnitarioSnapshot" >= 0);
