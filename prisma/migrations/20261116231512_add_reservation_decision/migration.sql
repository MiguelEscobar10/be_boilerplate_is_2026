-- DB-04.1 (MP4-52): decisión del arrendador sobre una reserva.
-- Ver docs/modulos/reservas.md.
--
-- Solo agrega columnas opcionales: las reservas que ya existen quedan con las
-- tres en NULL y cumplen todos los CHECK.

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "decided_by" UUID,
ADD COLUMN     "rejection_reason" VARCHAR(500);

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H04, DB-04.1)
ALTER TABLE "reservations"
  -- Fecha y autor de la decisión van los dos o ninguno.
  ADD CONSTRAINT "reservations_decision_pair_check"
    CHECK (("decided_at" IS NULL) = ("decided_by" IS NULL)),
  -- Una solicitud PENDIENTE todavía no tiene decisión.
  ADD CONSTRAINT "reservations_pending_undecided_check"
    CHECK ("status" <> 'PENDIENTE' OR "decided_at" IS NULL),
  -- El motivo solo existe en una reserva RECHAZADA y no puede ser solo
  -- espacios, tabs o saltos de línea.
  ADD CONSTRAINT "reservations_rejection_reason_check"
    CHECK (
      "rejection_reason" IS NULL
      OR ("status" = 'RECHAZADA' AND "rejection_reason" ~ '\S')
    );
