import { Prisma } from '@PrismaClient';
import {
  chargeUnits,
  costExceedsLimit,
  rentalCost,
} from './reservation-cost.js';

const T0 = new Date('2026-11-12T15:00:00.000Z');
const mas = (ms: number) => new Date(T0.getTime() + ms);
const H = 3_600_000;
const D = 24 * H;

describe('chargeUnits', () => {
  it('HORA: duración en horas', () => {
    expect(chargeUnits(T0, mas(3 * H), 'HORA')).toBe(3);
  });

  it('una fracción se redondea hacia arriba', () => {
    expect(chargeUnits(T0, mas(3 * H + 1), 'HORA')).toBe(4);
    expect(chargeUnits(T0, mas(90 * 60_000), 'HORA')).toBe(2);
  });

  it('el mínimo es 1 unidad', () => {
    expect(chargeUnits(T0, mas(1), 'HORA')).toBe(1);
    expect(chargeUnits(T0, mas(60_000), 'DIA')).toBe(1);
    expect(chargeUnits(T0, mas(H), 'SEMANA')).toBe(1);
  });

  it('DIA y NOCHE: días de 24 horas', () => {
    expect(chargeUnits(T0, mas(2 * D), 'DIA')).toBe(2);
    expect(chargeUnits(T0, mas(2 * D), 'NOCHE')).toBe(2);
    expect(chargeUnits(T0, mas(2 * D + H), 'DIA')).toBe(3);
    expect(chargeUnits(T0, mas(23 * H), 'NOCHE')).toBe(1);
  });

  it('SEMANA: semanas de 7 días', () => {
    expect(chargeUnits(T0, mas(7 * D), 'SEMANA')).toBe(1);
    expect(chargeUnits(T0, mas(7 * D + 1), 'SEMANA')).toBe(2);
    expect(chargeUnits(T0, mas(14 * D), 'SEMANA')).toBe(2);
  });
});

describe('rentalCost', () => {
  it('3 horas × 15.00 = 45.00 (ejemplo de la ficha)', () => {
    expect(rentalCost('15.00', 'HORA', T0, mas(3 * H)).toFixed(2)).toBe(
      '45.00',
    );
  });

  it('2 horas y 10 minutos × 15.00 se cobran como 3 horas', () => {
    expect(
      rentalCost('15.00', 'HORA', T0, mas(2 * H + 10 * 60_000)).toFixed(2),
    ).toBe('45.00');
  });

  it('no arrastra errores de coma flotante', () => {
    expect(rentalCost('15.10', 'HORA', T0, mas(3 * H)).toFixed(2)).toBe(
      '45.30',
    );
    expect(rentalCost('0.10', 'HORA', T0, mas(3 * H)).toFixed(2)).toBe('0.30');
  });

  it('acepta una tarifa Decimal, como la entrega Prisma', () => {
    expect(
      rentalCost(new Prisma.Decimal('25.00'), 'DIA', T0, mas(2 * D)).toFixed(2),
    ).toBe('50.00');
  });
});

describe('costExceedsLimit', () => {
  it('detecta lo que no cabe en DECIMAL(12,2)', () => {
    expect(costExceedsLimit(new Prisma.Decimal('9999999999.99'))).toBe(false);
    expect(costExceedsLimit(new Prisma.Decimal('10000000000.00'))).toBe(true);
  });
});
