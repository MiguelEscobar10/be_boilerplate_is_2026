import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Códigos de error con nombre de la conversación de la reserva (BE-16.1).
 *
 * Mismo formato que los de pagos (BE-05.1): el cuerpo por defecto de Nest
 * (`statusCode`, `message`, `error`) más el campo `codigo`, sin filtro global.
 */
export type CodigoErrorConversacion =
  'CONVERSACION_NO_HABILITADA' | 'CONVERSACION_CERRADA';

const MENSAJES: Record<CodigoErrorConversacion, string> = {
  CONVERSACION_NO_HABILITADA:
    'La conversación se habilita cuando la reserva esté CONFIRMADA.',
  CONVERSACION_CERRADA:
    'La reserva ya terminó o no se aceptó: la conversación está cerrada. El historial sigue disponible.',
};

/** Mensaje del 404: igual si la reserva no existe o no participás en ella. */
export const RESERVA_NO_ENCONTRADA = 'La reserva no existe.';

export function conflictoConversacion(
  codigo: CodigoErrorConversacion,
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
