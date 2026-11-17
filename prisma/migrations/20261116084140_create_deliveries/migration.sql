-- DB-08.1 (MP4-72): registro de entrega asociado a la reserva.
-- Ver docs/modulos/entregas.md.

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initial_condition_note" VARCHAR(500) NOT NULL,
    "registered_by" UUID NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_photos" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_reservation_id_key" ON "deliveries"("reservation_id");

-- CreateIndex
CREATE INDEX "deliveries_registered_by_idx" ON "deliveries"("registered_by");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_photos_delivery_id_position_key" ON "delivery_photos"("delivery_id", "position");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_photos" ADD CONSTRAINT "delivery_photos_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H08, DB-08.1)

-- La nota del estado inicial es obligatoria: al menos un carácter que no sea
-- espacio en blanco (\S descarta también saltos de línea y tabs). El máximo de
-- 500 lo pone el VARCHAR(500).
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_initial_condition_note_check" CHECK ("initial_condition_note" ~ '\S');

-- Hasta 5 fotos por entrega: posiciones de 0 a 4, junto con el único
-- (delivery_id, position).
ALTER TABLE "delivery_photos"
  ADD CONSTRAINT "delivery_photos_position_check" CHECK ("position" BETWEEN 0 AND 4),
  ADD CONSTRAINT "delivery_photos_path_check" CHECK ("path" ~ '\S');
