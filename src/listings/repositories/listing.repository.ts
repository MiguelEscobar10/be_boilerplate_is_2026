import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { Prisma } from '@PrismaClient';
import type {
  Listing,
  ListingImage,
  ListingType,
  RateUnit,
} from '@PrismaClient';

export interface CreateListingData {
  landlordId: string;
  type: ListingType;
  name: string;
  description?: string;
  location: string;
  rateAmount: string;
  rateUnit: RateUnit;
  depositAmount?: string;
  conditions?: string;
  /** Rutas de las imágenes ya guardadas, en el orden en que se muestran. */
  imagePaths: string[];
}

export type ListingWithImages = Listing & { images: ListingImage[] };

/** Lo que muestra una tarjeta del catálogo. */
export interface ListingSummaryRow {
  id: string;
  name: string;
  type: ListingType;
  rateAmount: Prisma.Decimal;
  rateUnit: RateUnit;
  location: string;
  /** Posición de la fotografía principal, o null si no tiene. */
  imagePosition: number | null;
}

export interface ListingSearch {
  /** Texto a buscar; sin él, devuelve todas las activas. */
  text?: string;
  type?: ListingType;
  /** Texto que debe contener la ubicación. */
  location?: string;
  minRate?: number;
  maxRate?: number;
  /** Rango [from, to) en el que la publicación debe estar libre. */
  available?: { from: Date; to: Date };
  page: number;
  limit: number;
}

/** Único punto del módulo que habla con `listings` y `listing_images`. */
@Injectable()
export class ListingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea la publicación y sus imágenes en una sola operación. */
  create({ imagePaths, ...data }: CreateListingData): Promise<Listing> {
    return this.prisma.listing.create({
      data: {
        ...data,
        images: {
          create: imagePaths.map((path, position) => ({ path, position })),
        },
      },
    });
  }

  findActiveById(id: string): Promise<ListingWithImages | null> {
    return this.prisma.listing.findFirst({
      where: { id, isActive: true },
      include: { images: { orderBy: { position: 'asc' } } },
    });
  }

  findImage(listingId: string, position: number): Promise<ListingImage | null> {
    return this.prisma.listingImage.findFirst({
      where: { listingId, position, listing: { isActive: true } },
    });
  }

  /**
   * Página del catálogo público (H02): publicaciones activas cuyo nombre o
   * descripción contienen el texto, de la más reciente a la más antigua.
   *
   * Va en SQL porque la comparación usa `search_text` (minúsculas y sin
   * acentos), la misma expresión de los índices de DB-02.1.
   */
  async search({
    text,
    type,
    location,
    minRate,
    maxRate,
    available,
    page,
    limit,
  }: ListingSearch): Promise<{ items: ListingSummaryRow[]; total: number }> {
    // `%`, `_` y `\` del usuario se buscan como texto, no como comodines.
    const like = (value: string) =>
      Prisma.sql`'%' || search_text(${value.replace(/[\\%_]/g, '\\$&')}) || '%'`;

    const conditions = [Prisma.sql`l.is_active`];
    if (text) {
      conditions.push(Prisma.sql`(
        search_text(l.name) LIKE ${like(text)}
        OR search_text(l.description) LIKE ${like(text)})`);
    }
    if (type) conditions.push(Prisma.sql`l.type = ${type}::"ListingType"`);
    if (location) {
      conditions.push(
        Prisma.sql`search_text(l.location) LIKE ${like(location)}`,
      );
    }
    if (minRate !== undefined) {
      conditions.push(Prisma.sql`l.rate_amount >= ${minRate}::numeric`);
    }
    if (maxRate !== undefined) {
      conditions.push(Prisma.sql`l.rate_amount <= ${maxRate}::numeric`);
    }
    if (available) {
      // Libre en todo el rango: sin reservas CONFIRMADA o EN_CURSO ni
      // bloqueos que se crucen (misma regla que el calendario, DB-13.1).
      conditions.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM listing_busy_periods(
          l.id, ${available.from}::timestamp, ${available.to}::timestamp))`);
    }
    const where = Prisma.join(conditions, ' AND ');

    const [items, [{ total }]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<ListingSummaryRow[]>`
        SELECT l.id, l.name, l.type, l.location,
               l.rate_amount AS "rateAmount", l.rate_unit AS "rateUnit",
               (SELECT MIN(i.position) FROM listing_images i
                 WHERE i.listing_id = l.id) AS "imagePosition"
        FROM listings l
        WHERE ${where}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM listings l WHERE ${where}`,
    ]);
    return { items, total };
  }
}
