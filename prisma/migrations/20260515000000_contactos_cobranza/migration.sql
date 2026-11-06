-- Ola 7.3a: registro de contactos de cobranza (llamados y mensajes a clientes).
-- Solo se guarda lo que pasó y lo que se prometió; el saldo y la antigüedad de
-- la deuda se calculan desde ventas y pagos.

-- CreateTable
CREATE TABLE "contactos_cobranza" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "nota" TEXT NOT NULL,
    "proximoContacto" DATE,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contactos_cobranza_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contactos_cobranza_clienteId_fecha_idx" ON "contactos_cobranza"("clienteId", "fecha");

-- AddForeignKey
ALTER TABLE "contactos_cobranza" ADD CONSTRAINT "contactos_cobranza_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No se puede prometer un próximo contacto anterior al contacto mismo.
ALTER TABLE "contactos_cobranza" ADD CONSTRAINT "contactos_cobranza_proximo_check"
  CHECK ("proximoContacto" IS NULL OR "proximoContacto" >= "fecha");

-- La nota no puede quedar vacía ni ser un montón de espacios, ni un texto enorme.
ALTER TABLE "contactos_cobranza" ADD CONSTRAINT "contactos_cobranza_nota_check"
  CHECK (length(btrim("nota")) > 0 AND length("nota") <= 500);
