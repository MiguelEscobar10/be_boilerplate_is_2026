-- DB-13.1 (MP4-56): consulta de los períodos ocupados de una publicación,
-- base del calendario de disponibilidad (H13).
-- Ver docs/modulos/reservas.md.
--
-- No crea tablas ni índices: es una función de solo lectura sobre
-- `reservations` y `availability_blocks` que reutiliza los índices de DB-03.1
-- (reservations_listing_id_status_start_at_end_at_idx) y de DB-14.1
-- (availability_blocks_listing_id_start_at_end_at_idx).

-- Períodos ocupados de una publicación que se cruzan con el rango
-- [p_from, p_to), en UTC como las columnas.
--
-- * Ocupan fechas las reservas CONFIRMADA o EN_CURSO y los bloqueos del
--   arrendador. Las solicitudes PENDIENTE no apartan fechas (H13, criterio 2)
--   y RECHAZADA, CANCELADA y COMPLETADA tampoco entran.
-- * Los períodos son semiabiertos: uno que termina justo en p_from o empieza
--   justo en p_to no se cruza con el rango.
-- * Devuelve cada período completo, sin recortarlo al rango, y solo su inicio,
--   su fin y su origen: ni quién reservó ni el motivo del bloqueo.
CREATE FUNCTION "listing_busy_periods"(
  p_listing_id UUID,
  p_from TIMESTAMP(3),
  p_to TIMESTAMP(3)
)
RETURNS TABLE (
  "start_at" TIMESTAMP(3),
  "end_at" TIMESTAMP(3),
  "source" TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT r."start_at", r."end_at", 'RESERVA'::TEXT AS "source"
  FROM "reservations" r
  WHERE r."listing_id" = p_listing_id
    AND r."status" IN ('CONFIRMADA', 'EN_CURSO')
    AND r."start_at" < p_to
    AND r."end_at" > p_from
  UNION ALL
  SELECT b."start_at", b."end_at", 'BLOQUEO'::TEXT AS "source"
  FROM "availability_blocks" b
  WHERE b."listing_id" = p_listing_id
    AND b."start_at" < p_to
    AND b."end_at" > p_from
  ORDER BY "start_at", "end_at", "source";
$$;
