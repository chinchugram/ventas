-- Ola 2.1: un pago se puede anular, pero nunca se borra (baja logica).
-- Un pago anulado se sigue mostrando y no cuenta en ningun saldo.
ALTER TABLE "pagos" ADD COLUMN "anuladoEn" TIMESTAMPTZ(3);
ALTER TABLE "pagos" ADD COLUMN "motivoAnulacion" TEXT;

-- Anulado y motivo van juntos: no hay anulacion sin motivo, ni motivo suelto.
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_anulacion_con_motivo_check"
  CHECK (
    ("anuladoEn" IS NULL AND "motivoAnulacion" IS NULL)
    OR ("anuladoEn" IS NOT NULL AND "motivoAnulacion" IS NOT NULL AND length(btrim("motivoAnulacion")) > 0)
  );
