-- DB-20.1 (MP4-111): enum de módulos de origen y restricciones de los avisos.
-- Ver docs/modulos/notificaciones.md.
--
-- Escrita a mano a partir de `prisma migrate dev --create-only`. Prisma
-- generaba DROP COLUMN + ADD COLUMN para source_module, que pierde los datos;
-- acá se convierte la columna en su lugar. Los CHECK y el índice único parcial
-- no se pueden expresar en schema.prisma sin preview features, por eso van
-- solo en SQL.

-- CreateEnum
CREATE TYPE "ModuloOrigen" AS ENUM ('CATALOGO', 'BUSQUEDA', 'RESERVAS', 'PAGOS_GARANTIA', 'MENSAJERIA', 'RESENAS', 'VERIFICACION', 'NOTIFICACIONES', 'REPORTES');

-- AlterTable: TEXT -> ModuloOrigen conservando las filas. Si alguna fila tiene
-- un valor fuera del enum, la migración falla en vez de alterar datos.
ALTER TABLE "notifications"
  ALTER COLUMN "source_module" TYPE "ModuloOrigen"
  USING "source_module"::"ModuloOrigen";

-- Límites de largo. El mínimo se mide sin los espacios de los extremos (btrim),
-- así un texto de solo espacios cuenta como vacío. El máximo se mide sobre el
-- texto completo, así los espacios de relleno no permiten pasarse del límite.
-- char_length cuenta caracteres, no bytes.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_title_length_check"
    CHECK (char_length(btrim("title")) >= 1 AND char_length("title") <= 100),
  ADD CONSTRAINT "notifications_message_length_check"
    CHECK (char_length(btrim("message")) >= 1 AND char_length("message") <= 500),
  -- La referencia va completa (tipo e id) o no va.
  ADD CONSTRAINT "notifications_reference_pair_check"
    CHECK (("reference_type" IS NULL) = ("reference_id" IS NULL));

-- Evita avisos duplicados para la misma referencia. Parcial: los avisos sin
-- referencia pueden repetirse.
CREATE UNIQUE INDEX "notifications_dedupe_key"
  ON "notifications" ("user_id", "source_module", "reference_type", "reference_id", "title")
  WHERE "reference_id" IS NOT NULL;
