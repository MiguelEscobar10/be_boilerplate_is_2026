-- DB-19.1 (MP4-102): opción "requiere verificación" en la publicación.
-- Ver docs/modulos/verificacion.md.

-- AlterTable
-- Con DEFAULT false, las publicaciones que ya existen quedan sin exigir
-- verificación y no hace falta un UPDATE aparte.
ALTER TABLE "listings" ADD COLUMN     "requires_verification" BOOLEAN NOT NULL DEFAULT false;
