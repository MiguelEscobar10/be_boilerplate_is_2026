import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
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
}
