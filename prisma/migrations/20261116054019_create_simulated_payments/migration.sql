-- DB-05.1 (MP4-64): registro de intentos de pago simulado.
-- Ver docs/modulos/pagos.md.

-- CreateEnum
CREATE TYPE "SimulatedPaymentStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "simulated_payments" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "rental_cost" DECIMAL(12,2) NOT NULL,
    "deposit_amount" DECIMAL(12,2) NOT NULL,
    "status" "SimulatedPaymentStatus" NOT NULL DEFAULT 'PENDIENTE',
    "card_last4" CHAR(4) NOT NULL,
    "rejection_reason" VARCHAR(200),
    "attempt_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulated_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "simulated_payments_reservation_id_created_at_id_idx" ON "simulated_payments"("reservation_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "simulated_payments_reservation_id_attempt_number_key" ON "simulated_payments"("reservation_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "simulated_payments" ADD CONSTRAINT "simulated_payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H05, H06, DB-05.1)

-- Importes no negativos y total coherente con sus dos partes.
ALTER TABLE "simulated_payments"
  ADD CONSTRAINT "simulated_payments_total_amount_check" CHECK ("total_amount" >= 0),
  ADD CONSTRAINT "simulated_payments_rental_cost_check" CHECK ("rental_cost" >= 0),
  ADD CONSTRAINT "simulated_payments_deposit_amount_check" CHECK ("deposit_amount" >= 0),
  ADD CONSTRAINT "simulated_payments_total_matches_parts_check"
    CHECK ("total_amount" = "rental_cost" + "deposit_amount");

-- Como máximo tres intentos por reserva (junto con el único
-- (reservation_id, attempt_number)).
ALTER TABLE "simulated_payments"
  ADD CONSTRAINT "simulated_payments_attempt_number_check" CHECK ("attempt_number" BETWEEN 1 AND 3);

-- Solo los últimos 4 dígitos de la tarjeta; nunca el número completo ni el CVV.
ALTER TABLE "simulated_payments"
  ADD CONSTRAINT "simulated_payments_card_last4_check" CHECK ("card_last4" ~ '^[0-9]{4}$');

-- El motivo es obligatorio si el intento fue RECHAZADO y debe tener al menos
-- un carácter que no sea espacio en blanco (\S descarta también saltos de
-- línea y tabs, que btrim no quita). NULL en los demás estados. El IS NOT NULL
-- hace falta: con NULL la expresión regular da NULL y el CHECK lo aceptaría.
ALTER TABLE "simulated_payments"
  ADD CONSTRAINT "simulated_payments_rejection_reason_check" CHECK (
    ("status" = 'RECHAZADO' AND "rejection_reason" IS NOT NULL AND "rejection_reason" ~ '\S')
    OR ("status" <> 'RECHAZADO' AND "rejection_reason" IS NULL)
  );

-- Un solo pago aprobado por reserva. Los rechazados pueden ser varios.
CREATE UNIQUE INDEX "simulated_payments_one_approved_per_reservation_key"
  ON "simulated_payments" ("reservation_id")
  WHERE "status" = 'APROBADO';
