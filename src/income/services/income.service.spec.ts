import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@PrismaClient';
import type { IncomeRepository, ListingIncomeRow } from '@Income/repositories';
import {
  type Clock,
  IncomeService,
  currentMonth,
  parseDay,
  toUtcRange,
} from '@Income/services';

const ARRENDADOR = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
/** 16 de noviembre de 2026, mediodía en El Salvador. */
const AHORA = new Date('2026-11-16T18:00:00.000Z');

function fila(cambios: Partial<ListingIncomeRow> = {}): ListingIncomeRow {
  return {
    listingId: 'a0000000-0000-4000-8000-000000000001',
    name: 'Taladro',
    isActive: true,
    income: new Prisma.Decimal('0.00'),
    ...cambios,
  };
}

describe('IncomeService', () => {
  let repo: { forLandlord: ReturnType<typeof vi.fn> };
  let now: Date;
  let service: IncomeService;

  beforeEach(() => {
    repo = { forLandlord: vi.fn().mockResolvedValue([]) };
    now = AHORA;
    const clock: Clock = { now: () => now };
    service = new IncomeService(repo as unknown as IncomeRepository, clock);
  });

  const rangoPedido = () => {
    const [, from, to] = repo.forLandlord.mock.calls[0] as [string, Date, Date];
    return [from.toISOString(), to.toISOString()];
  };

  describe('rango', () => {
    it('convierte días inclusivos de El Salvador a [desde 06:00Z, hasta+1 06:00Z)', async () => {
      await service.reportFor(ARRENDADOR, {
        desde: '2026-11-01',
        hasta: '2026-11-30',
      });

      expect(repo.forLandlord).toHaveBeenCalledWith(
        ARRENDADOR,
        expect.any(Date),
        expect.any(Date),
      );
      expect(rangoPedido()).toEqual([
        '2026-11-01T06:00:00.000Z',
        '2026-12-01T06:00:00.000Z',
      ]);
    });

    it('cruza el fin de año', () => {
      const { from, to } = toUtcRange(
        parseDay('2026-12-31')!,
        parseDay('2026-12-31')!,
      );
      expect(from.toISOString()).toBe('2026-12-31T06:00:00.000Z');
      expect(to.toISOString()).toBe('2027-01-01T06:00:00.000Z');
    });

    it('sin fechas usa el mes en curso en hora de El Salvador', async () => {
      const res = await service.reportFor(ARRENDADOR, {});

      expect(res).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-30' });
      expect(rangoPedido()).toEqual([
        '2026-11-01T06:00:00.000Z',
        '2026-12-01T06:00:00.000Z',
      ]);
    });

    it('el 1 de diciembre a las 05:59Z todavía es noviembre en El Salvador', async () => {
      now = new Date('2026-12-01T05:59:59.999Z');
      expect(await service.reportFor(ARRENDADOR, {})).toMatchObject({
        desde: '2026-11-01',
        hasta: '2026-11-30',
      });
    });

    it('a las 06:00Z del 1 de diciembre ya es diciembre', async () => {
      now = new Date('2026-12-01T06:00:00.000Z');
      expect(await service.reportFor(ARRENDADOR, {})).toMatchObject({
        desde: '2026-12-01',
        hasta: '2026-12-31',
      });
    });

    it('febrero bisiesto termina el 29', () => {
      expect(currentMonth(new Date('2028-02-10T12:00:00Z'))).toEqual({
        desde: '2028-02-01',
        hasta: '2028-02-29',
      });
    });

    it('solo desde: hasta es el último día del mes en curso', async () => {
      const res = await service.reportFor(ARRENDADOR, { desde: '2026-10-15' });

      expect(res).toMatchObject({ desde: '2026-10-15', hasta: '2026-11-30' });
    });

    it('solo hasta: desde es el primer día del mes en curso', async () => {
      const res = await service.reportFor(ARRENDADOR, { hasta: '2026-11-10' });

      expect(res).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-10' });
    });

    it('acepta exactamente 366 días', async () => {
      await expect(
        service.reportFor(ARRENDADOR, {
          desde: '2026-01-01',
          hasta: '2027-01-01',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('400', () => {
    it.each([
      [{ desde: '2026-02-30', hasta: '2026-03-01' }, 'desde (2026-02-30)'],
      [{ desde: '2026-02-01', hasta: '2026-02-29' }, 'hasta (2026-02-29)'],
      [{ desde: '2026-13-01', hasta: '2026-12-01' }, 'desde (2026-13-01)'],
      [{ desde: '2026-11-30', hasta: '2026-11-01' }, 'posterior'],
      [{ desde: '2026-01-01', hasta: '2027-01-02' }, '366'],
      // Solo una fecha, pero la otra (del mes en curso) queda antes.
      [{ desde: '2026-12-05' }, 'posterior'],
      [{ hasta: '2026-10-31' }, 'posterior'],
    ])('%o → %s', async (query, mensaje) => {
      const error = await service
        .reportFor(ARRENDADOR, query)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain(mensaje);
      expect(repo.forLandlord).not.toHaveBeenCalled();
    });
  });

  describe('respuesta', () => {
    it('suma con Decimal y devuelve los importes como texto con 2 decimales', async () => {
      repo.forLandlord.mockResolvedValue([
        fila({
          listingId: 'a1',
          name: 'A',
          income: new Prisma.Decimal('0.10'),
        }),
        fila({
          listingId: 'a2',
          name: 'B',
          income: new Prisma.Decimal('0.20'),
        }),
        fila({ listingId: 'a3', name: 'C', income: new Prisma.Decimal('0') }),
      ]);

      const res = await service.reportFor(ARRENDADOR, {
        desde: '2026-11-01',
        hasta: '2026-11-30',
      });

      expect(res).toEqual({
        desde: '2026-11-01',
        hasta: '2026-11-30',
        moneda: 'USD',
        total: '0.30',
        porBien: [
          { publicacionId: 'a1', nombre: 'A', ingreso: '0.10' },
          { publicacionId: 'a2', nombre: 'B', ingreso: '0.20' },
          { publicacionId: 'a3', nombre: 'C', ingreso: '0.00' },
        ],
      });
    });

    it('muestra los desactivados solo si tuvieron ingresos, y el total cuadra', async () => {
      repo.forLandlord.mockResolvedValue([
        fila({ listingId: 'on', income: new Prisma.Decimal('10.00') }),
        fila({
          listingId: 'off-con',
          isActive: false,
          income: new Prisma.Decimal('5.50'),
        }),
        fila({ listingId: 'off-sin', isActive: false }),
      ]);

      const res = await service.reportFor(ARRENDADOR, {});

      expect(res.porBien.map((b) => b.publicacionId)).toEqual([
        'on',
        'off-con',
      ]);
      expect(res.total).toBe('15.50');
    });

    it('sin bienes devuelve total 0.00 y lista vacía', async () => {
      const res = await service.reportFor(ARRENDADOR, {});
      expect(res).toMatchObject({ total: '0.00', porBien: [] });
    });
  });
});
