import { BadRequestException, Injectable } from '@nestjs/common';
import type { OccupancyReportDto } from '@Reports/dto';
import { OccupancyRepository } from '@Reports/repositories';

/** Rango máximo del reporte, en días (fechas inclusivas). */
export const MAX_RANGE_DAYS = 366;
export const ZONA_HORARIA = 'America/El_Salvador';
const DAY_MS = 86_400_000;

/** `AAAA-MM-DD` → milisegundos UTC de ese día, o null si la fecha no existe. */
function parseDay(value: string): number | null {
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

/** Porcentaje con un decimal; 0 si no hay días disponibles. */
export function occupancyRate(occupied: number, available: number): number {
  if (available <= 0) return 0;
  return Math.round((occupied / available) * 1000) / 10;
}

/** Reportes del arrendador (H22). */
@Injectable()
export class ReportsService {
  constructor(private readonly occupancy: OccupancyRepository) {}

  /**
   * Tasa de ocupación de los bienes del arrendador en el período. Sin fechas,
   * usa el mes en curso; con una sola, la otra sale del mes en curso.
   */
  async occupancyFor(
    landlordId: string,
    query: { desde?: string; hasta?: string },
    now = new Date(),
  ): Promise<OccupancyReportDto> {
    const month = currentMonth(now);
    const desde = query.desde ?? month.desde;
    const hasta = query.hasta ?? month.hasta;

    const from = parseDay(desde);
    if (from === null) {
      throw new BadRequestException(`La fecha desde (${desde}) no existe.`);
    }
    const to = parseDay(hasta);
    if (to === null) {
      throw new BadRequestException(`La fecha hasta (${hasta}) no existe.`);
    }
    if (from > to) {
      throw new BadRequestException(
        'La fecha desde no puede ser posterior a hasta.',
      );
    }
    if ((to - from) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango puede tener como máximo ${MAX_RANGE_DAYS} días.`,
      );
    }

    const rows = await this.occupancy.forLandlord(landlordId, desde, hasta);
    return {
      desde,
      hasta,
      items: rows.map((r) => {
        const diasDisponibles = r.periodDays - r.blockedDays;
        return {
          publicacionId: r.listingId,
          nombre: r.name,
          diasOcupados: r.occupiedDays,
          diasDisponibles,
          tasaOcupacion: occupancyRate(r.occupiedDays, diasDisponibles),
        };
      }),
    };
  }
}
