-- DB-16.1 (MP4-85): la conversación de una reserva (H16) usa las mismas tablas
-- de DB-15.1. Ver docs/modulos/mensajeria.md.

-- CreateIndex
CREATE UNIQUE INDEX "conversations_reservation_id_key" ON "conversations"("reservation_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H16, DB-16.1)

-- La conversación de una reserva es entre las dos personas de esa reserva y
-- sobre su publicación: el arrendatario es el que reservó y el arrendador es
-- el dueño de la publicación. Cruza tablas, por eso es un trigger y no un
-- CHECK. Las conversaciones previas (reservation_id NULL) no se revisan aquí.
CREATE FUNCTION "conversations_reservation_participants_check"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."reservation_id" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "reservations" r
    JOIN "listings" l ON l."id" = r."listing_id"
    WHERE r."id" = NEW."reservation_id"
      AND r."listing_id" = NEW."listing_id"
      AND r."tenant_id" = NEW."tenant_id"
      AND l."landlord_id" = NEW."landlord_id"
  ) THEN
    -- Si la reserva no existe, que responda la FK (P2003), no este trigger.
    IF NOT EXISTS (SELECT 1 FROM "reservations" WHERE "id" = NEW."reservation_id") THEN
      RETURN NEW;
    END IF;

    -- El nombre va en el mensaje, igual que en el error de un CHECK.
    RAISE EXCEPTION 'conversations_reservation_participants_check: la conversación no es de la publicación ni de las personas de la reserva %', NEW."reservation_id"
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'conversations_reservation_participants_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "conversations_reservation_participants"
  BEFORE INSERT OR UPDATE OF "reservation_id", "listing_id", "tenant_id", "landlord_id"
  ON "conversations"
  FOR EACH ROW
  EXECUTE FUNCTION "conversations_reservation_participants_check"();
