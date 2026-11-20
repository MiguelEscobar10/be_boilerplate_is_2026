import { Injectable } from '@nestjs/common';
import type { Prisma } from '@PrismaClient';
import { PrismaService } from '@Prisma/services';

/** Ingreso de un bien en el rango, tal como lo da `listing_income`. */
export interface ListingIncomeRow {
  listingId: string;
  name: string;
  isActive: boolean;
  /** Siempre con 2 decimales; `0.00` si no hubo pagos APROBADO. */
  income: Prisma.Decimal;
}

/**
 * Lee la función SQL `listing_income` de DB-21.1 (ver docs/modulos/pagos.md).
 * La suma la hace la base; aquí solo se renombran las columnas.
 */
@Injectable()
export class IncomeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bienes del arrendador con su ingreso en `[from, to)`, en UTC, ordenados
   * por nombre e id.
   */
  async forLandlord(
    landlordId: string,
    from: Date,
    to: Date,
  ): Promise<ListingIncomeRow[]> {
    const rows = await this.prisma.$queryRaw<
      {
        listing_id: string;
        listing_name: string;
        is_active: boolean;
        income: Prisma.Decimal;
      }[]
    >`SELECT listing_id, listing_name, is_active, income
      FROM listing_income(${landlordId}::uuid, ${from}::timestamp, ${to}::timestamp)`;
    return rows.map((r) => ({
      listingId: r.listing_id,
      name: r.listing_name,
      isActive: r.is_active,
      income: r.income,
    }));
  }
}
