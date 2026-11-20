-- DB-17.1 (MP4-89): calificación que el arrendatario le da al bien y a su
-- arrendador al terminar una reserva (H17). Ver docs/modulos/resenas.md.

-- CreateTable
CREATE TABLE "listing_landlord_ratings" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "landlord_id" UUID NOT NULL,
    "listing_score" SMALLINT NOT NULL,
    "landlord_score" SMALLINT NOT NULL,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_landlord_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listing_landlord_ratings_reservation_id_key" ON "listing_landlord_ratings"("reservation_id");

-- CreateIndex
CREATE INDEX "listing_landlord_ratings_listing_id_idx" ON "listing_landlord_ratings"("listing_id");

-- CreateIndex
CREATE INDEX "listing_landlord_ratings_landlord_id_idx" ON "listing_landlord_ratings"("landlord_id");

-- AddForeignKey
ALTER TABLE "listing_landlord_ratings" ADD CONSTRAINT "listing_landlord_ratings_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_landlord_ratings" ADD CONSTRAINT "listing_landlord_ratings_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_landlord_ratings" ADD CONSTRAINT "listing_landlord_ratings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_landlord_ratings" ADD CONSTRAINT "listing_landlord_ratings_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H17, DB-17.1)
ALTER TABLE "listing_landlord_ratings"
  -- Cada puntaje va de 1 a 5.
  ADD CONSTRAINT "listing_landlord_ratings_listing_score_check"
    CHECK ("listing_score" BETWEEN 1 AND 5),
  ADD CONSTRAINT "listing_landlord_ratings_landlord_score_check"
    CHECK ("landlord_score" BETWEEN 1 AND 5),
  -- El comentario es opcional, pero si viene debe tener algún carácter que no
  -- sea espacio, tab o salto de línea.
  ADD CONSTRAINT "listing_landlord_ratings_comment_check"
    CHECK ("comment" IS NULL OR "comment" ~ '\S'),
  -- Nadie se califica a sí mismo como arrendador.
  ADD CONSTRAINT "listing_landlord_ratings_author_not_landlord_check"
    CHECK ("author_id" <> "landlord_id");

-- La calificación es de la publicación de la reserva, de quien reservó (autor)
-- y del dueño de esa publicación (arrendador). Como los promedios salen de
-- listing_id y landlord_id, que se guardan aquí y no se leen de la reserva, el
-- trigger evita que una fila cuente para otra publicación u otro arrendador.
-- Cruza tablas, por eso es un trigger y no un CHECK. Qué estado de la reserva
-- permite calificar (COMPLETADA) lo revisa BE-17.1, no la base: el estado
-- cambia y la calificación ya hecha tiene que quedar.
CREATE FUNCTION "listing_landlord_ratings_consistency_check"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "reservations" r
    JOIN "listings" l ON l."id" = r."listing_id"
    WHERE r."id" = NEW."reservation_id"
      AND r."listing_id" = NEW."listing_id"
      AND r."tenant_id" = NEW."author_id"
      AND l."landlord_id" = NEW."landlord_id"
  ) THEN
    -- Si la reserva no existe, que responda la FK (P2003), no este trigger.
    IF NOT EXISTS (SELECT 1 FROM "reservations" WHERE "id" = NEW."reservation_id") THEN
      RETURN NEW;
    END IF;

    -- El nombre va en el mensaje, igual que en el error de un CHECK.
    RAISE EXCEPTION 'listing_landlord_ratings_consistency_check: la calificación no es de la publicación, del arrendatario ni del arrendador de la reserva %', NEW."reservation_id"
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'listing_landlord_ratings_consistency_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "listing_landlord_ratings_consistency"
  BEFORE INSERT OR UPDATE OF "reservation_id", "author_id", "listing_id", "landlord_id"
  ON "listing_landlord_ratings"
  FOR EACH ROW
  EXECUTE FUNCTION "listing_landlord_ratings_consistency_check"();
