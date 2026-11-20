import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ListingsService } from '@Listings/services';
import type { AvailabilityRepository } from '@Availability/repositories';
import {
  AvailabilityService,
  MAX_RANGE_DAYS,
  startOfLocalDay,
  toLocalIso,
} from '@Availability/services';

const PUBLICACION = '7c1e0f3a-2b4d-4c6e-8f90-a1b2c3d4e5f6';

describe('hora de El Salvador', () => {
  it('el día empieza a las 06:00 UTC', () => {
    expect(startOfLocalDay('2026-11-01')).toEqual(
      new Date('2026-11-01T06:00:00.000Z'),
    );
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29'])(
    'una fecha que no existe (%s) da null',
    (day) => {
      expect(startOfLocalDay(day)).toBeNull();
    },
  );

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(startOfLocalDay('2028-02-29')).toEqual(
      new Date('2028-02-29T06:00:00.000Z'),
    );
  });

  it('muestra un instante con el desfase -06:00', () => {
    expect(toLocalIso(new Date('2026-11-12T15:00:00.000Z'))).toBe(
      '2026-11-12T09:00:00-06:00',
    );
  });

  it('un instante de madrugada en UTC cae en el día anterior local', () => {
    expect(toLocalIso(new Date('2026-12-01T03:30:00.000Z'))).toBe(
      '2026-11-30T21:30:00-06:00',
    );
  });
});

describe('AvailabilityService', () => {
  let listings: { findById: ReturnType<typeof vi.fn> };
  let repo: { findBusyPeriods: ReturnType<typeof vi.fn> };
  let service: AvailabilityService;

  beforeEach(() => {
    listings = { findById: vi.fn().mockResolvedValue({ id: PUBLICACION }) };
    repo = { findBusyPeriods: vi.fn().mockResolvedValue([]) };
    service = new AvailabilityService(
      listings as unknown as ListingsService,
      repo as unknown as AvailabilityRepository,
    );
  });

  it('consulta desde el inicio del primer día hasta el final del último, en UTC', async () => {
    await service.findForListing(PUBLICACION, {
      desde: '2026-11-01',
      hasta: '2026-11-30',
    });

    expect(repo.findBusyPeriods).toHaveBeenCalledWith(
      PUBLICACION,
      new Date('2026-11-01T06:00:00.000Z'),
      // El 30 va incluido: el rango termina al empezar el 1 de diciembre.
      new Date('2026-12-01T06:00:00.000Z'),
    );
  });

  it('devuelve los períodos en hora local con su origen', async () => {
    repo.findBusyPeriods.mockResolvedValue([
      {
        startAt: new Date('2026-11-12T15:00:00.000Z'),
        endAt: new Date('2026-11-12T18:00:00.000Z'),
        source: 'RESERVA',
      },
      {
        startAt: new Date('2026-11-20T06:00:00.000Z'),
        endAt: new Date('2026-11-22T06:00:00.000Z'),
        source: 'BLOQUEO',
      },
    ]);

    const result = await service.findForListing(PUBLICACION, {
      desde: '2026-11-01',
      hasta: '2026-11-30',
    });

    expect(result).toEqual({
      publicacionId: PUBLICACION,
      desde: '2026-11-01',
      hasta: '2026-11-30',
      ocupados: [
        {
          inicio: '2026-11-12T09:00:00-06:00',
          fin: '2026-11-12T12:00:00-06:00',
          origen: 'RESERVA',
        },
        {
          inicio: '2026-11-20T00:00:00-06:00',
          fin: '2026-11-22T00:00:00-06:00',
          origen: 'BLOQUEO',
        },
      ],
    });
  });

  it('acepta un rango de un solo día', async () => {
    await service.findForListing(PUBLICACION, {
      desde: '2026-11-15',
      hasta: '2026-11-15',
    });

    expect(repo.findBusyPeriods).toHaveBeenCalledWith(
      PUBLICACION,
      new Date('2026-11-15T06:00:00.000Z'),
      new Date('2026-11-16T06:00:00.000Z'),
    );
  });

  it(`acepta un rango de ${MAX_RANGE_DAYS} días y rechaza uno de ${MAX_RANGE_DAYS + 1}`, async () => {
    // Del 1 de octubre al 31 de diciembre son 31 + 30 + 31 = 92 días.
    await expect(
      service.findForListing(PUBLICACION, {
        desde: '2026-10-01',
        hasta: '2026-12-31',
      }),
    ).resolves.toBeDefined();

    await expect(
      service.findForListing(PUBLICACION, {
        desde: '2026-10-01',
        hasta: '2027-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza hasta anterior a desde', async () => {
    await expect(
      service.findForListing(PUBLICACION, {
        desde: '2026-11-10',
        hasta: '2026-11-09',
      }),
    ).rejects.toThrow('La fecha hasta no puede ser anterior a desde.');
  });

  it.each([
    [{ desde: '2026-02-30', hasta: '2026-03-10' }, 'desde'],
    [{ desde: '2026-02-01', hasta: '2026-02-31' }, 'hasta'],
  ])('rechaza una fecha que no existe (%o)', async (query, campo) => {
    await expect(service.findForListing(PUBLICACION, query)).rejects.toThrow(
      new RegExp(`La fecha ${campo} .* no existe`),
    );
  });

  it('con un rango inválido no consulta la publicación ni la base', async () => {
    await expect(
      service.findForListing(PUBLICACION, {
        desde: '2026-11-10',
        hasta: '2026-11-09',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(listings.findById).not.toHaveBeenCalled();
    expect(repo.findBusyPeriods).not.toHaveBeenCalled();
  });

  it('propaga el 404 de una publicación inactiva o inexistente sin consultar la disponibilidad', async () => {
    listings.findById.mockRejectedValue(
      new NotFoundException('La publicación no existe o no está disponible.'),
    );

    await expect(
      service.findForListing(PUBLICACION, {
        desde: '2026-11-01',
        hasta: '2026-11-30',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(repo.findBusyPeriods).not.toHaveBeenCalled();
  });
});
