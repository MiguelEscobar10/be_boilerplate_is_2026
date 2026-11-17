import { motivoSinEscritura } from './reservation-conversation.rules.js';
import { conflictoConversacion } from './messaging.errors.js';

describe('motivoSinEscritura (BE-16.1)', () => {
  it.each(['CONFIRMADA', 'EN_CURSO'] as const)('%s deja escribir', (status) => {
    expect(motivoSinEscritura(status)).toBeNull();
  });

  it('PENDIENTE todavía no habilita la conversación', () => {
    expect(motivoSinEscritura('PENDIENTE')).toBe('CONVERSACION_NO_HABILITADA');
  });

  it.each(['RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
    '%s cierra la conversación',
    (status) => {
      expect(motivoSinEscritura(status)).toBe('CONVERSACION_CERRADA');
    },
  );

  it('el 409 lleva el código y el formato de error de siempre', () => {
    const error = conflictoConversacion('CONVERSACION_CERRADA');

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      codigo: 'CONVERSACION_CERRADA',
    });
  });
});
