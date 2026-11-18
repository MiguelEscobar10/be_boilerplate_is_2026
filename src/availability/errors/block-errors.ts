import { ConflictException } from '@nestjs/common';

export const RANGO_CON_RESERVA = 'RANGO_CON_RESERVA';

/**
 * Error de dominio que lanza el repositorio cuando el rango a bloquear se
 * cruza con una reserva CONFIRMADA o EN_CURSO. El servicio lo traduce a 409.
 */
export class BlockOverlapsReservationError extends Error {
  constructor() {
    super('El rango se cruza con una reserva CONFIRMADA o EN_CURSO.');
    this.name = 'BlockOverlapsReservationError';
  }
}

/** 409 de H14, criterio 3. Lleva `codigo` como los 409 de BE-04.1. */
export class RangoConReservaException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      codigo: RANGO_CON_RESERVA,
      message: 'El rango tiene una reserva CONFIRMADA o EN_CURSO.',
    });
  }
}
