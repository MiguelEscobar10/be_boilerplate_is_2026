import { ModuloOrigen, type Aviso } from '@Notifications';

const ZONA_HORARIA = 'America/El_Salvador';

const FECHA = new Intl.DateTimeFormat('es-SV', {
  timeZone: ZONA_HORARIA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Instante → `12/11/2026 09:00`, en hora de El Salvador. */
export function formatLocalDateTime(instant: Date): string {
  const parts = Object.fromEntries(
    FECHA.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export interface RequestedReservation {
  id: string;
  landlordId: string;
  listingName: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Aviso para el arrendador cuando llega una solicitud (H03, criterio 7):
 * título fijo "Nueva solicitud de reserva" y un mensaje con el bien y las
 * fechas. No lleva datos del arrendatario más allá de lo que ya ve en su panel.
 */
export function buildRequestNotice(reservation: RequestedReservation): Aviso {
  return {
    destinatarioId: reservation.landlordId,
    titulo: 'Nueva solicitud de reserva',
    mensaje: `Solicitud de «${reservation.listingName}» del ${formatLocalDateTime(reservation.startAt)} al ${formatLocalDateTime(reservation.endAt)}.`,
    moduloOrigen: ModuloOrigen.RESERVAS,
    referencia: { tipo: 'reserva', id: reservation.id },
  };
}
