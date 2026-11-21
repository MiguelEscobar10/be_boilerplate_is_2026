import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateListingRatingDto,
  ListingRatingCreatedDto,
  ListingRatingDetailDto,
  PromediosCalificacionDto,
} from '@ListingRatings/dto';
import {
  CalificacionNoRegistradaException,
  ListingRatingAlreadyExistsError,
  ReservaNoCompletadaException,
  ReservaYaCalificadaException,
} from '@ListingRatings/errors';
import { ListingRatingRepository } from '@ListingRatings/repositories';

/** Calificación del bien y del arrendador (H17). */
@Injectable()
export class ListingRatingsService {
  constructor(private readonly ratings: ListingRatingRepository) {}

  /**
   * El arrendatario de una reserva COMPLETADA califica el bien y al
   * arrendador.
   *
   * @throws {NotFoundException} si la reserva no existe o es de otro
   *   arrendatario (404 en los dos casos).
   * @throws {ReservaNoCompletadaException} 422 si no está COMPLETADA.
   * @throws {ReservaYaCalificadaException} 409 si ya fue calificada.
   */
  async rate(
    reservationId: string,
    tenantId: string,
    { puntajeBien, puntajeArrendador, comentario }: CreateListingRatingDto,
  ): Promise<ListingRatingCreatedDto> {
    const reservation = await this.ratings.findReservation(reservationId);
    if (!reservation || reservation.tenantId !== tenantId) {
      throw new NotFoundException('La reserva no existe.');
    }
    if (reservation.status !== 'COMPLETADA') {
      throw new ReservaNoCompletadaException();
    }

    try {
      const rating = await this.ratings.create({
        reservationId,
        authorId: tenantId,
        // Se copian de la reserva: no vienen en el body.
        listingId: reservation.listingId,
        landlordId: reservation.landlordId,
        listingScore: puntajeBien,
        landlordScore: puntajeArrendador,
        // El DTO ya lo recortó; un comentario vacío es "sin comentario".
        comment: comentario ? comentario : null,
      });
      return { id: rating.id };
    } catch (error) {
      if (error instanceof ListingRatingAlreadyExistsError) {
        throw new ReservaYaCalificadaException();
      }
      throw error;
    }
  }

  /**
   * La calificación que el arrendatario dejó en su reserva. Sirve para saber
   * si ya calificó (FE-17.1 oculta «Calificar» si existe).
   *
   * @throws {NotFoundException} si la reserva no existe o es de otro.
   * @throws {CalificacionNoRegistradaException} 404 con `codigo` si es suya y
   *   aún no la calificó.
   */
  async findRating(
    reservationId: string,
    tenantId: string,
  ): Promise<ListingRatingDetailDto> {
    const reservation = await this.ratings.findReservation(reservationId);
    if (!reservation || reservation.tenantId !== tenantId) {
      throw new NotFoundException('La reserva no existe.');
    }
    const rating = await this.ratings.findByReservation(reservationId);
    if (!rating) throw new CalificacionNoRegistradaException();
    return {
      id: rating.id,
      reservaId: rating.reservationId,
      puntajeBien: rating.listingScore,
      puntajeArrendador: rating.landlordScore,
      comentario: rating.comment,
      fechaRegistro: rating.createdAt.toISOString(),
    };
  }

  /**
   * Promedios con un decimal para el detalle de una publicación: del bien
   * (por publicación) y del arrendador (por arrendador). Cada uno es `null`
   * sin calificaciones; ambos lo son si la publicación no existe.
   *
   * Es lo que BE-12.1 usa para `promedioBien` y `promedioArrendador`.
   */
  async promedioCalificaciones(
    publicacionId: string,
  ): Promise<PromediosCalificacionDto> {
    const row = await this.ratings.averages(publicacionId);
    return {
      promedioBien: row?.listingAverage ?? null,
      promedioArrendador: row?.landlordAverage ?? null,
    };
  }
}
