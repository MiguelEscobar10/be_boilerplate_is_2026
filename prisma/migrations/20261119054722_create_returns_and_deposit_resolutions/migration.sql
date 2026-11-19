-- DB-09.1 (MP4-76): devoluciones y resolución del depósito de garantía.
-- Ver docs/modulos/devoluciones.md.

-- CreateEnum
CREATE TYPE "ReturnFinalState" AS ENUM ('SIN_OBSERVACIONES', 'CON_OBSERVACIONES');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('LIBERADA', 'RETENIDA');

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "returned_at" TIMESTAMP(3) NOT NULL,
    "final_state" "ReturnFinalState" NOT NULL,
    "observations" VARCHAR(500),
    "damages" VARCHAR(500),
    "registered_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_resolutions" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "original_deposit" DECIMAL(12,2) NOT NULL,
    "retained_amount" DECIMAL(12,2) NOT NULL,
    "released_amount" DECIMAL(12,2) NOT NULL,
    "status" "DepositStatus" NOT NULL,
    "reason" VARCHAR(500),
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "returns_reservation_id_key" ON "returns"("reservation_id");

-- CreateIndex
CREATE INDEX "returns_registered_by_idx" ON "returns"("registered_by");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_resolutions_reservation_id_key" ON "deposit_resolutions"("reservation_id");

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_resolutions" ADD CONSTRAINT "deposit_resolutions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H09, DB-09.1)

-- La nota general es opcional; si viene, con al menos un carácter que no sea
-- espacio en blanco. Los daños son obligatorios con CON_OBSERVACIONES y no
-- existen con SIN_OBSERVACIONES.
ALTER TABLE "returns"
  ADD CONSTRAINT "returns_observations_check" CHECK ("observations" IS NULL OR "observations" ~ '\S'),
  ADD CONSTRAINT "returns_damages_check" CHECK (
    ("final_state" = 'CON_OBSERVACIONES' AND "damages" IS NOT NULL AND "damages" ~ '\S')
    OR ("final_state" = 'SIN_OBSERVACIONES' AND "damages" IS NULL)
  );

-- Importes: ninguno negativo, lo retenido no supera el depósito y las dos
-- partes suman el depósito original.
ALTER TABLE "deposit_resolutions"
  ADD CONSTRAINT "deposit_resolutions_original_deposit_check" CHECK ("original_deposit" >= 0),
  ADD CONSTRAINT "deposit_resolutions_retained_amount_check" CHECK ("retained_amount" >= 0),
  ADD CONSTRAINT "deposit_resolutions_released_amount_check" CHECK ("released_amount" >= 0),
  ADD CONSTRAINT "deposit_resolutions_retained_within_deposit_check" CHECK ("retained_amount" <= "original_deposit"),
  ADD CONSTRAINT "deposit_resolutions_amounts_match_deposit_check" CHECK ("retained_amount" + "released_amount" = "original_deposit");

-- El estado de la garantía sale del monto retenido: RETENIDA si se retuvo
-- algo y LIBERADA si no. Con retención, el motivo es obligatorio.
ALTER TABLE "deposit_resolutions"
  ADD CONSTRAINT "deposit_resolutions_status_check" CHECK (
    ("retained_amount" > 0 AND "status" = 'RETENIDA')
    OR ("retained_amount" = 0 AND "status" = 'LIBERADA')
  ),
  ADD CONSTRAINT "deposit_resolutions_reason_check" CHECK (
    ("reason" IS NULL AND "retained_amount" = 0)
    OR ("reason" IS NOT NULL AND "reason" ~ '\S')
  );
