-- DB-11.1 (MP4-44): índices para los filtros del catálogo (H11).
-- No agrega tablas ni columnas.

-- Filtro por tipo (EQUIPO o ESPACIO) conservando el orden por defecto:
-- activas, más reciente primero.
CREATE INDEX "listings_is_active_type_created_at_id_idx" ON "listings"("is_active", "type", "created_at" DESC, "id" DESC);

-- Filtro por rango de tarifa (precio mínimo y máximo).
CREATE INDEX "listings_is_active_rate_amount_idx" ON "listings"("is_active", "rate_amount");

-- Filtro por ubicación: contiene el texto, sin distinguir mayúsculas ni
-- acentos. Usa search_text y pg_trgm, creados en DB-02.1.
CREATE INDEX "listings_location_search_idx" ON "listings" USING GIN (search_text("location") gin_trgm_ops);

-- El filtro por fechas disponibles no necesita índices nuevos: consulta
-- listing_busy_periods (DB-13.1), que ya usa
-- reservations_listing_id_status_start_at_end_at_idx (DB-03.1) y
-- availability_blocks_listing_id_start_at_end_at_idx (DB-14.1).
