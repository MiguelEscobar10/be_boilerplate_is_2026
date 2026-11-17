-- DB-21.1 (MP4-115): consulta de ingresos por bien (H21).
-- Ver docs/modulos/pagos.md.

-- CreateIndex
CREATE INDEX "simulated_payments_status_created_at_idx" ON "simulated_payments"("status", "created_at");

-- Consulta que Prisma no modela (H21, DB-21.1)

-- Ingresos por bien de un arrendador en el rango [p_from, p_to), en UTC.
--
-- * Ingreso = suma de simulated_payments.rental_cost de los pagos APROBADO.
--   El depósito (deposit_amount, y el retenido de la garantía) no entra.
-- * La fecha del ingreso es simulated_payments.created_at del pago APROBADO.
-- * Parte de los listings del arrendador con LEFT JOIN y deja los filtros de
--   estado y rango en el ON: un bien sin ingresos sale con 0.00. Incluye los
--   bienes desactivados (is_active va en el resultado).
-- * No filtra por el estado de la reserva: basta con que el pago sea APROBADO.
-- * Con p_from >= p_to ningún pago entra y todos los bienes salen con 0.00;
--   validar el rango le toca al backend (BE-21.1).
CREATE FUNCTION "listing_income"(
  p_landlord_id UUID,
  p_from TIMESTAMP(3),
  p_to TIMESTAMP(3)
)
RETURNS TABLE (
  listing_id UUID,
  listing_name VARCHAR(100),
  is_active BOOLEAN,
  income NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l."id",
    l."name",
    l."is_active",
    ROUND(COALESCE(SUM(sp."rental_cost"), 0), 2)
  FROM "listings" l
  LEFT JOIN "reservations" r
    ON r."listing_id" = l."id"
  LEFT JOIN "simulated_payments" sp
    ON sp."reservation_id" = r."id"
   AND sp."status" = 'APROBADO'
   AND sp."created_at" >= p_from
   AND sp."created_at" < p_to
  WHERE l."landlord_id" = p_landlord_id
  GROUP BY l."id", l."name", l."is_active"
  ORDER BY l."name", l."id";
$$;
