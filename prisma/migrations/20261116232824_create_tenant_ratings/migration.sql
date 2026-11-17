-- DB-18.1 (MP4-93): calificación que el arrendador le da al arrendatario de
-- una reserva (H18). Ver docs/modulos/resenas.md.

-- CreateTable
CREATE TABLE "tenant_ratings" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "score" SMALLINT NOT NULL,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ratings_reservation_id_key" ON "tenant_ratings"("reservation_id");

-- CreateIndex
CREATE INDEX "tenant_ratings_tenant_id_created_at_idx" ON "tenant_ratings"("tenant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "tenant_ratings" ADD CONSTRAINT "tenant_ratings_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ratings" ADD CONSTRAINT "tenant_ratings_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_ratings" ADD CONSTRAINT "tenant_ratings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H18, DB-18.1)
ALTER TABLE "tenant_ratings"
  -- Puntaje de 1 a 5.
  ADD CONSTRAINT "tenant_ratings_score_check"
    CHECK ("score" BETWEEN 1 AND 5),
  -- El comentario es opcional, pero si viene debe tener algún carácter que no
  -- sea espacio, tab o salto de línea.
  ADD CONSTRAINT "tenant_ratings_comment_check"
    CHECK ("comment" IS NULL OR "comment" ~ '\S'),
  -- Nadie se califica a sí mismo.
  ADD CONSTRAINT "tenant_ratings_author_not_tenant_check"
    CHECK ("author_id" <> "tenant_id");
