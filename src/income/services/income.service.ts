import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@PrismaClient';
import type { IncomeReportDto } from '@Income/dto';
import { IncomeRepository } from '@Income/repositories';
import { Clock } from './clock.js';

/** Rango máximo del reporte, en días (fechas inclusivas). */
export const MAX_RANGE_DAYS = 366;
export const ZONA_HORARIA = 'America/El_Salvador';
/** El Salvador es UTC−6 todo el año (sin horario de verano). */
const SV_OFFSET_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

/** `AAAA-MM-DD` → milisegundos UTC de ese día a las 00:00, o null si no existe. */
export function parseDay(value: string): number | null {
  const [y, m, d] = value.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y &&
    back.getUTCMonth() === m - 1 &&
    back.getUTCDate() === d
    ? ms
    : null;
}

const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Mes calendario que contiene `now` en la hora de El Salvador. */
export function currentMonth(now: Date): { desde: string; hasta: string } {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
  }).format(now); // AAAA-MM-DD
  const [y, m] = today.split('-').map(Number);
  return {
    desde: toDay(Date.UTC(y, m - 1, 1)),
    hasta: toDay(Date.UTC(y, m, 0)),
  };
}

/**
 * Días inclusivos en El Salvador → rango `[from, to)` en UTC para
 * `listing_income`: desde 00:00 SV y (hasta + 1 día) 00:00 SV.
 */
export function toUtcRange(
  fromDayMs: number,
  toDayMs: number,
): { from: Date; to: Date } {
  return {
    from: new Date(fromDayMs + SV_OFFSET_MS),
    to: new Date(toDayMs + DAY_MS + SV_OFFSET_MS),
  };
}

/** Reporte de ingresos del arrendador (H21). */
@Injectable()
export class IncomeService {
  constructor(
    private readonly income: IncomeRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Ingresos por bien del arrendador en el período. La fecha que falte sale
   * del mes en curso en hora de El Salvador.
   */
  async reportFor(
    landlordId: string,
    query: { desde?: string; hasta?: string },
  ): Promise<IncomeReportDto> {
    const month = currentMonth(this.clock.now());
    const desde = query.desde ?? month.desde;
    const hasta = query.hasta ?? month.hasta;

    const fromDay = parseDay(desde);
    if (fromDay === null) {
      throw new BadRequestException(`La fecha desde (${desde}) no existe.`);
    }
    const toDay = parseDay(hasta);
    if (toDay === null) {
      throw new BadRequestException(`La fecha hasta (${hasta}) no existe.`);
    }
    if (fromDay > toDay) {
      throw new BadRequestException(
        `La fecha desde (${desde}) no puede ser posterior a hasta (${hasta}).`,
      );
    }
    if ((toDay - fromDay) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango puede tener como máximo ${MAX_RANGE_DAYS} días.`,
      );
    }

    const { from, to } = toUtcRange(fromDay, toDay);
    const rows = await this.income.forLandlord(landlordId, from, to);

    // Los desactivados solo salen si tuvieron ingresos: así no se pierde
    // dinero del total y no se listan bienes que ya no se alquilan.
    const visible = rows.filter((r) => r.isActive || r.income.gt(0));
    const total = visible.reduce(
      (sum, r) => sum.plus(r.income),
      new Prisma.Decimal(0),
    );

    return {
      desde,
      hasta,
      moneda: 'USD',
      total: total.toFixed(2),
      porBien: visible.map((r) => ({
        publicacionId: r.listingId,
        nombre: r.name,
        ingreso: r.income.toFixed(2),
      })),
    };
  }
}
