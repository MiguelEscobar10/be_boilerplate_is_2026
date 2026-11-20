import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTenantRatingDto,
  TenantRatingCreatedDto,
} from '@TenantRatings/dto';
import {
  RatingAlreadyExistsError,
  ReservaNoCompletadaException,
  ReservaYaCalificadaException,
} from '@TenantRatings/errors';
import { TenantRatingRepository } from '@TenantRatings/repositories';

/** Calificación del arrendatario (H18). */
@Injectable()
export class TenantRatingsService {
  constructor(private readonly ratings: TenantRatingRepository) {}

  /**
   * El arrendador dueño del bien califica al arrendatario de una reserva
   * COMPLETADA.
   *
   * @throws {NotFoundException} si la reserva no existe o es de un bien de
   *   otro arrendador (la ficha pide 404 en los dos casos).
   * @throws {ReservaNoCompletadaException} 422 si no está COMPLETADA.
   * @throws {ReservaYaCalificadaException} 409 si ya fue calificada.
   */
  async rate(
    reservationId: string,
    landlordId: string,
    { puntaje, comentario }: CreateTenantRatingDto,
  ): Promise<TenantRatingCreatedDto> {
    const reservation = await this.ratings.findReservation(reservationId);
    if (!reservation || reservation.landlordId !== landlordId) {
      throw new NotFoundException('La reserva no existe.');
    }
    if (reservation.status !== 'COMPLETADA') {
      throw new ReservaNoCompletadaException();
    }

    try {
      const rating = await this.ratings.create({
        reservationId,
        authorId: landlordId,
        // Se copia de la reserva: el arrendatario no viene en el body.
        tenantId: reservation.tenantId,
        score: puntaje,
        // El DTO ya lo recortó; un comentario vacío es "sin comentario".
        comment: comentario ? comentario : null,
      });
      return { id: rating.id };
    } catch (error) {
      if (error instanceof RatingAlreadyExistsError) {
        throw new ReservaYaCalificadaException();
      }
      throw error;
    }
  }
}
