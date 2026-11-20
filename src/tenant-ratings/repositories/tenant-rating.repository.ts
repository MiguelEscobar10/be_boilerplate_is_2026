import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import {
  Prisma,
  type ReservationStatus,
  type TenantRating,
} from '@PrismaClient';
import { RatingAlreadyExistsError } from '@TenantRatings/errors';

/** Lo que el servicio necesita de la reserva para decidir si se califica. */
export interface ReservationToRate {
  id: string;
  status: ReservationStatus;
  tenantId: string;
  landlordId: string;
}

export interface CreateTenantRatingData {
  reservationId: string;
  authorId: string;
  tenantId: string;
  score: number;
  comment: string | null;
}

/** Único punto del módulo que habla con `tenant_ratings`. */
@Injectable()
export class TenantRatingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReservation(id: string): Promise<ReservationToRate | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tenantId: true,
        listing: { select: { landlordId: true } },
      },
    });
    if (!reservation) return null;
    return {
      id: reservation.id,
      status: reservation.status,
      tenantId: reservation.tenantId,
      landlordId: reservation.listing.landlordId,
    };
  }

  /**
   * Guarda la calificación. Que haya una sola por reserva lo garantiza el
   * índice único de DB-18.1, también si llegan dos envíos a la vez: no hace
   * falta consultar antes.
   *
   * @throws {RatingAlreadyExistsError} si la reserva ya fue calificada.
   */
  async create(data: CreateTenantRatingData): Promise<TenantRating> {
    try {
      return await this.prisma.tenantRating.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new RatingAlreadyExistsError();
      }
      throw error;
    }
  }
}
