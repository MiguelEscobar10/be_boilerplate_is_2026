/**
 * Ejemplos de llamada al servicio de avisos, uno por módulo emisor.
 *
 * Son la fuente de los ejemplos de docs/contratos/servicio-avisos.md: el
 * código de cada bloque del documento es idéntico al de este archivo. Importan
 * solo desde `@Notifications`, como lo haría cualquier otro módulo, así que si
 * el contrato cambia de forma, este archivo deja de compilar. Los ejecuta
 * test/contratos/servicio-avisos.contrato.spec.ts.
 *
 * Los parámetros de entrada (reserva, pago, garantía, mensaje) son formas
 * mínimas: cada módulo usa sus propias entidades.
 */
import {
  AvisoInvalidoError,
  AvisosService,
  ModuloOrigen,
  type Aviso,
  type AvisoRegistrado,
} from '@Notifications';

// --- BE-03.1 · Reservas: solicitud nueva (H03) -----------------------------
export function avisarSolicitudNueva(
  avisos: AvisosService,
  reserva: { id: string; arrendadorId: string; bienNombre: string },
): Promise<AvisoRegistrado> {
  return avisos.notificar({
    destinatarioId: reserva.arrendadorId,
    titulo: 'Nueva solicitud de reserva',
    mensaje: `Recibiste una solicitud de reserva para «${reserva.bienNombre}».`,
    moduloOrigen: ModuloOrigen.RESERVAS,
    referencia: { tipo: 'reserva', id: reserva.id },
  });
}

// --- BE-04.1 · Confirmar o rechazar una reserva (H04) ----------------------
/** Largo máximo de `mensaje` en el contrato. */
const MENSAJE_MAX = 500;

const formatoFecha = new Intl.DateTimeFormat('es-SV', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/El_Salvador',
});

/** dd/mm/aaaa en la hora de El Salvador. */
function formatearFecha(fecha: Date): string {
  const partes = Object.fromEntries(
    formatoFecha.formatToParts(fecha).map(({ type, value }) => [type, value]),
  );
  return `${partes.day}/${partes.month}/${partes.year}`;
}

/**
 * Agrega " Motivo: <motivo>." recortando el motivo para que el mensaje completo
 * no pase de MENSAJE_MAX. Cuenta caracteres igual que AvisosService.
 */
function agregarMotivo(base: string, motivo?: string): string {
  const texto = motivo?.trim();
  if (!texto) return base;
  const prefijo = ' Motivo: ';
  // Lo que queda para el motivo, descontando el punto final.
  const libre = MENSAJE_MAX - Array.from(base + prefijo).length - 1;
  const caracteres = Array.from(texto);
  if (caracteres.length <= libre) return `${base}${prefijo}${texto}.`;
  if (libre < 2) return base;
  const recortado = caracteres.slice(0, libre - 1).join('').trimEnd();
  return `${base}${prefijo}${recortado}….`;
}

export function avisarDecisionReserva(
  avisos: AvisosService,
  reserva: {
    id: string;
    arrendatarioId: string;
    bienNombre: string;
    fechaInicio: Date;
    fechaFin: Date;
    /** Opcional, hasta 500 caracteres. */
    motivo?: string;
  },
  estado: 'CONFIRMADA' | 'RECHAZADA',
): Promise<AvisoRegistrado> {
  const resultado = estado === 'CONFIRMADA' ? 'confirmada' : 'rechazada';
  const inicio = formatearFecha(reserva.fechaInicio);
  const fin = formatearFecha(reserva.fechaFin);
  const base = `Tu reserva de «${reserva.bienNombre}» del ${inicio} al ${fin} fue ${resultado}.`;
  return avisos.notificar({
    destinatarioId: reserva.arrendatarioId,
    titulo: `Reserva ${estado}`,
    mensaje: agregarMotivo(base, reserva.motivo),
    moduloOrigen: ModuloOrigen.RESERVAS,
    referencia: { tipo: 'reserva', id: reserva.id },
  });
}

