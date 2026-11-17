import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';

export type BusyPeriodSource = 'RESERVA' | 'BLOQUEO';

/** Período ocupado de una publicación, en UTC. */
export interface BusyPeriod {
  startAt: Date;
  endAt: Date;
  source: BusyPeriodSource;
}

interface BusyPeriodRow {
  start_at: Date;
  end_at: Date;
  source: BusyPeriodSource;
}

/** Único punto del módulo que consulta la disponibilidad en la base. */
@Injectable()
export class AvailabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Períodos ocupados de la publicación que se cruzan con [from, to), en
   * orden. Usa la función `listing_busy_periods` de DB-13.1: solo reservas
   * CONFIRMADA o EN_CURSO y bloqueos, sin datos de quién reservó ni el motivo
   * del bloqueo.
   */
  async findBusyPeriods(
    listingId: string,
    from: Date,
    to: Date,
  ): Promise<BusyPeriod[]> {
    const rows = await this.prisma.$queryRaw<BusyPeriodRow[]>`
      SELECT "start_at", "end_at", "source"
      FROM listing_busy_periods(
        ${listingId}::uuid, ${from}::timestamp, ${to}::timestamp)`;

    return rows.map((row) => ({
      startAt: row.start_at,
      endAt: row.end_at,
      source: row.source,
    }));
  }
}
