import { BadRequestException } from '@nestjs/common';

/**
 * Texto con zona (`2026-11-12T09:00:00-06:00`) → instante.
 *
 * El DTO ya revisó el formato; esto atrapa fechas que no existen, como el 30
 * de febrero, que `new Date` no rechaza sino que corre al 2 de marzo.
 *
 * @throws {BadRequestException} si la fecha no existe.
 */
export function parseInstant(text: string, campo: string): Date {
  const date = new Date(text);
  if (Number.isNaN(date.getTime()) || !sameDay(text, date)) {
    throw new BadRequestException(`La fecha ${campo} (${text}) no existe.`);
  }
  return date;
}

/** El día escrito en el texto es el mismo que tiene la fecha ya ajustada. */
function sameDay(text: string, date: Date): boolean {
  const [y, m, d] = text.slice(0, 10).split('-').map(Number);
  const zone = text.slice(19).replace(/^\.\d+/, '');
  const offsetMin =
    zone === 'Z' || zone === ''
      ? 0
      : (zone.startsWith('-') ? -1 : 1) *
        (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const local = new Date(date.getTime() + offsetMin * 60_000);
  return (
    local.getUTCFullYear() === y &&
    local.getUTCMonth() === m - 1 &&
    local.getUTCDate() === d
  );
}
