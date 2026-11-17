import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PendingVerificationExistsError } from '@Verification/errors';
import {
  MAX_DOCUMENT_BYTES,
  VerificationService,
  type DocumentStorageService,
  type UploadedDocument,
} from '@Verification/services';
import type { IdentityVerificationRepository } from '@Verification/repositories';
import type { IdentityVerification } from '@PrismaClient';

const USUARIO = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const KEY = 'verificaciones/0b9d8c7e.pdf';
const PDF = Buffer.from('%PDF-1.4 documento');

function archivo(cambios: Partial<UploadedDocument> = {}): UploadedDocument {
  return { originalname: 'dui.pdf', size: PDF.length, buffer: PDF, ...cambios };
}

function solicitud(
  cambios: Partial<IdentityVerification> = {},
): IdentityVerification {
  return {
    id: '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e',
    userId: USUARIO,
    documentKey: KEY,
    status: 'PENDIENTE',
    rejectionReason: null,
    reviewedById: null,
    reviewedAt: null,
    submittedAt: new Date('2026-11-16T08:00:00.000Z'),
    ...cambios,
  };
}

describe('VerificationService', () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    findLatestByUser: ReturnType<typeof vi.fn>;
    hasPending: ReturnType<typeof vi.fn>;
  };
  let storage: {
    detectKind: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let service: VerificationService;

  beforeEach(() => {
    repo = {
      create: vi.fn().mockResolvedValue(solicitud()),
      findLatestByUser: vi.fn(),
      hasPending: vi.fn().mockResolvedValue(false),
    };
    storage = {
      detectKind: vi.fn().mockReturnValue('pdf'),
      save: vi.fn().mockResolvedValue(KEY),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    service = new VerificationService(
      repo as unknown as IdentityVerificationRepository,
      storage as unknown as DocumentStorageService,
    );
  });

  describe('submit', () => {
    it('guarda el archivo y registra la solicitud PENDIENTE con su ruta privada', async () => {
      const result = await service.submit(USUARIO, archivo());

      expect(storage.save).toHaveBeenCalledWith(PDF, 'pdf');
      expect(repo.create).toHaveBeenCalledWith(USUARIO, KEY);
      expect(result.status).toBe('PENDIENTE');
    });

    it('rechaza con 400 si falta el archivo o viene vacío', async () => {
      for (const file of [undefined, archivo({ size: 0 })]) {
        await expect(service.submit(USUARIO, file)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un archivo de más de 5 MB sin guardarlo', async () => {
      await expect(
        service.submit(USUARIO, archivo({ size: MAX_DOCUMENT_BYTES + 1 })),
      ).rejects.toThrow(/5 MB/);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('acepta un archivo de exactamente 5 MB', async () => {
      await service.submit(USUARIO, archivo({ size: MAX_DOCUMENT_BYTES }));
      expect(repo.create).toHaveBeenCalled();
    });

    it('rechaza con 400 un archivo que no es JPG, PNG ni PDF sin guardarlo', async () => {
      storage.detectKind.mockReturnValue(null);

      await expect(
        service.submit(USUARIO, archivo({ originalname: 'virus.pdf' })),
      ).rejects.toThrow(/no es JPG, PNG ni PDF/);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si ya hay una PENDIENTE, sin guardar el archivo', async () => {
      repo.hasPending.mockResolvedValue(true);

      await expect(service.submit(USUARIO, archivo())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.save).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('si otra petición registró una PENDIENTE al mismo tiempo, responde 409 y borra el archivo', async () => {
      repo.create.mockRejectedValue(
        new PendingVerificationExistsError(USUARIO),
      );

      await expect(service.submit(USUARIO, archivo())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.remove).toHaveBeenCalledWith(KEY);
    });

    it('si falla el insert por otro motivo, borra el archivo y deja pasar el error', async () => {
      const boom = new Error('base caída');
      repo.create.mockRejectedValue(boom);

      await expect(service.submit(USUARIO, archivo())).rejects.toBe(boom);
      expect(storage.remove).toHaveBeenCalledWith(KEY);
    });
  });

  describe('findLatest', () => {
    it('devuelve la última solicitud del usuario', async () => {
      const latest = solicitud({
        status: 'RECHAZADA',
        rejectionReason: 'Documento ilegible',
      });
      repo.findLatestByUser.mockResolvedValue(latest);

      await expect(service.findLatest(USUARIO)).resolves.toBe(latest);
      expect(repo.findLatestByUser).toHaveBeenCalledWith(USUARIO);
    });

    it('responde 404 si todavía no envió ninguna', async () => {
      repo.findLatestByUser.mockResolvedValue(null);

      await expect(service.findLatest(USUARIO)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
