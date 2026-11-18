import { BadRequestException } from '@nestjs/common';
import type {
  ListingOccupancyRow,
  OccupancyRepository,
} from '@Reports/repositories';
import {
  currentMonth,
  occupancyRate,
  ReportsService,
} from './reports.service.js';

const row = (
  cambios: Partial<ListingOccupancyRow> = {},
): ListingOccupancyRow => ({
  listingId: 'l-1',
  name: 'Taladro',
  periodDays: 30,
  blockedDays: 2,
  occupiedDays: 6,
  ...cambios,
});

describe('ReportsService.occupancyFor', () => {
  const forLandlord = vi.fn<OccupancyRepository['forLandlord']>();
  const service = new ReportsService({
    forLandlord,
  } as unknown as OccupancyRepository);
  // 16 de noviembre de 2026, 03:00 en El Salvador.
  const now = new Date('2026-11-16T09:00:00Z');

  beforeEach(() => {
    forLandlord.mockReset();
    forLandlord.mockResolvedValue([row()]);
  });

  it('calcula la tasa con la fórmula del contrato y un decimal', async () => {
    const res = await service.occupancyFor(
      'u-1',
      { desde: '2026-11-01', hasta: '2026-11-30' },
      now,
    );

    expect(forLandlord).toHaveBeenCalledWith('u-1', '2026-11-01', '2026-11-30');
    expect(res).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-30',
      items: [
        {
          publicacionId: 'l-1',
          nombre: 'Taladro',
          diasOcupados: 6,
          diasDisponibles: 28,
          tasaOcupacion: 21.4,
        },
      ],
    });
  });

  it('sin fechas usa el mes calendario en curso', async () => {
    const res = await service.occupancyFor('u-1', {}, now);
    expect(res).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-30' });
  });

  it('el mes en curso se toma en hora de El Salvador, no en UTC', () => {
    // 1 de diciembre 03:00 UTC = 30 de noviembre 21:00 en El Salvador.
    expect(currentMonth(new Date('2026-12-01T03:00:00Z'))).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-30',
    });
    expect(currentMonth(new Date('2028-02-10T12:00:00Z'))).toEqual({
      desde: '2028-02-01',
      hasta: '2028-02-29',
    });
  });

  it('con una sola fecha, la otra sale del mes en curso', async () => {
    const res = await service.occupancyFor('u-1', { desde: '2026-11-10' }, now);
    expect(res).toMatchObject({ desde: '2026-11-10', hasta: '2026-11-30' });
  });

  it('un bien sin reservas da 0 y sin días disponibles también da 0', async () => {
    forLandlord.mockResolvedValue([
      row({ occupiedDays: 0 }),
      row({ listingId: 'l-2', blockedDays: 30, occupiedDays: 0 }),
    ]);

    const { items } = await service.occupancyFor('u-1', {}, now);

    expect(items.map((i) => [i.diasDisponibles, i.tasaOcupacion])).toEqual([
      [28, 0],
      [0, 0],
    ]);
  });

  it('acepta 366 días', async () => {
    await expect(
      service.occupancyFor(
        'u-1',
        { desde: '2028-01-01', hasta: '2028-12-31' },
        now,
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    [{ desde: '2026-02-30', hasta: '2026-03-01' }, 'no existe'],
    [{ desde: '2026-11-01', hasta: '2026-13-01' }, 'no existe'],
    [{ desde: '2026-11-30', hasta: '2026-11-01' }, 'posterior'],
    [{ desde: '2026-01-01', hasta: '2027-01-02' }, '366'],
  ])('rechaza %o con 400 (%s) sin consultar la base', async (query, msg) => {
    const intento = service.occupancyFor('u-1', query, now);
    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(intento).rejects.toThrow(msg);
    expect(forLandlord).not.toHaveBeenCalled();
  });
});

describe('occupancyRate', () => {
  it.each([
    [6, 28, 21.4],
    [1, 3, 33.3],
    [2, 3, 66.7],
    [28, 28, 100],
    [0, 28, 0],
    [0, 0, 0],
  ])('%i / %i → %d', (occupied, available, expected) => {
    expect(occupancyRate(occupied, available)).toBe(expected);
  });
});
