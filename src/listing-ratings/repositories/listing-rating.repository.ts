import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import {
  Prisma,
  type ListingLandlordRating,
  type ReservationStatus,
} from '@PrismaClient';
import { ListingRatingAlreadyExistsError } from '@ListingRatings/errors';

/** Lo que el servicio necesita de la reserva para decidir si se califica. */
export interface ReservationToRate {
  id: string;
  status: ReservationStatus;
  tenantId: string;
  listingId: string;
  landlordId: string;
}

export interface CreateListingRatingData {
  reservationId: string;
  authorId: string;
  listingId: string;
  landlordId: string;
  listingScore: number;
  landlordScore: number;
  comment: string | null;
}

/** Promedios crudos, ya con un decimal. */
export interface AveragesRow {
  listingAverage: number | null;
  landlordAverage: number | null;
}

/** Único punto del módulo que habla con `listing_landlord_ratings`. */
@Injectable()
export class ListingRatingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReservation(id: string): Promise<ReservationToRate | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tenantId: true,
        listingId: true,
        listing: { select: { landlordId: true } },
      },
    });
    if (!reservation) return null;
    return {
      id: reservation.id,
      status: reservation.status,
      tenantId: reservation.tenantId,
      listingId: reservation.listingId,
      landlordId: reservation.listing.landlordId,
    };
  }

  /**
   * Guarda la calificación. Que haya una sola por reserva lo garantiza el
   * índice único de DB-17.1, también si llegan dos envíos a la vez: no hace
   * falta consultar antes.
   *
   * @throws {ListingRatingAlreadyExistsError} si la reserva ya fue calificada.
   */
  async create(data: CreateListingRatingData): Promise<ListingLandlordRating> {
    try {
      return await this.prisma.listingLandlordRating.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ListingRatingAlreadyExistsError();
      }
      throw error;
    }
  }

  /** Calificación de una reserva, o null si todavía no tiene. */
  findByReservation(
    reservationId: string,
  ): Promise<ListingLandlordRating | null> {
    return this.prisma.listingLandlordRating.findUnique({
      where: { reservationId },
    });
  }

  /**
   * Promedio del bien (índice `listing_id`) y del arrendador dueño de esa
   * publicación (índice `landlord_id`), redondeados a un decimal en la base
   * (`ROUND` sobre numeric: .05 sube). `null` si no hay calificaciones.
   * Devuelve null si la publicación no existe.
   */
  async averages(listingId: string): Promise<AveragesRow | null> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { landlordId: true },
    });
    if (!listing) return null;

    const [bien, arrendador] = await Promise.all([
      this.prisma.$queryRaw<{ avg: number | null }[]>`
        SELECT ROUND(AVG(listing_score)::numeric, 1)::float8 AS avg
        FROM listing_landlord_ratings
        WHERE listing_id = ${listingId}::uuid`,
      this.prisma.$queryRaw<{ avg: number | null }[]>`
        SELECT ROUND(AVG(landlord_score)::numeric, 1)::float8 AS avg
        FROM listing_landlord_ratings
        WHERE landlord_id = ${listing.landlordId}::uuid`,
    ]);
    return {
      listingAverage: bien[0]?.avg ?? null,
      landlordAverage: arrendador[0]?.avg ?? null,
    };
  }
}
