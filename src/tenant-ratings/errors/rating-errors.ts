import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const RESERVA_YA_CALIFICADA = 'RESERVA_YA_CALIFICADA';
export const RESERVA_NO_COMPLETADA = 'RESERVA_NO_COMPLETADA';

/**
 * Error de dominio que lanza el repositorio cuando el índice único de
 * `tenant_ratings.reservation_id` rechaza una segunda calificación. El
 * servicio lo traduce a 409.
 */
export class RatingAlreadyExistsError extends Error {
  constructor() {
    super('La reserva ya tiene una calificación del arrendatario.');
    this.name = 'RatingAlreadyExistsError';
  }
}

/** 409 de H18, criterio 3. */
export class ReservaYaCalificadaException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      codigo: RESERVA_YA_CALIFICADA,
      message: 'Esta reserva ya fue calificada.',
    });
  }
}

/** 422 de H18, criterio 2: regla de negocio, la reserva no terminó. */
export class ReservaNoCompletadaException extends UnprocessableEntityException {
  constructor() {
    super({
      statusCode: 422,
      error: 'Unprocessable Entity',
      codigo: RESERVA_NO_COMPLETADA,
      message:
        'Solo puedes calificar al arrendatario de una reserva COMPLETADA.',
    });
  }
}
