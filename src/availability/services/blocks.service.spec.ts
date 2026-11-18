import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AvailabilityBlock } from '@PrismaClient';
import {
  BlockOverlapsReservationError,
  RANGO_CON_RESERVA,
  RangoConReservaException,
} from '@Availability/errors';
import type { BlockRepository } from '@Availability/repositories';
import { BlocksService } from '@Availability/services';

const PUBLICACION = '7c1e0f3a-2b4d-4c6e-8f90-a1b2c3d4e5f6';
const ARRENDADOR = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const OTRO = '11111111-2222-4333-8444-555555555555';
const BLOQUEO = '0b9d8c7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e';

const valido = {
  inicio: '2026-11-20T00:00:00-06:00',
  fin: '2026-11-22T00:00:00-06:00',
  motivo: 'Mantenimiento',
};

function fila(cambios: Partial<AvailabilityBlock> = {}): AvailabilityBlock {
  return {
    id: BLOQUEO,
    listingId: PUBLICACION,
    startAt: new Date('2026-11-20T06:00:00.000Z'),
    endAt: new Date('2026-11-22T06:00:00.000Z'),
    reason: 'Mantenimiento',
    createdById: ARRENDADOR,
    createdAt: new Date('2026-11-17T15:00:00.000Z'),
    ...cambios,
  };
}

describe('BlocksService', () => {
  let repo: {
    findListingOwner: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findByListing: ReturnType<typeof vi.fn>;
  };
  let service: BlocksService;

  beforeEach(() => {
    repo = {
      findListingOwner: vi.fn().mockResolvedValue(ARRENDADOR),
      create: vi.fn().mockResolvedValue(fila()),
      findByListing: vi.fn().mockResolvedValue([]),
    };
    service = new BlocksService(repo as unknown as BlockRepository);
  });

  describe('create', () => {
    it('crea el bloqueo con las fechas en UTC y devuelve la respuesta en hora local', async () => {
      const result = await service.create(PUBLICACION, ARRENDADOR, valido);

      expect(repo.create).toHaveBeenCalledWith({
        listingId: PUBLICACION,
        createdById: ARRENDADOR,
        startAt: new Date('2026-11-20T06:00:00.000Z'),
        endAt: new Date('2026-11-22T06:00:00.000Z'),
        reason: 'Mantenimiento',
      });
      expect(result).toEqual({
        id: BLOQUEO,
        publicacionId: PUBLICACION,
        inicio: '2026-11-20T00:00:00-06:00',
        fin: '2026-11-22T00:00:00-06:00',
        motivo: 'Mantenimiento',
      });
    });

    it('acepta fechas en UTC (Z)', async () => {
      await service.create(PUBLICACION, ARRENDADOR, {
        inicio: '2026-11-20T06:00:00Z',
        fin: '2026-11-22T06:00:00.000Z',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          startAt: new Date('2026-11-20T06:00:00.000Z'),
          endAt: new Date('2026-11-22T06:00:00.000Z'),
        }),
      );
    });

    it.each([
      ['sin motivo', undefined],
      ['motivo vacío (ya recortado por el DTO)', ''],
    ])('%s se guarda como null', async (_caso, motivo) => {
      await service.create(PUBLICACION, ARRENDADOR, { ...valido, motivo });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ reason: null }),
      );
    });

    it.each([
      ['igual al inicio', '2026-11-20T00:00:00-06:00'],
      ['anterior al inicio', '2026-11-19T23:59:00-06:00'],
      ['el mismo instante escrito en UTC', '2026-11-20T06:00:00Z'],
    ])('400 con fin %s, sin tocar la base', async (_caso, fin) => {
      await expect(
        service.create(PUBLICACION, ARRENDADOR, { ...valido, fin }),
      ).rejects.toThrow('La fecha fin debe ser posterior a la de inicio.');

      expect(repo.findListingOwner).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each([
      ['inicio', { inicio: '2026-02-30T00:00:00-06:00' }],
      ['fin', { fin: '2026-11-31T00:00:00-06:00' }],
      ['inicio', { inicio: '2026-11-20T25:00:00-06:00' }],
    ])('400 si la fecha %s no existe (%o)', async (campo, cambio) => {
      await expect(
        service.create(PUBLICACION, ARRENDADOR, { ...valido, ...cambio }),
      ).rejects.toThrow(new RegExp(`La fecha ${campo} .* no existe`));
    });

    it('acepta el 29 de febrero de un año bisiesto', async () => {
      await expect(
        service.create(PUBLICACION, ARRENDADOR, {
          inicio: '2028-02-29T00:00:00-06:00',
          fin: '2028-03-01T00:00:00-06:00',
        }),
      ).resolves.toBeDefined();
    });

    it('404 "Publicación no encontrada." si la publicación no existe', async () => {
      repo.findListingOwner.mockResolvedValue(null);

      const error = await service
        .create(PUBLICACION, ARRENDADOR, valido)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        'Publicación no encontrada.',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('403 "Publicación no encontrada." si es de otro arrendador', async () => {
      repo.findListingOwner.mockResolvedValue(OTRO);

      const error = await service
        .create(PUBLICACION, ARRENDADOR, valido)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'Publicación no encontrada.',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('409 RANGO_CON_RESERVA si el rango se cruza con una reserva', async () => {
      repo.create.mockRejectedValue(new BlockOverlapsReservationError());

      const error = await service
        .create(PUBLICACION, ARRENDADOR, valido)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RangoConReservaException);
      expect((error as RangoConReservaException).getResponse()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        codigo: RANGO_CON_RESERVA,
        message: 'El rango tiene una reserva CONFIRMADA o EN_CURSO.',
      });
    });

    it('un error que no es de dominio se propaga tal cual', async () => {
      const caida = new Error('base caída');
      repo.create.mockRejectedValue(caida);

      await expect(
        service.create(PUBLICACION, ARRENDADOR, valido),
      ).rejects.toBe(caida);
    });
  });

  describe('listForOwner', () => {
    it('devuelve los bloqueos en hora local con su motivo', async () => {
      repo.findByListing.mockResolvedValue([
        fila(),
        fila({ id: 'b2', reason: null }),
      ]);

      const result = await service.listForOwner(PUBLICACION, ARRENDADOR);

      expect(result.items).toEqual([
        {
          id: BLOQUEO,
          publicacionId: PUBLICACION,
          inicio: '2026-11-20T00:00:00-06:00',
          fin: '2026-11-22T00:00:00-06:00',
          motivo: 'Mantenimiento',
        },
        expect.objectContaining({ id: 'b2', motivo: null }),
      ]);
    });

    it('403 para otro arrendador y 404 si no existe, sin leer los bloqueos', async () => {
      repo.findListingOwner.mockResolvedValueOnce(OTRO);
      await expect(
        service.listForOwner(PUBLICACION, ARRENDADOR),
      ).rejects.toThrow(ForbiddenException);

      repo.findListingOwner.mockResolvedValueOnce(null);
      await expect(
        service.listForOwner(PUBLICACION, ARRENDADOR),
      ).rejects.toThrow(NotFoundException);

      expect(repo.findByListing).not.toHaveBeenCalled();
    });
  });
});
