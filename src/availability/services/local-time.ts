/**
 * Fechas en hora de El Salvador.
 *
 * La base guarda todo en UTC y la API habla en hora local. El Salvador está en
 * UTC-6 todo el año (no tiene horario de verano), así que la conversión es un
 * desfase fijo y no hace falta una librería de zonas horarias.
 */
export const ZONA_HORARIA = 'America/El_Salvador';
export const DESFASE = '-06:00';

const DESFASE_MS = 6 * 3_600_000;
export const DAY_MS = 86_400_000;

/**
 * `AAAA-MM-DD` → el instante (UTC) en que empieza ese día en El Salvador, o
 * null si la fecha no existe (`2026-02-30`).
 */
export function startOfLocalDay(day: string): Date | null {
  const [y, m, d] = day.split('-').map(Number);
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  const exists =
    utcMidnight.getUTCFullYear() === y &&
    utcMidnight.getUTCMonth() === m - 1 &&
    utcMidnight.getUTCDate() === d;
  // Las 00:00 de El Salvador son las 06:00 UTC del mismo día.
  return exists ? new Date(utcMidnight.getTime() + DESFASE_MS) : null;
}

/** Instante → `AAAA-MM-DDTHH:mm:ss-06:00`, como lo muestra la API. */
export function toLocalIso(instant: Date): string {
  const shifted = new Date(instant.getTime() - DESFASE_MS);
  return `${shifted.toISOString().slice(0, 19)}${DESFASE}`;
}
