import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReturnConflictError } from '@Returns/errors';
import type {
  ReservationForReturn,
  ReturnRepository,
} from '@Returns/repositories';
import { ReturnsService, type RegisterReturnInput } from '@Returns/services';

const RESERVA = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DUENO = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const INQUILINO = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';
const ENTREGA = new Date('2026-11-10T15:00:00Z');

function reserva(
  cambios: Partial<ReservationForReturn> = {},
): ReservationForReturn {
  return {
    id: RESERVA,
    status: 'EN_CURSO',
    tenantId: INQUILINO,
    landlordId: DUENO,
    deliveredAt: ENTREGA,
    hasReturn: false,
    ...cambios,
  };
}

const conDanos = (
  cambios: Partial<RegisterReturnInput> = {},
): RegisterReturnInput => ({
  fechaReal: '2026-11-12T12:15:00-06:00',
  estadoFinal: 'CON_OBSERVACIONES',
  danos: 'Rayón lateral',
  ...cambios,
});

describe('ReturnsService', () => {
  let repo: {
    findReservation: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findByReservation: ReturnType<typeof vi.fn>;
  };
  let service: ReturnsService;

  beforeEach(() => {
    repo = {
      findReservation: vi.fn().mockResolvedValue(reserva()),
      create: vi.fn().mockResolvedValue({ id: 'd-1', reservationId: RESERVA }),
      findByReservation: vi.fn(),
    };
    service = new ReturnsService(repo as unknown as ReturnRepository);
  });

  const registrar = (input: RegisterReturnInput = conDanos()) =>
    service.register(RESERVA, DUENO, input);

  describe('register', () => {
    it('guarda la devolución con la fecha en UTC y los daños recortados', async () => {
      await registrar(conDanos({ danos: '  Rayón lateral  ' }));

      expect(repo.create).toHaveBeenCalledWith({
        reservationId: RESERVA,
        registeredById: DUENO,
        returnedAt: new Date('2026-11-12T18:15:00Z'),
        finalState: 'CON_OBSERVACIONES',
        damages: 'Rayón lateral',
      });
    });

    it.each([
      ['sin el campo', undefined],
      ['vacío', ''],
      ['de solo espacios', '   '],
    ])(
      'SIN_OBSERVACIONES con danos %s se guarda sin daños',
      async (_, danos) => {
        await registrar({
          fechaReal: '2026-11-12T18:15:00Z',
          estadoFinal: 'SIN_OBSERVACIONES',
          danos,
        });

        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            finalState: 'SIN_OBSERVACIONES',
            damages: null,
          }),
        );
      },
    );

    it.each([
      ['CON_OBSERVACIONES sin daños', conDanos({ danos: undefined })],
      ['CON_OBSERVACIONES con daños vacíos', conDanos({ danos: '   ' })],
      [
        'CON_OBSERVACIONES con daños de 501 caracteres',
        conDanos({ danos: 'a'.repeat(501) }),
      ],
      [
        'SIN_OBSERVACIONES con daños',
        conDanos({ estadoFinal: 'SIN_OBSERVACIONES' }),
      ],
      ['una fecha que no existe', conDanos({ fechaReal: 'ayer' })],
    ])('responde 400 con %s, sin consultar ni guardar', async (_, input) => {
      await expect(registrar(input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.findReservation).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('acepta daños de 500 caracteres', async () => {
      await registrar(conDanos({ danos: 'a'.repeat(500) }));
      expect(repo.create).toHaveBeenCalled();
    });

    it('responde 404 si la reserva no existe', async () => {
      repo.findReservation.mockResolvedValue(null);
      await expect(registrar()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('responde 403 si la reserva no es de un bien del arrendador', async () => {
      repo.findReservation.mockResolvedValue(reserva({ landlordId: 'otro' }));
      await expect(registrar()).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('responde 409 si ya existe devolución', async () => {
      repo.findReservation.mockResolvedValue(reserva({ hasReturn: true }));
      await expect(registrar()).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each(['PENDIENTE', 'CONFIRMADA', 'RECHAZADA', 'COMPLETADA'] as const)(
      'responde 409 con una reserva %s (sin entrega vigente)',
      async (status) => {
        repo.findReservation.mockResolvedValue(
          reserva({ status, deliveredAt: null }),
        );
        await expect(registrar()).rejects.toBeInstanceOf(ConflictException);
        expect(repo.create).not.toHaveBeenCalled();
      },
    );

    it('responde 400 si la fecha real es anterior a la entrega', async () => {
      await expect(
        registrar(conDanos({ fechaReal: '2026-11-10T14:59:59Z' })),
      ).rejects.toThrow(/anterior a la entrega/);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('acepta exactamente la fecha de la entrega', async () => {
      await registrar(conDanos({ fechaReal: ENTREGA.toISOString() }));
      expect(repo.create).toHaveBeenCalled();
    });

    it.each(['YA_DEVUELTA', 'NO_EN_CURSO'] as const)(
      'traduce a 409 el conflicto %s de la transacción',
      async (reason) => {
        repo.create.mockRejectedValue(new ReturnConflictError(reason));
        await expect(registrar()).rejects.toBeInstanceOf(ConflictException);
      },
    );
  });

  describe('findForParticipant', () => {
    it.each([
      ['el arrendador', DUENO],
      ['el arrendatario', INQUILINO],
    ])('devuelve la devolución a %s', async (_, userId) => {
      const guardada = { id: 'd-1', reservationId: RESERVA };
      repo.findByReservation.mockResolvedValue(guardada);

      await expect(service.findForParticipant(RESERVA, userId)).resolves.toBe(
        guardada,
      );
    });

    it('responde 404 a quien no participa, sin revelar que existe', async () => {
      await expect(
        service.findForParticipant(RESERVA, 'otro'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findByReservation).not.toHaveBeenCalled();
    });

    it('responde 404 si la reserva todavía no tiene devolución', async () => {
      repo.findByReservation.mockResolvedValue(null);
      await expect(
        service.findForParticipant(RESERVA, DUENO),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
