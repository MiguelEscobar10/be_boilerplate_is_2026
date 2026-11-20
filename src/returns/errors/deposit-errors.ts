import { UnprocessableEntityException } from '@nestjs/common';

export const DEVOLUCION_NO_REGISTRADA = 'DEVOLUCION_NO_REGISTRADA';
export const RETENCION_SUPERA_DEPOSITO = 'RETENCION_SUPERA_DEPOSITO';
export const RETENCION_SIN_OBSERVACIONES = 'RETENCION_SIN_OBSERVACIONES';

export type CodigoGarantia =
  | typeof DEVOLUCION_NO_REGISTRADA
  | typeof RETENCION_SUPERA_DEPOSITO
  | typeof RETENCION_SIN_OBSERVACIONES;

/** Mensajes que H09 pide mostrarle al arrendador. */
const MENSAJES: Record<CodigoGarantia, string> = {
  DEVOLUCION_NO_REGISTRADA: 'Primero registra la devolución',
  RETENCION_SUPERA_DEPOSITO: 'El monto retenido no puede superar el depósito',
  RETENCION_SIN_OBSERVACIONES:
    'No se puede retener la garantía de una devolución sin observaciones',
};

/**
 * 422 de la resolución de la garantía (H09). Lleva `codigo` además del
 * formato de Nest, para que el frontend distinga los tres casos.
 */
export class GarantiaNoResolubleException extends UnprocessableEntityException {
  constructor(codigo: CodigoGarantia) {
    super({
      statusCode: 422,
      error: 'Unprocessable Entity',
      codigo,
      message: MENSAJES[codigo],
    });
  }
}

/**
 * Error de dominio: la garantía ya no se puede resolver (otra petición la
 * resolvió o la reserva cambió de estado entre la lectura y la transacción).
 * El servicio lo traduce a 409.
 */
export class DepositConflictError extends Error {
  constructor(public readonly reason: 'YA_RESUELTA' | 'NO_EN_CURSO') {
    super(
      reason === 'YA_RESUELTA'
        ? 'La garantía de la reserva ya está resuelta.'
        : 'La reserva no está EN_CURSO.',
    );
    this.name = 'DepositConflictError';
  }
}
