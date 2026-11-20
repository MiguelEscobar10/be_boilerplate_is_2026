import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';

/** Totales de un bien en el período, tal como los da `landlord_occupancy`. */
export interface ListingOccupancyRow {
  listingId: string;
  name: string;
  periodDays: number;
  blockedDays: number;
  occupiedDays: number;
}

/**
 * Lee la consulta de días ocupados y bloqueados de DB-22.1 (función SQL
 * `landlord_occupancy`). Ver docs/modulos/reportes.md.
 */
@Injectable()
export class OccupancyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async forLandlord(
    landlordId: string,
    from: string,
    to: string,
  ): Promise<ListingOccupancyRow[]> {
    const rows = await this.prisma.$queryRaw<
      {
        listing_id: string;
        listing_name: string;
        period_days: number;
        blocked_days: number;
        occupied_days: number;
      }[]
    >`SELECT * FROM landlord_occupancy(${landlordId}::uuid, ${from}::date, ${to}::date)`;
    return rows.map((r) => ({
      listingId: r.listing_id,
      name: r.listing_name,
      periodDays: r.period_days,
      blockedDays: r.blocked_days,
      occupiedDays: r.occupied_days,
    }));
  }
}
