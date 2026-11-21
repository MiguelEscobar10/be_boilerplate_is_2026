import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const RESERVA_YA_CALIFICADA = 'RESERVA_YA_CALIFICADA';
export const RESERVA_NO_COMPLETADA = 'RESERVA_NO_COMPLETADA';

/**
 * Error de dominio que lanza el repositorio cuando el índice único de
 * `listing_landlord_ratings.reservation_id` rechaza una segunda calificación.
 * El servicio lo traduce a 409.
 */
export class ListingRatingAlreadyExistsError extends Error {
  constructor() {
    super('La reserva ya tiene una calificación del bien y del arrendador.');
    this.name = 'ListingRatingAlreadyExistsError';
  }
}

/** 409: la reserva ya fue calificada. */
export class ReservaYaCalificadaException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      codigo: RESERVA_YA_CALIFICADA,
      message: 'Ya calificaste esta reserva.',
    });
  }
}

/** 422: regla de negocio, la reserva no terminó. */
export class ReservaNoCompletadaException extends UnprocessableEntityException {
  constructor() {
    super({
      statusCode: 422,
      error: 'Unprocessable Entity',
      codigo: RESERVA_NO_COMPLETADA,
      message: 'Solo puedes calificar una reserva COMPLETADA.',
    });
  }
}

/**
 * 404 de la consulta: la reserva es del usuario pero todavía no la calificó.
 * Es el único 404 con `codigo`: si la reserva no existe o es de otro, el 404
 * es el de siempre, sin `codigo`, para no revelar nada.
 */
export class CalificacionNoRegistradaException extends NotFoundException {
  constructor() {
    super({
      statusCode: 404,
      error: 'Not Found',
      codigo: 'CALIFICACION_NO_REGISTRADA',
      message: 'Aún no calificaste esta reserva.',
    });
  }
}
