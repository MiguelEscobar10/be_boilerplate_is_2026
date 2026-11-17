-- DB-07.1 (MP4-97): solicitudes de verificación de identidad.
-- Ver docs/modulos/verificacion.md.

-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_key" VARCHAR(255) NOT NULL,
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'PENDIENTE',
    "rejection_reason" VARCHAR(500),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_verifications_user_id_submitted_at_idx" ON "identity_verifications"("user_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "identity_verifications_status_submitted_at_idx" ON "identity_verifications"("status", "submitted_at");

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H07, DB-07.1)

-- La referencia al documento no puede quedar vacía ni ser solo espacios.
ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_document_key_check" CHECK ("document_key" ~ '\S');

-- La decisión va completa o no va: mientras está PENDIENTE no hay revisor ni
-- fecha de revisión; en APROBADA o RECHAZADA están los dos.
ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_review_check" CHECK (
    ("status" = 'PENDIENTE' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" <> 'PENDIENTE' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  );

-- Nadie decide su propia solicitud.
ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_reviewer_not_owner_check" CHECK ("reviewed_by" <> "user_id");

-- El motivo de rechazo es opcional, pero solo existe en RECHAZADA y, si viene,
-- tiene algún carácter que no sea espacio en blanco (\S descarta también saltos
-- de línea y tabs). Con NULL el CHECK se cumple, que es lo buscado.
ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_rejection_reason_check" CHECK (
    "rejection_reason" IS NULL
    OR ("status" = 'RECHAZADA' AND "rejection_reason" ~ '\S')
  );

-- La revisión no puede ser anterior al envío.
ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_reviewed_at_check" CHECK ("reviewed_at" >= "submitted_at");

-- Una sola solicitud PENDIENTE por usuario (BE-07.1 responde 409 si ya hay
-- una). Las APROBADA y RECHAZADA pueden ser varias.
CREATE UNIQUE INDEX "identity_verifications_one_pending_per_user_key"
  ON "identity_verifications" ("user_id")
  WHERE "status" = 'PENDIENTE';
