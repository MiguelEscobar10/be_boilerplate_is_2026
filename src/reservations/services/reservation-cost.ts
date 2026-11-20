import { Prisma, type RateUnit } from '@PrismaClient';

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const SEMANA_MS = 7 * DIA_MS;

/** Lo que cabe en DECIMAL(12,2): 10 dígitos enteros. */
const COSTO_MAXIMO = new Prisma.Decimal('9999999999.99');

const UNIDAD_MS: Record<RateUnit, number> = {
  HORA: HORA_MS,
  DIA: DIA_MS,
  NOCHE: DIA_MS,
  SEMANA: SEMANA_MS,
};

/**
 * Unidades de cobro del período (H03): HORA en horas, DIA y NOCHE en días de
 * 24 horas y SEMANA en semanas de 7 días. Una fracción se redondea hacia
 * arriba y el mínimo es 1 unidad.
 */
export function chargeUnits(
  startAt: Date,
  endAt: Date,
  unit: RateUnit,
): number {
  const units = Math.ceil(
    (endAt.getTime() - startAt.getTime()) / UNIDAD_MS[unit],
  );
  return Math.max(1, units);
}

/**
 * Costo estimado = tarifa × unidades de cobro, con dos decimales. La cuenta
 * se hace con Decimal para que `15.10 × 3` dé `45.30` y no `45.300000000004`.
 * El depósito no entra: se guarda aparte.
 */
export function rentalCost(
  rate: string | number | Prisma.Decimal,
  unit: RateUnit,
  startAt: Date,
  endAt: Date,
): Prisma.Decimal {
  return new Prisma.Decimal(rate)
    .mul(chargeUnits(startAt, endAt, unit))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** `true` si el costo no cabe en la columna (períodos absurdamente largos). */
export function costExceedsLimit(cost: Prisma.Decimal): boolean {
  return cost.gt(COSTO_MAXIMO);
}
