import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AvisosService } from '@Notifications/services';
import { ModuloOrigen } from '@Notifications/types';
import type { Reservation } from '@PrismaClient';
import {
  CONFLICTO_DISPONIBILIDAD,
  ConflictoDisponibilidadException,
  DecisionConflictError,
  SOLICITUD_YA_DECIDIDA,
  SolicitudYaDecididaException,
} from '@ReservationDecisions/errors';
import type {
  ReservationDecisionRepository,
  ReservationForDecision,
} from '@ReservationDecisions/repositories';
import {
  buildDecisionNotice,
  formatLocalDateTime,
  ReservationDecisionsService,
} from '@ReservationDecisions/services';

const RESERVA = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';
const ARRENDADOR = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const OTRO_ARRENDADOR = '11111111-2222-4333-8444-555555555555';
const ARRENDATARIO = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PUBLICACION = '7c1e0f3a-2b4d-4c6e-8f90-a1b2c3d4e5f6';
// 12 de noviembre, de 09:00 a 12:00 en El Salvador.
const INICIO = new Date('2026-11-12T15:00:00.000Z');
const FIN = new Date('2026-11-12T18:00:00.000Z');
const AHORA = new Date('2026-11-10T20:00:00.000Z');

function pendiente(
  cambios: Partial<ReservationForDecision> = {},
): ReservationForDecision {
  return {
    id: RESERVA,
    status: 'PENDIENTE',
    tenantId: ARRENDATARIO,
    startAt: INICIO,
    endAt: FIN,
    listing: { id: PUBLICACION, landlordId: ARRENDADOR, name: 'Taladro' },
    ...cambios,
  };
}

/** La reserva como la devuelve el repositorio después de decidir. */
function decidida(
  status: 'CONFIRMADA' | 'RECHAZADA',
  rejectionReason: string | null = null,
): Reservation {
  return {
    id: RESERVA,
    status,
    decidedAt: AHORA,
    decidedById: ARRENDADOR,
    rejectionReason,
  } as Reservation;
}

describe('formatLocalDateTime', () => {
  it('muestra la fecha y la hora de El Salvador', () => {
    expect(formatLocalDateTime(INICIO)).toBe('12/11/2026 09:00');
  });

  it('una madrugada en UTC cae en el día anterior local', () => {
    expect(formatLocalDateTime(new Date('2026-12-01T03:30:00.000Z'))).toBe(
      '30/11/2026 21:30',
    );
  });

  it('la medianoche local es 00:00, no 24:00', () => {
    expect(formatLocalDateTime(new Date('2026-11-20T06:00:00.000Z'))).toBe(
      '20/11/2026 00:00',
    );
  });
});

describe('buildDecisionNotice', () => {
  const reserva = {
    id: RESERVA,
    tenantId: ARRENDATARIO,
    listingName: 'Taladro',
    startAt: INICIO,
    endAt: FIN,
  };

  it('CONFIRMADA: avisa al arrendatario con el bien y las fechas', () => {
    expect(buildDecisionNotice(reserva, 'CONFIRMADA', null)).toEqual({
      destinatarioId: ARRENDATARIO,
      titulo: 'Reserva CONFIRMADA',
      mensaje:
        'Tu reserva de «Taladro» del 12/11/2026 09:00 al 12/11/2026 12:00 fue confirmada.',
      moduloOrigen: ModuloOrigen.RESERVAS,
      referencia: { tipo: 'reserva', id: RESERVA },
    });
  });

  it('RECHAZADA sin motivo', () => {
    const aviso = buildDecisionNotice(reserva, 'RECHAZADA', null);

    expect(aviso.titulo).toBe('Reserva RECHAZADA');
    expect(aviso.mensaje).toBe(
      'Tu reserva de «Taladro» del 12/11/2026 09:00 al 12/11/2026 12:00 fue rechazada.',
    );
  });

  it('RECHAZADA con motivo: lo agrega al mensaje', () => {
    const aviso = buildDecisionNotice(
      reserva,
      'RECHAZADA',
      'Fechas no disponibles',
    );

    expect(aviso.mensaje).toBe(
      'Tu reserva de «Taladro» del 12/11/2026 09:00 al 12/11/2026 12:00 fue rechazada. Motivo: Fechas no disponibles',
    );
  });

  it('un motivo de 500 caracteres se recorta para que el mensaje quepa en 500', () => {
    const aviso = buildDecisionNotice(reserva, 'RECHAZADA', 'ñ'.repeat(500));

    expect(Array.from(aviso.mensaje)).toHaveLength(500);
    expect(aviso.mensaje.endsWith('…')).toBe(true);
  });

  it('con el nombre de bien más largo (100) y el motivo más largo el mensaje sigue cabiendo', () => {
    const aviso = buildDecisionNotice(
      { ...reserva, listingName: 'B'.repeat(100) },
      'RECHAZADA',
      '😀'.repeat(500),
    );

    expect(Array.from(aviso.mensaje).length).toBeLessThanOrEqual(500);
  });

  it('no pone el motivo en una CONFIRMADA aunque llegue', () => {
    const aviso = buildDecisionNotice(reserva, 'CONFIRMADA', 'No aplica');

    expect(aviso.mensaje).not.toContain('Motivo');
  });
});

