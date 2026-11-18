import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewService } from '@Verification/services';
import type { IdentityVerificationRepository } from '@Verification/repositories';
import type { IdentityVerification } from '@PrismaClient';

const SOLICITUD = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';
const REVISOR = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';

function solicitud(
  cambios: Partial<IdentityVerification> = {},
): IdentityVerification {
  return {
    id: SOLICITUD,
    userId: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    documentKey: 'verificaciones/doc.pdf',
    status: 'PENDIENTE',
    rejectionReason: null,
    reviewedById: null,
    reviewedAt: null,
    submittedAt: new Date('2026-11-16T08:00:00.000Z'),
    ...cambios,
  };
}

describe('ReviewService', () => {
  let repo: {
    findByStatus: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    decide: ReturnType<typeof vi.fn>;
  };
  let service: ReviewService;

  beforeEach(() => {
    repo = {
      findByStatus: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(solicitud()),
      decide: vi
        .fn()
        .mockImplementation(
          (v: IdentityVerification, data: Partial<IdentityVerification>) =>
            Promise.resolve({ ...v, ...data }),
        ),
    };
    service = new ReviewService(
      repo as unknown as IdentityVerificationRepository,
    );
  });

  it('lista las solicitudes del estado pedido', async () => {
    await service.list('PENDIENTE');
    expect(repo.findByStatus).toHaveBeenCalledWith('PENDIENTE');
  });

  describe('decide', () => {
    it('APROBAR deja la solicitud APROBADA, con el revisor y sin motivo', async () => {
      const result = await service.decide(SOLICITUD, REVISOR, 'APROBAR');

      expect(repo.decide).toHaveBeenCalledWith(solicitud(), {
        status: 'APROBADA',
        reviewedById: REVISOR,
        rejectionReason: null,
      });
      expect(result.status).toBe('APROBADA');
    });

    it('RECHAZAR con motivo lo registra', async () => {
      await service.decide(
        SOLICITUD,
        REVISOR,
        'RECHAZAR',
        'Documento ilegible',
      );

      expect(repo.decide).toHaveBeenCalledWith(solicitud(), {
        status: 'RECHAZADA',
        reviewedById: REVISOR,
        rejectionReason: 'Documento ilegible',
      });
    });

    it('RECHAZAR sin motivo deja el motivo en null', async () => {
      await service.decide(SOLICITUD, REVISOR, 'RECHAZAR');

      expect(repo.decide).toHaveBeenCalledWith(
        solicitud(),
        expect.objectContaining({ status: 'RECHAZADA', rejectionReason: null }),
      );
    });

    it('rechaza con 400 un motivo al aprobar, sin escribir', async () => {
      await expect(
        service.decide(SOLICITUD, REVISOR, 'APROBAR', 'No aplica'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.decide).not.toHaveBeenCalled();
    });

    it('responde 404 si la solicitud no existe', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.decide(SOLICITUD, REVISOR, 'APROBAR'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['APROBADA', 'RECHAZADA'] as const)(
      'responde 409 si ya estaba %s, sin escribir',
      async (status) => {
        repo.findById.mockResolvedValue(solicitud({ status }));

        await expect(
          service.decide(SOLICITUD, REVISOR, 'RECHAZAR'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(repo.decide).not.toHaveBeenCalled();
      },
    );

    it('responde 409 si otro revisor la decidió entre la lectura y el UPDATE', async () => {
      repo.decide.mockResolvedValue(null);

      await expect(
        service.decide(SOLICITUD, REVISOR, 'APROBAR'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findForDocument', () => {
    it('devuelve la solicitud', async () => {
      await expect(service.findForDocument(SOLICITUD)).resolves.toEqual(
        solicitud(),
      );
    });

    it('responde 404 si no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findForDocument(SOLICITUD)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
