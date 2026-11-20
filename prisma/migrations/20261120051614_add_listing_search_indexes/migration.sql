-- DB-02.1 (MP4-40): índices para la búsqueda por palabra clave del catálogo.
-- No se agregan columnas: los índices se calculan sobre nombre y descripción.

-- unaccent quita los acentos y pg_trgm permite que un LIKE '%texto%' use índice.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() es STABLE y PostgreSQL solo admite funciones IMMUTABLE en un
-- índice. Esta función fija la expresión de búsqueda, unaccent(lower(texto)),
-- y la declara IMMUTABLE. Las consultas deben usar esta misma función para
-- que el planificador elija los índices.
-- Lleva el esquema escrito (public.unaccent) porque PostgreSQL construye los
-- índices con un search_path restringido y sin él no encuentra la extensión.
CREATE FUNCTION search_text(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, lower(value)) $$;

-- Búsqueda sin distinguir mayúsculas ni acentos en el nombre.
CREATE INDEX "listings_name_search_idx" ON "listings" USING GIN (search_text("name") gin_trgm_ops);

-- Lo mismo en la descripción (las filas sin descripción no entran al índice).
CREATE INDEX "listings_description_search_idx" ON "listings" USING GIN (search_text("description") gin_trgm_ops);

-- Orden por defecto del catálogo: publicaciones activas, más reciente primero.
CREATE INDEX "listings_is_active_created_at_id_idx" ON "listings"("is_active", "created_at" DESC, "id" DESC);
