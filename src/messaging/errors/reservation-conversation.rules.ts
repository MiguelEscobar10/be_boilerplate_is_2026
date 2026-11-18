import type { ReservationStatus } from '@PrismaClient';
import type { CodigoErrorConversacion } from './messaging.errors.js';

/**
 * En qué estados de la reserva se puede escribir en su conversación (H16).
 *
 * CONFIRMADA habilita la conversación y EN_CURSO la mantiene (después de la
 * entrega de H08). PENDIENTE todavía no la habilita. RECHAZADA, CANCELADA y
 * COMPLETADA la cierran: ya no se escribe, pero el historial se sigue leyendo.
 *
 * Devuelve null si se puede escribir, o el código del 409 si no.
 */
export function motivoSinEscritura(
  status: ReservationStatus,
): CodigoErrorConversacion | null {
  switch (status) {
    case 'CONFIRMADA':
    case 'EN_CURSO':
      return null;
    case 'PENDIENTE':
      return 'CONVERSACION_NO_HABILITADA';
    case 'RECHAZADA':
    case 'CANCELADA':
    case 'COMPLETADA':
      return 'CONVERSACION_CERRADA';
  }
}
