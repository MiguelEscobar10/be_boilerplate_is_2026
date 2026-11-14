-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ARRENDADOR', 'ARRENDATARIO', 'REVISOR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'ARRENDATARIO';

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas que Prisma no modela (Módulo 0, DB-00.1)
ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_name_not_blank_check" CHECK (char_length(btrim("name")) > 0),
  ADD CONSTRAINT "user_profiles_phone_check" CHECK ("phone" ~ '^[0-9]{8,15}$');
