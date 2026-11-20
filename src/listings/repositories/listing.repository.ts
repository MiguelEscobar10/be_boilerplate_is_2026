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
    page,
    limit,
  }: ListingSearch): Promise<{ items: ListingSummaryRow[]; total: number }> {
    // `%`, `_` y `\` del usuario se buscan como texto, no como comodines.
    const pattern = text?.replace(/[\\%_]/g, '\\$&');
    const where = pattern
      ? Prisma.sql`l.is_active AND (
          search_text(l.name) LIKE '%' || search_text(${pattern}) || '%'
          OR search_text(l.description) LIKE '%' || search_text(${pattern}) || '%')`
      : Prisma.sql`l.is_active`;

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
