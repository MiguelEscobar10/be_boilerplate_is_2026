import { BadRequestException } from '@nestjs/common';
import { parseInstant } from './reservation-dates.js';

describe('parseInstant', () => {
  it('convierte la hora de El Salvador a UTC', () => {
    expect(
      parseInstant('2026-11-12T09:00:00-06:00', 'inicio').toISOString(),
    ).toBe('2026-11-12T15:00:00.000Z');
  });

  it('acepta Z y milisegundos', () => {
    expect(
      parseInstant('2026-11-12T15:00:00.500Z', 'inicio').toISOString(),
    ).toBe('2026-11-12T15:00:00.500Z');
  });

  it('rechaza un día que no existe', () => {
    expect(() => parseInstant('2026-02-30T09:00:00-06:00', 'inicio')).toThrow(
      BadRequestException,
    );
    expect(() => parseInstant('2026-13-01T09:00:00-06:00', 'fin')).toThrow(
      /fin/,
    );
  });

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(
      parseInstant('2028-02-29T09:00:00-06:00', 'inicio').getUTCDate(),
    ).toBe(29);
    expect(() => parseInstant('2027-02-29T09:00:00-06:00', 'inicio')).toThrow(
      BadRequestException,
    );
  });
});
