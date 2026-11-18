import { ConflictException } from '@nestjs/common';

export const SOLICITUD_YA_DECIDIDA = 'SOLICITUD_YA_DECIDIDA';
export const CONFLICTO_DISPONIBILIDAD = 'CONFLICTO_DISPONIBILIDAD';

/** Por qué no se pudo guardar una decisión dentro de la transacción. */
export type DecisionConflictReason =
  /** La solicitud ya no está PENDIENTE (otra petición la decidió antes). */
  | 'YA_DECIDIDA'
  /** Otra reserva CONFIRMADA o EN_CURSO ocupa esas fechas. */
  | 'RESERVA_TRASLAPADA'
  /** El arrendador bloqueó esas fechas (H14). */
  | 'FECHAS_BLOQUEADAS';

/**
 * Error de dominio que lanza el repositorio cuando la decisión no se puede
 * guardar. El servicio lo traduce a un 409.
 */
export class DecisionConflictError extends Error {
  constructor(public readonly reason: DecisionConflictReason) {
    super(`No se pudo guardar la decisión: ${reason}`);
    this.name = 'DecisionConflictError';
  }
}

/**
 * 409: la solicitud ya fue aprobada o rechazada. Lleva `codigo` para que el
 * frontend lo distinga del conflicto de fechas sin leer el mensaje.
 */
export class SolicitudYaDecididaException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'Conflict',
      codigo: SOLICITUD_YA_DECIDIDA,
      message: 'Esta solicitud no se puede modificar.',
    });
  }
}

/** 409: aprobar chocaría con una reserva confirmada o con un bloqueo. */
export class ConflictoDisponibilidadException extends ConflictException {
  constructor(reason: 'RESERVA_TRASLAPADA' | 'FECHAS_BLOQUEADAS') {
    super({
      statusCode: 409,
      error: 'Conflict',
      codigo: CONFLICTO_DISPONIBILIDAD,
      message:
        reason === 'RESERVA_TRASLAPADA'
          ? 'Conflicto de disponibilidad: ya confirmaste otra reserva en esas fechas.'
          : 'Conflicto de disponibilidad: bloqueaste esas fechas.',
    });
  }
}
