-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('EQUIPO', 'ESPACIO');

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('HORA', 'DIA', 'NOCHE', 'SEMANA');

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "landlord_id" UUID NOT NULL,
    "type" "ListingType" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "location" VARCHAR(200) NOT NULL,
    "rate_amount" DECIMAL(12,2) NOT NULL,
    "rate_unit" "RateUnit" NOT NULL,
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "conditions" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_images" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_landlord_id_idx" ON "listings"("landlord_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_images_listing_id_position_key" ON "listing_images"("listing_id", "position");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H01, DB-01.1)
ALTER TABLE "listings"
  ADD CONSTRAINT "listings_rate_amount_check" CHECK ("rate_amount" > 0),
  ADD CONSTRAINT "listings_deposit_amount_check" CHECK ("deposit_amount" >= 0),
  ADD CONSTRAINT "listings_name_not_blank_check" CHECK (char_length(btrim("name")) > 0),
  ADD CONSTRAINT "listings_location_not_blank_check" CHECK (char_length(btrim("location")) > 0);

ALTER TABLE "listing_images"
  ADD CONSTRAINT "listing_images_position_check" CHECK ("position" >= 0);
