-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "landlord_id" UUID NOT NULL,
    "reservation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_idx" ON "conversations"("tenant_id");

-- CreateIndex
CREATE INDEX "conversations_landlord_id_idx" ON "conversations"("landlord_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_id_idx" ON "messages"("conversation_id", "created_at", "id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas que Prisma no modela (H15, DB-15.1)

-- Una sola conversación previa a la reserva entre el mismo arrendatario y la
-- misma publicación. Las de reserva (reservation_id no nulo) quedan fuera:
-- su unicidad la define DB-16.1.
CREATE UNIQUE INDEX "conversations_pre_reservation_key"
  ON "conversations" ("listing_id", "tenant_id")
  WHERE "reservation_id" IS NULL;

-- Nadie conversa consigo mismo (p. ej. el arrendador sobre su propia publicación).
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_distinct_participants_check" CHECK ("tenant_id" <> "landlord_id");

-- El largo máximo (1000) lo pone VARCHAR(1000); aquí, que no esté vacío.
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_content_not_blank_check" CHECK (char_length(btrim("content")) > 0);