describe('ReservationDecisionsService', () => {
  let repo: {
    findForDecision: ReturnType<typeof vi.fn>;
    findPageForLandlord: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
  };
  let avisos: { notificar: ReturnType<typeof vi.fn> };
  let service: ReservationDecisionsService;

  const decidir = (
    dto: { decision: 'APROBAR' | 'RECHAZAR'; motivo?: string },
    landlordId = ARRENDADOR,
  ) => service.decide(RESERVA, landlordId, dto, AHORA);

  beforeEach(() => {
    repo = {
      findForDecision: vi.fn().mockResolvedValue(pendiente()),
      findPageForLandlord: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      approve: vi.fn().mockResolvedValue(decidida('CONFIRMADA')),
      reject: vi.fn().mockResolvedValue(decidida('RECHAZADA')),
    };
    avisos = { notificar: vi.fn().mockResolvedValue({ id: 'aviso-1' }) };
    service = new ReservationDecisionsService(
      repo as unknown as ReservationDecisionRepository,
      avisos as unknown as AvisosService,
    );
    // Los casos de error del aviso escriben en el log: se silencia.
    vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('aprobar', () => {
    it('confirma, registra quién y cuándo, y devuelve el nuevo estado', async () => {
      const result = await decidir({ decision: 'APROBAR' });

      expect(repo.approve).toHaveBeenCalledWith(pendiente(), ARRENDADOR, AHORA);
      expect(repo.reject).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: RESERVA,
        estado: 'CONFIRMADA',
        decididaAt: AHORA,
        motivoRechazo: null,
      });
    });

    it('avisa al arrendatario "Reserva CONFIRMADA" con la referencia a la reserva', async () => {
      await decidir({ decision: 'APROBAR' });

      expect(avisos.notificar).toHaveBeenCalledTimes(1);
      expect(avisos.notificar).toHaveBeenCalledWith({
        destinatarioId: ARRENDATARIO,
        titulo: 'Reserva CONFIRMADA',
        mensaje:
          'Tu reserva de «Taladro» del 12/11/2026 09:00 al 12/11/2026 12:00 fue confirmada.',
        moduloOrigen: ModuloOrigen.RESERVAS,
        referencia: { tipo: 'reserva', id: RESERVA },
      });
    });

    it('rechaza un motivo al aprobar, sin tocar la reserva', async () => {
      await expect(
        decidir({ decision: 'APROBAR', motivo: 'No aplica' }),
      ).rejects.toThrow(BadRequestException);

      expect(repo.findForDecision).not.toHaveBeenCalled();
      expect(repo.approve).not.toHaveBeenCalled();
    });

    it.each([
      ['RESERVA_TRASLAPADA', /ya confirmaste otra reserva en esas fechas/],
      ['FECHAS_BLOQUEADAS', /bloqueaste esas fechas/],
    ] as const)(
      'si las fechas están ocupadas (%s) responde 409 CONFLICTO_DISPONIBILIDAD y no avisa',
      async (reason, mensaje) => {
        repo.approve.mockRejectedValue(new DecisionConflictError(reason));

        const error = await decidir({ decision: 'APROBAR' }).catch(
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(ConflictoDisponibilidadException);
        const exception = error as ConflictoDisponibilidadException;
        expect(exception.getStatus()).toBe(409);
        expect(exception.getResponse()).toMatchObject({
          codigo: CONFLICTO_DISPONIBILIDAD,
          message: expect.stringMatching(mensaje) as string,
        });
        expect(avisos.notificar).not.toHaveBeenCalled();
      },
    );

    it('si otra petición la decidió durante la transacción responde 409 SOLICITUD_YA_DECIDIDA', async () => {
      repo.approve.mockRejectedValue(new DecisionConflictError('YA_DECIDIDA'));

      const error = await decidir({ decision: 'APROBAR' }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(SolicitudYaDecididaException);
      expect((error as SolicitudYaDecididaException).getResponse()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        codigo: SOLICITUD_YA_DECIDIDA,
        message: 'Esta solicitud no se puede modificar.',
      });
      expect(avisos.notificar).not.toHaveBeenCalled();
    });

    it('un error que no es de dominio se propaga tal cual', async () => {
      const caida = new Error('base caída');
      repo.approve.mockRejectedValue(caida);

      await expect(decidir({ decision: 'APROBAR' })).rejects.toBe(caida);
    });
  });

  describe('rechazar', () => {
    it('rechaza sin motivo', async () => {
      const result = await decidir({ decision: 'RECHAZAR' });

      expect(repo.reject).toHaveBeenCalledWith(
        RESERVA,
        ARRENDADOR,
        null,
        AHORA,
      );
      expect(repo.approve).not.toHaveBeenCalled();
      expect(result.estado).toBe('RECHAZADA');
      expect(result.motivoRechazo).toBeNull();
    });

    it('guarda el motivo, lo devuelve y lo pone en el aviso', async () => {
      repo.reject.mockResolvedValue(
        decidida('RECHAZADA', 'Fechas no disponibles'),
      );

      const result = await decidir({
        decision: 'RECHAZAR',
        motivo: 'Fechas no disponibles',
      });

      expect(repo.reject).toHaveBeenCalledWith(
        RESERVA,
        ARRENDADOR,
        'Fechas no disponibles',
        AHORA,
      );
      expect(result.motivoRechazo).toBe('Fechas no disponibles');
      expect(avisos.notificar).toHaveBeenCalledWith(
        expect.objectContaining({
          titulo: 'Reserva RECHAZADA',
          mensaje:
            'Tu reserva de «Taladro» del 12/11/2026 09:00 al 12/11/2026 12:00 fue rechazada. Motivo: Fechas no disponibles',
        }),
      );
    });

    it('un motivo vacío se guarda como sin motivo', async () => {
      // El DTO ya lo recortó: "   " llega como "".
      await decidir({ decision: 'RECHAZAR', motivo: '' });

      expect(repo.reject).toHaveBeenCalledWith(
        RESERVA,
        ARRENDADOR,
        null,
        AHORA,
      );
    });

    it('si otra petición la decidió antes responde 409 SOLICITUD_YA_DECIDIDA', async () => {
      repo.reject.mockRejectedValue(new DecisionConflictError('YA_DECIDIDA'));

      await expect(decidir({ decision: 'RECHAZAR' })).rejects.toThrow(
        SolicitudYaDecididaException,
      );
    });
  });

  describe('permisos y estado', () => {
    it('404 si la reserva no existe', async () => {
      repo.findForDecision.mockResolvedValue(null);

      await expect(decidir({ decision: 'APROBAR' })).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.approve).not.toHaveBeenCalled();
    });

    it.each(['APROBAR', 'RECHAZAR'] as const)(
      '403 si la publicación es de otro arrendador (%s)',
      async (decision) => {
        const error = await decidir({ decision }, OTRO_ARRENDADOR).catch(
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).message).toBe(
          'Esta solicitud no se puede modificar.',
        );
        expect(repo.approve).not.toHaveBeenCalled();
        expect(repo.reject).not.toHaveBeenCalled();
        expect(avisos.notificar).not.toHaveBeenCalled();
      },
    );

    it('el dueño se revisa antes que el estado: una ajena ya decidida es 403, no 409', async () => {
      repo.findForDecision.mockResolvedValue(
        pendiente({ status: 'CONFIRMADA' }),
      );

      await expect(
        decidir({ decision: 'APROBAR' }, OTRO_ARRENDADOR),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each([
      'CONFIRMADA',
      'RECHAZADA',
      'CANCELADA',
      'EN_CURSO',
      'COMPLETADA',
    ] as const)(
      '409 si la reserva ya está %s, sin llegar a la transacción',
      async (status) => {
        repo.findForDecision.mockResolvedValue(pendiente({ status }));

        await expect(decidir({ decision: 'RECHAZAR' })).rejects.toThrow(
          SolicitudYaDecididaException,
        );
        expect(repo.reject).not.toHaveBeenCalled();
        expect(avisos.notificar).not.toHaveBeenCalled();
      },
    );
  });

  describe('aviso', () => {
    it('si el aviso falla, la decisión igual se devuelve', async () => {
      avisos.notificar.mockRejectedValue(new Error('avisos caído'));

      const result = await decidir({ decision: 'APROBAR' });

      expect(result.estado).toBe('CONFIRMADA');
    });

    it('avisa después de guardar la decisión', async () => {
      const orden: string[] = [];
      repo.approve.mockImplementation(() => {
        orden.push('guardar');
        return Promise.resolve(decidida('CONFIRMADA'));
      });
      avisos.notificar.mockImplementation(() => {
        orden.push('avisar');
        return Promise.resolve({ id: 'aviso-1' });
      });

      await decidir({ decision: 'APROBAR' });

      expect(orden).toEqual(['guardar', 'avisar']);
    });
  });

  describe('listForLandlord', () => {
    const fila = {
      id: RESERVA,
      status: 'PENDIENTE' as const,
      startAt: INICIO,
      endAt: FIN,
      rentalCost: { toFixed: () => '45.00' },
      depositAmount: { toFixed: () => '20.00' },
      createdAt: AHORA,
      decidedAt: null,
      rejectionReason: null,
      listing: { id: PUBLICACION, name: 'Taladro' },
      tenant: {
        id: ARRENDATARIO,
        email: 'ana@test.local',
        profile: { name: 'Ana Martínez' },
      },
    };

    it('pasa el filtro y la paginación al repositorio y arma la página', async () => {
      repo.findPageForLandlord.mockResolvedValue({ items: [fila], total: 30 });

      const result = await service.listForLandlord(ARRENDADOR, {
        estado: 'PENDIENTE',
        page: 2,
        limit: 12,
      });

      expect(repo.findPageForLandlord).toHaveBeenCalledWith(ARRENDADOR, {
        status: 'PENDIENTE',
        page: 2,
        limit: 12,
      });
      expect(result).toEqual({
        items: [
          {
            id: RESERVA,
            estado: 'PENDIENTE',
            publicacion: { id: PUBLICACION, nombre: 'Taladro' },
            arrendatario: { id: ARRENDATARIO, nombre: 'Ana Martínez' },
            inicio: INICIO,
            fin: FIN,
            costoEstimado: '45.00',
            depositoMonto: '20.00',
            creadaAt: AHORA,
            decididaAt: null,
            motivoRechazo: null,
          },
        ],
        total: 30,
        page: 2,
        limit: 12,
      });
    });

    it('si el arrendatario no tiene perfil usa su correo como nombre', async () => {
      repo.findPageForLandlord.mockResolvedValue({
        items: [{ ...fila, tenant: { ...fila.tenant, profile: null } }],
        total: 1,
      });

      const result = await service.listForLandlord(ARRENDADOR, {
        page: 1,
        limit: 12,
      });

      expect(result.items[0].arrendatario.nombre).toBe('ana@test.local');
    });
  });
});