// --- BE-05.1 · Pagos: resultado del pago simulado (H05) --------------------
interface PagoParaAviso {
  /** Id del intento de pago (no de la reserva): ver "Elegir la referencia". */
  id: string;
  arrendatarioId: string;
  arrendadorId: string;
  bienNombre: string;
  /** Monto total de la reserva, en USD. */
  montoTotal: number;
}

/** Pago APROBADO: un aviso para el arrendatario y otro para el arrendador. */
export function avisarPagoAprobado(
  avisos: AvisosService,
  pago: PagoParaAviso,
): Promise<AvisoRegistrado[]> {
  const monto = `$${pago.montoTotal.toFixed(2)}`;
  const referencia = { tipo: 'pago', id: pago.id };
  return Promise.all([
    avisos.notificar({
      destinatarioId: pago.arrendatarioId,
      titulo: 'Pago aprobado',
      mensaje: `Tu pago de ${monto} por «${pago.bienNombre}» fue aprobado.`,
      moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
      referencia,
    }),
    avisos.notificar({
      destinatarioId: pago.arrendadorId,
      titulo: 'Pago confirmado',
      mensaje: `Se confirmó el pago de ${monto} de la reserva de «${pago.bienNombre}».`,
      moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
      referencia,
    }),
  ]);
}

/** Pago RECHAZADO: solo para el arrendatario. */
export function avisarPagoRechazado(
  avisos: AvisosService,
  pago: PagoParaAviso,
): Promise<AvisoRegistrado> {
  const monto = `$${pago.montoTotal.toFixed(2)}`;
  return avisos.notificar({
    destinatarioId: pago.arrendatarioId,
    titulo: 'Pago rechazado',
    mensaje: `Tu pago de ${monto} por «${pago.bienNombre}» fue rechazado. La reserva sigue confirmada y puedes intentar el pago de nuevo.`,
    moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
    referencia: { tipo: 'pago', id: pago.id },
  });
}

// --- BE-09.2 · Garantía resuelta (H09) -------------------------------------
export function avisarGarantiaResuelta(
  avisos: AvisosService,
  garantia: {
    id: string;
    arrendatarioId: string;
    bienNombre: string;
    estado: 'LIBERADA' | 'RETENIDA';
  },
): Promise<AvisoRegistrado> {
  const resultado = garantia.estado === 'LIBERADA' ? 'liberado' : 'retenido';
  return avisos.notificar({
    destinatarioId: garantia.arrendatarioId,
    titulo: 'Depósito de garantía resuelto',
    mensaje: `El depósito de garantía de «${garantia.bienNombre}» fue ${resultado}.`,
    moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
    referencia: { tipo: 'garantia', id: garantia.id },
  });
}

// --- BE-15.1 · Mensajería: mensaje nuevo (H15, H16) ------------------------
export function avisarMensajeNuevo(
  avisos: AvisosService,
  mensaje: {
    id: string;
    /** El otro participante de la conversación, no quien envía. */
    destinatarioId: string;
    bienNombre: string;
  },
): Promise<AvisoRegistrado> {
  return avisos.notificar({
    destinatarioId: mensaje.destinatarioId,
    titulo: 'Mensaje nuevo',
    // Sin el texto del mensaje: solo el nombre del bien.
    mensaje: `Tenés un mensaje nuevo sobre "${mensaje.bienNombre}".`,
    moduloOrigen: ModuloOrigen.MENSAJERIA,
    referencia: { tipo: 'mensaje', id: mensaje.id },
  });
}

// --- Manejo de errores -----------------------------------------------------
/**
 * Registra el aviso sin hacer fallar la operación que lo originó. Un
 * AvisoInvalidoError es un error de quien llama (un campo mal armado), así que
 * se reporta con el campo; cualquier otro error (p. ej. la base caída) se
 * propaga.
 */
export async function notificarSinInterrumpir(
  avisos: AvisosService,
  aviso: Aviso,
  reportar: (detalle: string) => void,
): Promise<AvisoRegistrado | null> {
  try {
    return await avisos.notificar(aviso);
  } catch (error) {
    if (error instanceof AvisoInvalidoError) {
      reportar(`${error.codigo} en ${error.campo}: ${error.message}`);
      return null;
    }
    throw error;
  }
}
