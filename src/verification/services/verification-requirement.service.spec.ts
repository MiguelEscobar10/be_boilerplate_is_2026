import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  VERIFICACION_REQUERIDA,
  VERIFICACION_REQUERIDA_MENSAJE,
  VerificacionRequeridaException,
} from '@Verification/errors';
import { VerificationRequirementService } from '@Verification/services';
import type { VerificationRequirementRepository } from '@Verification/repositories';

const PUBLICACION = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DUENO = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const ARRENDATARIO = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';

const listing = (requiresVerification: boolean) => ({
  id: PUBLICACION,
  landlordId: DUENO,
  requiresVerification,
});

describe('VerificationRequirementService', () => {
  let repo: {
    findListing: ReturnType<typeof vi.fn>;
    setRequiresVerification: ReturnType<typeof vi.fn>;
    hasApprovedVerification: ReturnType<typeof vi.fn>;
  };
  let service: VerificationRequirementService;

  beforeEach(() => {
    repo = {
      findListing: vi.fn().mockResolvedValue(listing(false)),
      setRequiresVerification: vi
        .fn()
        .mockImplementation((_id: string, value: boolean) =>
          Promise.resolve(listing(value)),
        ),
      hasApprovedVerification: vi.fn().mockResolvedValue(false),
    };
    service = new VerificationRequirementService(
      repo as unknown as VerificationRequirementRepository,
    );
  });

  describe('setRequiresVerification', () => {
    it('el dueño activa la opción', async () => {
      const result = await service.setRequiresVerification(
        PUBLICACION,
        DUENO,
        true,
      );

      expect(repo.setRequiresVerification).toHaveBeenCalledWith(
        PUBLICACION,
        true,
      );
      expect(result.requiresVerification).toBe(true);
    });

    it('si ya tiene ese valor no escribe y la devuelve igual', async () => {
      repo.findListing.mockResolvedValue(listing(true));

      const result = await service.setRequiresVerification(
        PUBLICACION,
        DUENO,
        true,
      );

      expect(repo.setRequiresVerification).not.toHaveBeenCalled();
      expect(result.requiresVerification).toBe(true);
    });

    it('responde 403 si no es el dueño, sin escribir', async () => {
      await expect(
        service.setRequiresVerification(PUBLICACION, ARRENDATARIO, true),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.setRequiresVerification).not.toHaveBeenCalled();
    });

    it('responde 404 si la publicación no existe', async () => {
      repo.findListing.mockResolvedValue(null);

      await expect(
        service.setRequiresVerification(PUBLICACION, DUENO, true),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('exigeVerificacionYNoCumple', () => {
    it('rechaza (true) si la publicación la exige y el arrendatario no está verificado', async () => {
      repo.findListing.mockResolvedValue(listing(true));
      repo.hasApprovedVerification.mockResolvedValue(false);

      await expect(
        service.exigeVerificacionYNoCumple(PUBLICACION, ARRENDATARIO),
      ).resolves.toBe(true);
      expect(repo.hasApprovedVerification).toHaveBeenCalledWith(ARRENDATARIO);
    });

    it('acepta (false) si la publicación la exige y el arrendatario está verificado', async () => {
      repo.findListing.mockResolvedValue(listing(true));
      repo.hasApprovedVerification.mockResolvedValue(true);

      await expect(
        service.exigeVerificacionYNoCumple(PUBLICACION, ARRENDATARIO),
      ).resolves.toBe(false);
    });

    it('acepta (false) si la publicación no la exige, sin consultar la verificación', async () => {
      await expect(
        service.exigeVerificacionYNoCumple(PUBLICACION, ARRENDATARIO),
      ).resolves.toBe(false);
      expect(repo.hasApprovedVerification).not.toHaveBeenCalled();
    });

    it('devuelve false si la publicación no existe (el 404 es de BE-03.1)', async () => {
      repo.findListing.mockResolvedValue(null);

      await expect(
        service.exigeVerificacionYNoCumple(PUBLICACION, ARRENDATARIO),
      ).resolves.toBe(false);
    });
  });

  it('VerificacionRequeridaException responde 422 con el código y el mensaje del contrato', () => {
    const error = new VerificacionRequeridaException();

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      codigo: VERIFICACION_REQUERIDA,
      message: VERIFICACION_REQUERIDA_MENSAJE,
    });
    expect(VERIFICACION_REQUERIDA_MENSAJE).toBe(
      'Esta publicación solo acepta usuarios verificados. Envía tu documento de identidad para verificarte.',
    );
  });
});
