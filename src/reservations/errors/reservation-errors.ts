import { BadRequestException, ConflictException } from '@nestjs/common';

export const FECHA_PASADA = 'FECHA_PASADA';
export const PERIODO_NO_DISPONIBLE = 'PERIODO_NO_DISPONIBLE';

/** 400: el período empieza antes de este momento. */
export class FechaPasadaException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      error: 'Bad Request',
      codigo: FECHA_PASADA,
      message: 'La fecha de inicio ya pasó. Elige un inicio a partir de ahora.',
    });
  }
}

/**
 * 409: el período choca con una reserva CONFIRMADA o EN_CURSO o con un
 * bloqueo del arrendador. Un solo mensaje para los dos casos: el arrendatario
 * no tiene por qué saber si fue una reserva ajena o un bloqueo (ni su motivo).
 */
export class PeriodoNoDisponibleException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      codigo: PERIODO_NO_DISPONIBLE,
      message: 'El período elegido no está disponible. Elige otras fechas.',
    });
  }
}
