import { ModuloOrigen, type Aviso } from '@Notifications';

/** Límite del mensaje de un aviso (contrato del servicio de avisos). */
const MENSAJE_MAX = 500;
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

export interface DecidedReservation {
  id: string;
  tenantId: string;
  listingName: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Aviso para el arrendatario cuando el arrendador decide (H04, criterio 8):
 * título fijo "Reserva CONFIRMADA" o "Reserva RECHAZADA" y un mensaje con el
 * bien, las fechas y el motivo si lo hay.
 *
 * El motivo admite 500 caracteres y el mensaje del aviso también, así que el
 * motivo se recorta con "…" cuando el mensaje completo no cabe. El motivo
 * entero queda en la reserva.
 */
export function buildDecisionNotice(
  reservation: DecidedReservation,
  estado: 'CONFIRMADA' | 'RECHAZADA',
  motivo: string | null,
): Aviso {
  const fechas = `del ${formatLocalDateTime(reservation.startAt)} al ${formatLocalDateTime(reservation.endAt)}`;
  const base = `Tu reserva de «${reservation.listingName}» ${fechas} fue ${
    estado === 'CONFIRMADA' ? 'confirmada' : 'rechazada'
  }.`;

  let mensaje = base;
  if (estado === 'RECHAZADA' && motivo) {
    const prefijo = `${base} Motivo: `;
    // Se cuentan caracteres (code points), como hace el servicio de avisos.
    const disponible = MENSAJE_MAX - Array.from(prefijo).length;
    const letras = Array.from(motivo);
    mensaje =
      prefijo +
      (letras.length <= disponible
        ? motivo
        : `${letras.slice(0, disponible - 1).join('')}…`);
  }

  return {
    destinatarioId: reservation.tenantId,
    titulo: `Reserva ${estado}`,
    mensaje,
    moduloOrigen: ModuloOrigen.RESERVAS,
    referencia: { tipo: 'reserva', id: reservation.id },
  };
}
