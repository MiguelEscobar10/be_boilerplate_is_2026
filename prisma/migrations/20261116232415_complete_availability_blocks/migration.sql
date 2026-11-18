-- DB-14.1 (MP4-60): completa la tabla de bloqueos de disponibilidad (H14).
-- Ver docs/modulos/reservas.md.
--
-- La tabla, el motivo de 200 caracteres, la FK a la publicación y el CHECK
-- start_at < end_at vienen de DB-03.1; aquí no se repiten.

-- AlterTable
ALTER TABLE "availability_blocks" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" UUID;

-- CreateIndex
CREATE INDEX "availability_blocks_listing_id_start_at_end_at_idx" ON "availability_blocks"("listing_id", "start_at", "end_at");

-- AddForeignKey
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los bloqueos que ya existían no tienen autor: solo el dueño de la
-- publicación puede bloquear (H14), así que se les asigna el dueño.
UPDATE "availability_blocks" b
SET "created_by" = l."landlord_id"
FROM "listings" l
WHERE l."id" = b."listing_id" AND b."created_by" IS NULL;

-- Un motivo de solo espacios en blanco pasa a ser "sin motivo", para que las
-- filas que ya existían cumplan el CHECK de abajo.
UPDATE "availability_blocks" SET "reason" = NULL WHERE "reason" !~ '\S';

-- Regla que Prisma no modela (H14, DB-14.1): el motivo es opcional, pero si
-- viene debe tener algún carácter que no sea espacio, tab o salto de línea.
ALTER TABLE "availability_blocks"
  ADD CONSTRAINT "availability_blocks_reason_check"
    CHECK ("reason" IS NULL OR "reason" ~ '\S');
