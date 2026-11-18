import { randomUUID } from 'node:crypto';
import type { ReservationStatus } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Consulta de días ocupados y bloqueados (DB-22.1, H22).
 *
 * Prueba las funciones `listing_day_occupancy` y `landlord_occupancy` de la
 * migración create_occupancy_queries contra la base local `_test`. Crea sus
 * propios usuarios, publicaciones, reservas y bloqueos con un email único y al
 * final borra solo lo que creó.
 *
 * Las fechas de las reservas se escriben en UTC: El Salvador es UTC-6 todo el
 * año, así que la medianoche local del 1 de noviembre es 2026-11-01T06:00Z.
 */
const prisma = createTestPrismaClient();

type Totals = {
  listing_id: string;
  listing_name: string;
  period_days: number;
  blocked_days: number;
  occupied_days: number;
};
type Day = { day: Date; blocked: boolean; occupied: boolean };

/** Medianoche local (El Salvador) del día `d` de noviembre de 2026, en UTC. */
const nov = (d: number, hour = 0) => new Date(Date.UTC(2026, 10, d, hour + 6));

describe('consulta de días ocupados y bloqueados (DB-22.1)', () => {
  const email = `db-22.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let otherLandlordId: string;
  let tenantId: string;

  const user = async (prefix: string, role: 'ARRENDADOR' | 'ARRENDATARIO') =>
    (
      await prisma.user.create({
        data: { email: `${prefix}-${email}`, passwordHash: 'x', role },
      })
    ).id;

  const listing = async (name: string, owner = landlordId) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner,
          type: 'EQUIPO',
          name,
          location: 'San Salvador',
          rateAmount: '10.00',
          rateUnit: 'DIA',
        },
      })
    ).id;

  const reserve = (
    listingId: string,
    startAt: Date,
    endAt: Date,
    status: ReservationStatus = 'CONFIRMADA',
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId,
        startAt,
        endAt,
        status,
        rentalCost: '10.00',
        depositAmount: '0.00',
      },
    });

  const block = (listingId: string, startAt: Date, endAt: Date) =>
    prisma.availabilityBlock.create({ data: { listingId, startAt, endAt } });

  const totals = (owner: string, from = '2026-11-01', to = '2026-11-30') =>
    prisma.$queryRaw<Totals[]>`
      SELECT * FROM landlord_occupancy(${owner}::uuid, ${from}::date, ${to}::date)`;

  const totalsOf = async (listingId: string, from?: string, to?: string) => {
    const row = (await totals(landlordId, from, to)).find(
      (r) => r.listing_id === listingId,
    );
    if (!row) throw new Error('La publicación no aparece en el resultado');
    return row;
  };

  const days = (listingId: string, from: string, to: string) =>
    prisma.$queryRaw<Day[]>`
      SELECT day, blocked, occupied
      FROM listing_day_occupancy(ARRAY[${listingId}::uuid], ${from}::date, ${to}::date)`;

  const occupiedDays = async (listingId: string, from: string, to: string) =>
    (await days(listingId, from, to))
      .filter((d) => d.occupied)
      .map((d) => d.day.toISOString().slice(0, 10));

  beforeAll(async () => {
    landlordId = await user('dueno', 'ARRENDADOR');
    otherLandlordId = await user('otro', 'ARRENDADOR');
    tenantId = await user('inquilino', 'ARRENDATARIO');
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  it('cuenta una sola vez los días cubiertos por varias reservas', async () => {
    const id = await listing('Traslapes');
    await reserve(id, nov(3, 10), nov(6, 10)); // días 3, 4, 5 y 6
    await reserve(id, nov(5, 8), nov(8, 9)); // días 5, 6, 7 y 8

    expect(await totalsOf(id)).toMatchObject({
      period_days: 30,
      blocked_days: 0,
      occupied_days: 6,
    });
  });

  it('solo cuentan las reservas CONFIRMADA, EN_CURSO y COMPLETADA', async () => {
    const id = await listing('Estados');
    const statuses: ReservationStatus[] = [
      'PENDIENTE',
      'CONFIRMADA',
      'RECHAZADA',
      'CANCELADA',
      'EN_CURSO',
      'COMPLETADA',
    ];
    for (const [i, status] of statuses.entries()) {
      // Una reserva de medio día en el día 10, 11, ..., 15.
      await reserve(id, nov(10 + i, 9), nov(10 + i, 15), status);
    }

    expect(await occupiedDays(id, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-11',
      '2026-11-14',
      '2026-11-15',
    ]);
  });

  it('un día bloqueado no cuenta como ocupado ni como disponible', async () => {
    const id = await listing('Bloqueos');
    await reserve(id, nov(1), nov(5)); // días 1 a 4
    await block(id, nov(3, 12), nov(6)); // días 3, 4 y 5

    expect(await totalsOf(id)).toMatchObject({
      period_days: 30,
      blocked_days: 3,
      occupied_days: 2,
    });
    const [d3] = await days(id, '2026-11-03', '2026-11-03');
    expect(d3).toMatchObject({ blocked: true, occupied: false });
  });

  it('toma los días en la zona America/El_Salvador', async () => {
    const id = await listing('Zona horaria');
    // 2 de noviembre 03:00 a 05:00 UTC = 1 de noviembre 21:00 a 23:00 local.
    await reserve(
      id,
      new Date('2026-11-02T03:00:00Z'),
      new Date('2026-11-02T05:00:00Z'),
    );

    expect(await occupiedDays(id, '2026-11-01', '2026-11-02')).toEqual([
      '2026-11-01',
    ]);
  });

  it('una reserva que empieza justo a medianoche no ocupa el día anterior', async () => {
    const id = await listing('Medianoche al empezar');
    await reserve(id, nov(10), nov(12, 10)); // empieza a las 00:00 del 10

    expect(await occupiedDays(id, '2026-11-08', '2026-11-13')).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
  });

  it('una reserva que termina justo a medianoche no ocupa el día siguiente', async () => {
    const id = await listing('Medianoche');
    await reserve(id, nov(20, 10), nov(22)); // termina a las 00:00 del 22

    expect(await occupiedDays(id, '2026-11-19', '2026-11-23')).toEqual([
      '2026-11-20',
      '2026-11-21',
    ]);
  });

  it('solo cuenta los días dentro del período (fechas inclusivas)', async () => {
    const id = await listing('Bordes');
    await reserve(id, new Date('2026-10-25T12:00:00Z'), nov(3, 12));

    expect(await totalsOf(id, '2026-11-01', '2026-11-02')).toMatchObject({
      period_days: 2,
      occupied_days: 2,
    });
    expect(await totalsOf(id, '2026-11-02', '2026-11-02')).toMatchObject({
      period_days: 1,
      occupied_days: 1,
    });
  });

  it('una publicación sin reservas devuelve 0 días ocupados', async () => {
    const id = await listing('Sin reservas');
    expect(await totalsOf(id)).toMatchObject({
      period_days: 30,
      blocked_days: 0,
      occupied_days: 0,
    });
  });

  it('devuelve solo las publicaciones del arrendador pedido', async () => {
    const ajena = await listing('Ajena', otherLandlordId);
    await reserve(ajena, nov(1), nov(10));

    const mine = await totals(landlordId);
    expect(mine.map((r) => r.listing_id)).not.toContain(ajena);
    expect(mine.length).toBeGreaterThan(0);

    const theirs = await totals(otherLandlordId);
    expect(theirs).toEqual([
      expect.objectContaining({ listing_id: ajena, occupied_days: 9 }),
    ]);
  });

  it('un período invertido no devuelve días', async () => {
    const id = await listing('Invertido');
    expect(await totalsOf(id, '2026-11-30', '2026-11-01')).toMatchObject({
      period_days: 0,
      occupied_days: 0,
    });
  });
});
