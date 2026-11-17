import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Códigos de error con nombre de BE-05.1.
 *
 * El backend usa el formato de error por defecto de Nest y no tiene un filtro
 * global. Para no crear uno, estas excepciones se arman con un objeto como
 * cuerpo: Nest lo devuelve tal cual, así que la respuesta es el formato de
 * siempre (`statusCode`, `message`, `error`) más el campo `codigo`.
 *
 * Ningún mensaje lleva datos de la tarjeta.
 */
export type CodigoErrorPago =
  | 'TARJETA_NO_VALIDA'
  | 'RESERVA_NO_CONFIRMADA'
  | 'PAGO_YA_APROBADO'
  | 'PAGO_EN_PROCESO'
  | 'INTENTOS_AGOTADOS';

const MENSAJES: Record<CodigoErrorPago, string> = {
  TARJETA_NO_VALIDA:
    'La tarjeta no es válida para la pasarela de prueba. Usa una terminada en 4242 o 0002.',
  RESERVA_NO_CONFIRMADA: 'Solo se puede pagar una reserva CONFIRMADA.',
  PAGO_YA_APROBADO: 'La reserva ya tiene un pago aprobado.',
  PAGO_EN_PROCESO:
    'Ya hay un pago en proceso para esta reserva. Espera su resultado.',
  INTENTOS_AGOTADOS: 'Ya se usaron los 3 intentos de pago de esta reserva.',
};

/** Mensaje del 404: igual si la reserva no existe o es de otro usuario. */
export const RESERVA_NO_ENCONTRADA = 'La reserva no existe.';

export function tarjetaNoValida(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    message: MENSAJES.TARJETA_NO_VALIDA,
    error: 'Bad Request',
    codigo: 'TARJETA_NO_VALIDA',
  });
}

export function conflictoPago(
  codigo: Exclude<CodigoErrorPago, 'TARJETA_NO_VALIDA'>,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    message: MENSAJES[codigo],
    error: 'Conflict',
    codigo,
  });
}

export function reservaNoEncontrada(): NotFoundException {
  return new NotFoundException(RESERVA_NO_ENCONTRADA);
}
