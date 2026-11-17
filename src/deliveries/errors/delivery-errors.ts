import { UnprocessableEntityException } from '@nestjs/common';

export const ENTREGA_NO_HABILITADA = 'ENTREGA_NO_HABILITADA';

/**
 * Error de dominio: la reserva ya no se puede entregar (otra petición la
 * entregó o cambió de estado entre la lectura y la transacción). El servicio
 * lo traduce a 409.
 */
export class DeliveryConflictError extends Error {
  constructor(public readonly reason: 'YA_ENTREGADA' | 'NO_CONFIRMADA') {
    super(
      reason === 'YA_ENTREGADA'
        ? 'La reserva ya tiene una entrega registrada.'
        : 'La reserva no está CONFIRMADA.',
    );
    this.name = 'DeliveryConflictError';
  }
}

/**
 * 422 cuando todavía no llega la fecha y hora de inicio de la reserva (H08).
 * Lleva `codigo` además del formato de Nest, y `disponibleDesde` para que el
 * frontend diga desde cuándo se podrá registrar.
 */
export class EntregaNoHabilitadaException extends UnprocessableEntityException {
  constructor(disponibleDesde: Date) {
    super({
      statusCode: 422,
      error: 'Unprocessable Entity',
      codigo: ENTREGA_NO_HABILITADA,
      message: `Todavía no podés registrar la entrega: se habilita desde el inicio de la reserva (${disponibleDesde.toISOString()}).`,
      disponibleDesde: disponibleDesde.toISOString(),
    });
  }
}
