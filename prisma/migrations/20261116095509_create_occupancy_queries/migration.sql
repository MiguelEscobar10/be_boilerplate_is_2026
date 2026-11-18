-- DB-22.1 (MP4-119): consulta de días ocupados y bloqueados por publicación,
-- base del reporte de tasa de ocupación (H22).
-- Ver docs/modulos/reportes.md.
--
-- No crea tablas: son dos funciones de solo lectura sobre `reservations` y
-- `availability_blocks` (DB-03.1). El índice de bloqueos
-- (listing_id, start_at, end_at) lo agrega DB-14.1; esta migración no lo
-- duplica. Las reservas usan reservations_listing_id_status_start_at_end_at_idx.

-- Día por día: para cada publicación y cada día del período (fechas
-- inclusivas, en America/El_Salvador), si está bloqueado y si está ocupado.
--
-- * Un día va de las 00:00 a las 24:00 locales. Como las columnas guardan UTC
--   sin zona, los límites del día se pasan a UTC antes de comparar.
-- * Bloqueado: algún bloqueo se cruza con el día.
-- * Ocupado: el día no está bloqueado y alguna reserva CONFIRMADA, EN_CURSO
--   o COMPLETADA se cruza con él. EXISTS hace que varias reservas sobre el
--   mismo día cuenten una sola vez.
-- * Los períodos son semiabiertos [start_at, end_at): una reserva que termina
--   justo a la medianoche no ocupa el día siguiente.
CREATE FUNCTION "listing_day_occupancy"(
  p_listing_ids UUID[],
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  "listing_id" UUID,
  "day" DATE,
  "blocked" BOOLEAN,
  "occupied" BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH "days" AS (
    SELECT
      d::DATE AS "day",
      (d AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'UTC' AS "day_start",
      ((d + INTERVAL '1 day') AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'UTC' AS "day_end"
    FROM generate_series(p_from::TIMESTAMP, p_to::TIMESTAMP, INTERVAL '1 day') AS d
  ),
  "marked" AS (
    SELECT
      l."id" AS "listing_id",
      dd."day",
      EXISTS (
        SELECT 1 FROM "availability_blocks" b
        WHERE b."listing_id" = l."id"
          AND b."start_at" < dd."day_end"
          AND b."end_at" > dd."day_start"
      ) AS "blocked",
      EXISTS (
        SELECT 1 FROM "reservations" r
        WHERE r."listing_id" = l."id"
          AND r."status" IN ('CONFIRMADA', 'EN_CURSO', 'COMPLETADA')
          AND r."start_at" < dd."day_end"
          AND r."end_at" > dd."day_start"
      ) AS "reserved"
    FROM "listings" l
    CROSS JOIN "days" dd
    WHERE l."id" = ANY (p_listing_ids)
  )
  SELECT "listing_id", "day", "blocked", "reserved" AND NOT "blocked"
  FROM "marked"
  ORDER BY "listing_id", "day";
$$;

-- Totales por publicación de un arrendador, listos para la fórmula de BE-22.1:
--   días disponibles = period_days - blocked_days
--   tasa = occupied_days / días disponibles × 100
-- Incluye todas sus publicaciones (también las inactivas, que tienen historia
-- de reservas); una publicación sin reservas devuelve occupied_days = 0.
CREATE FUNCTION "landlord_occupancy"(
  p_landlord_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  "listing_id" UUID,
  "listing_name" VARCHAR,
  "period_days" INTEGER,
  "blocked_days" INTEGER,
  "occupied_days" INTEGER
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l."id",
    l."name",
    count(o."day")::INTEGER,
    count(*) FILTER (WHERE o."blocked")::INTEGER,
    count(*) FILTER (WHERE o."occupied")::INTEGER
  FROM "listings" l
  LEFT JOIN "listing_day_occupancy"(
    ARRAY(SELECT x."id" FROM "listings" x WHERE x."landlord_id" = p_landlord_id),
    p_from,
    p_to
  ) o ON o."listing_id" = l."id"
  WHERE l."landlord_id" = p_landlord_id
  GROUP BY l."id", l."name"
  ORDER BY l."name", l."id";
$$;
