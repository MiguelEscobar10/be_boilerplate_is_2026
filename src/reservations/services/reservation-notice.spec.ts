import { ModuloOrigen } from '@Notifications';
import {
  buildRequestNotice,
  formatLocalDateTime,
} from './reservation-notice.js';

describe('buildRequestNotice', () => {
  const notice = buildRequestNotice({
    id: 'r-1',
    landlordId: 'u-1',
    listingName: 'Taladro percutor',
    startAt: new Date('2026-11-12T15:00:00.000Z'),
    endAt: new Date('2026-11-12T18:00:00.000Z'),
  });

  it('avisa al arrendador con el título fijo del contrato', () => {
    expect(notice.destinatarioId).toBe('u-1');
    expect(notice.titulo).toBe('Nueva solicitud de reserva');
    expect(notice.moduloOrigen).toBe(ModuloOrigen.RESERVAS);
  });

  it('el mensaje lleva el bien y las fechas en hora local', () => {
    expect(notice.mensaje).toContain('Taladro percutor');
    expect(notice.mensaje).toContain('12/11/2026 09:00');
    expect(notice.mensaje).toContain('12/11/2026 12:00');
  });

  it('la referencia es la reserva y su id', () => {
    expect(notice.referencia).toEqual({ tipo: 'reserva', id: 'r-1' });
  });
});

describe('formatLocalDateTime', () => {
  it('la medianoche local es 00:00, no 24:00', () => {
    expect(formatLocalDateTime(new Date('2026-11-20T06:00:00.000Z'))).toBe(
      '20/11/2026 00:00',
    );
  });
});
