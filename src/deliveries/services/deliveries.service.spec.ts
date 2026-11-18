import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryConflictError,
  ENTREGA_NO_HABILITADA,
  EntregaNoHabilitadaException,
} from '@Deliveries/errors';
import {
  DeliveriesService,
  MAX_PHOTO_BYTES,
  type DeliveryPhotoStorageService,
  type UploadedPhoto,
} from '@Deliveries/services';
import type {
  DeliveryRepository,
  ReservationForDelivery,
} from '@Deliveries/repositories';

const RESERVA = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DUENO = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const INQUILINO = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';
const INICIO = new Date('2026-12-01T09:00:00Z');
const DESPUES = new Date('2026-12-01T09:30:00Z');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function reserva(
  cambios: Partial<ReservationForDelivery> = {},
): ReservationForDelivery {
  return {
    id: RESERVA,
    status: 'CONFIRMADA',
    startAt: INICIO,
    tenantId: INQUILINO,
    landlordId: DUENO,
    hasDelivery: false,
    ...cambios,
  };
}

const foto = (cambios: Partial<UploadedPhoto> = {}): UploadedPhoto => ({
  originalname: 'a.jpg',
  size: JPG.length,
  buffer: JPG,
  ...cambios,
});

describe('DeliveriesService', () => {
  let repo: {
    findReservation: ReturnType<typeof vi.fn>;
    createAndStart: ReturnType<typeof vi.fn>;
    findByReservation: ReturnType<typeof vi.fn>;
  };
  let storage: {
    detectKind: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    removeMany: ReturnType<typeof vi.fn>;
  };
  let service: DeliveriesService;

  beforeEach(() => {
    repo = {
      findReservation: vi.fn().mockResolvedValue(reserva()),
      createAndStart: vi
        .fn()
        .mockResolvedValue({ id: 'e-1', reservationId: RESERVA }),
      findByReservation: vi.fn(),
    };
    let n = 0;
    storage = {
      detectKind: vi.fn().mockReturnValue('jpg'),
      save: vi
        .fn()
        .mockImplementation(() => Promise.resolve(`entregas/${++n}.jpg`)),
      removeMany: vi.fn().mockResolvedValue(undefined),
    };
    service = new DeliveriesService(
      repo as unknown as DeliveryRepository,
      storage as unknown as DeliveryPhotoStorageService,
    );
  });

  const registrar = (
    nota: string | undefined = 'Completo',
    fotos: UploadedPhoto[] = [],
    ahora = DESPUES,
  ) => service.register(RESERVA, DUENO, nota, fotos, ahora);

  describe('register', () => {
    it('guarda las fotos en orden y registra la entrega con la nota recortada', async () => {
      await registrar('  Completo  ', [foto(), foto()]);

      expect(repo.createAndStart).toHaveBeenCalledWith({
        reservationId: RESERVA,
        registeredById: DUENO,
        initialConditionNote: 'Completo',
        photoPaths: ['entregas/1.jpg', 'entregas/2.jpg'],
      });
    });

    it('acepta exactamente el inicio de la reserva', async () => {
      await registrar('Completo', [], INICIO);
      expect(repo.createAndStart).toHaveBeenCalled();
    });

    it.each([
      ['sin nota', undefined],
      ['nota vacía', '   '],
      ['nota de 501 caracteres', 'a'.repeat(501)],
    ])('responde 400 %s, sin consultar ni guardar', async (_, nota) => {
      // Directo al servicio: el valor por defecto de `registrar` cambiaría el undefined.
      await expect(
        service.register(RESERVA, DUENO, nota, [], DESPUES),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.findReservation).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('acepta una nota de 500 caracteres', async () => {
      await registrar('a'.repeat(500));
      expect(repo.createAndStart).toHaveBeenCalled();
    });

    it.each([
      ['más de 5 fotos', Array.from({ length: 6 }, () => foto())],
      ['una foto de más de 5 MB', [foto({ size: MAX_PHOTO_BYTES + 1 })]],
    ])('responde 400 con %s', async (_, fotos) => {
      await expect(registrar('Completo', fotos)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('responde 400 con una foto que no es JPG ni PNG', async () => {
      storage.detectKind.mockReturnValue(null);
      await expect(registrar('Completo', [foto()])).rejects.toThrow(
        /no es JPG ni PNG/,
      );
    });

    it('responde 404 si la reserva no existe', async () => {
      repo.findReservation.mockResolvedValue(null);
      await expect(registrar()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('responde 403 si la reserva no es de un bien del arrendador', async () => {
      repo.findReservation.mockResolvedValue(reserva({ landlordId: 'otro' }));
      await expect(registrar()).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['PENDIENTE', 'RECHAZADA', 'EN_CURSO', 'COMPLETADA'] as const)(
      'responde 409 si la reserva está %s',
      async (status) => {
        repo.findReservation.mockResolvedValue(reserva({ status }));
        await expect(registrar()).rejects.toBeInstanceOf(ConflictException);
        expect(repo.createAndStart).not.toHaveBeenCalled();
      },
    );

    it('responde 409 si ya tiene entrega', async () => {
      repo.findReservation.mockResolvedValue(reserva({ hasDelivery: true }));
      await expect(registrar()).rejects.toThrow(/ya se registró/);
    });

    it('responde 422 ENTREGA_NO_HABILITADA antes del inicio, con la fecha desde la que se habilita', async () => {
      const error = await registrar(
        'Completo',
        [],
        new Date(INICIO.getTime() - 1000),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EntregaNoHabilitadaException);
      expect((error as EntregaNoHabilitadaException).getStatus()).toBe(422);
      expect(
        (error as EntregaNoHabilitadaException).getResponse(),
      ).toMatchObject({
        codigo: ENTREGA_NO_HABILITADA,
        disponibleDesde: INICIO.toISOString(),
      });
      expect(repo.createAndStart).not.toHaveBeenCalled();
    });

    it('si la transacción encuentra que ya se entregó, responde 409 y borra las fotos', async () => {
      repo.createAndStart.mockRejectedValue(
        new DeliveryConflictError('YA_ENTREGADA'),
      );

      await expect(registrar('Completo', [foto()])).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.removeMany).toHaveBeenCalledWith(['entregas/1.jpg']);
    });

    it('si la transacción falla por otro motivo, borra las fotos y deja pasar el error', async () => {
      const boom = new Error('base caída');
      repo.createAndStart.mockRejectedValue(boom);

      await expect(registrar('Completo', [foto()])).rejects.toBe(boom);
      expect(storage.removeMany).toHaveBeenCalledWith(['entregas/1.jpg']);
    });
  });

  describe('findForParticipant', () => {
    it.each([DUENO, INQUILINO])(
      'devuelve la entrega al participante %s',
      async (userId) => {
        repo.findByReservation.mockResolvedValue({ id: 'e-1', photos: [] });
        await expect(
          service.findForParticipant(RESERVA, userId),
        ).resolves.toMatchObject({
          id: 'e-1',
        });
      },
    );

    it('responde 404 a quien no participa de la reserva', async () => {
      await expect(
        service.findForParticipant(RESERVA, 'intruso'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findByReservation).not.toHaveBeenCalled();
    });

    it('responde 404 si la reserva todavía no tiene entrega', async () => {
      repo.findByReservation.mockResolvedValue(null);
      await expect(service.findForParticipant(RESERVA, DUENO)).rejects.toThrow(
        /todavía no tiene entrega/,
      );
    });
  });
});
