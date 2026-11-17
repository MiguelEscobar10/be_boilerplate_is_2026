import { randomUUID } from 'node:crypto';
import { ReservationStatus } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de `listing_busy_periods` (DB-13.1): la consulta de períodos
 * ocupados de una publicación que usa el calendario de disponibilidad (H13).
 *
 * Corre contra la base `_test` local. Crea sus propios usuarios y
 * publicaciones con un email único y al final borra solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

interface BusyPeriod {
  start_at: Date;
  end_at: Date;
  source: string;
}

describe('períodos ocupados de una publicación (DB-13.1)', () => {
  const email = `db-13.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;

  // Rango consultado: todo noviembre de 2026, en UTC.
  const FROM = new Date('2026-11-01T00:00:00Z');
  const TO = new Date('2026-12-01T00:00:00Z');
  const nov = (day: number, hour = 0) =>
    new Date(Date.UTC(2026, 10, day, hour));

  const newListing = async () =>
    (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name: 'Cámara',
          location: 'San Salvador',
          rateAmount: '20.00',
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
        rentalCost: '20.00',
        depositAmount: '0.00',
      },
    });

  const block = (listingId: string, startAt: Date, endAt: Date) =>
    prisma.availabilityBlock.create({
      data: {
        listingId,
        startAt,
        endAt,
        reason: 'Mantenimiento',
        createdById: landlordId,
      },
    });

  const busy = (listingId: string, from = FROM, to = TO) =>
    prisma.$queryRaw<BusyPeriod[]>`
      SELECT * FROM listing_busy_periods(
        ${listingId}::uuid, ${from}::timestamp, ${to}::timestamp)`;

  beforeAll(async () => {
    const landlord = await prisma.user.create({
      data: {
        email: `landlord-${email}`,
        passwordHash: 'no-es-un-hash-real',
        role: 'ARRENDADOR',
      },
    });
    const tenant = await prisma.user.create({
      data: { email: `tenant-${email}`, passwordHash: 'no-es-un-hash-real' },
    });
    landlordId = landlord.id;
    tenantId = tenant.id;
  });

  afterAll(async () => {
    // Primero las reservas (RESTRICT); los bloqueos se van con la publicación.
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  it('una publicación sin reservas ni bloqueos no tiene períodos ocupados', async () => {
    expect(await busy(await newListing())).toEqual([]);
  });

  it('devuelve las reservas CONFIRMADA y EN_CURSO y los bloqueos, con su origen y en orden', async () => {
    const listingId = await newListing();
    await block(listingId, nov(20), nov(22));
    await reserve(listingId, nov(12, 15), nov(12, 18), 'CONFIRMADA');
    await reserve(listingId, nov(5), nov(7), 'EN_CURSO');

    expect(await busy(listingId)).toEqual([
      { start_at: nov(5), end_at: nov(7), source: 'RESERVA' },
      { start_at: nov(12, 15), end_at: nov(12, 18), source: 'RESERVA' },
      { start_at: nov(20), end_at: nov(22), source: 'BLOQUEO' },
    ]);
  });

  it.each(['PENDIENTE', 'RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
    'una reserva %s no ocupa fechas',
    async (status) => {
      const listingId = await newListing();
      await reserve(listingId, nov(10), nov(12), status);

      expect(await busy(listingId)).toEqual([]);
    },
  );

  it('una solicitud PENDIENTE sobre días ya ocupados no agrega nada', async () => {
    const listingId = await newListing();
    await reserve(listingId, nov(10), nov(12), 'CONFIRMADA');
    await reserve(listingId, nov(11), nov(13), 'PENDIENTE');

    expect(await busy(listingId)).toEqual([
      { start_at: nov(10), end_at: nov(12), source: 'RESERVA' },
    ]);
  });

  it('solo devuelve lo que se cruza con el rango; tocar el borde no cuenta', async () => {
    const listingId = await newListing();
    const oct = (day: number) => new Date(Date.UTC(2026, 9, day));
    const dec = (day: number) => new Date(Date.UTC(2026, 11, day));

    // Fuera del rango.
    await reserve(listingId, oct(10), oct(12));
    await block(listingId, dec(10), dec(12));
    // Tocan el borde: terminan justo al empezar el rango o empiezan al terminar.
    await reserve(listingId, oct(30), FROM);
    await block(listingId, TO, dec(3));
    // Cruzan el borde: entran, y se devuelven completos, sin recortar.
    await reserve(listingId, oct(30), nov(2));
    await block(listingId, nov(29), dec(2));

    expect(await busy(listingId)).toEqual([
      { start_at: oct(30), end_at: nov(2), source: 'RESERVA' },
      { start_at: nov(29), end_at: dec(2), source: 'BLOQUEO' },
    ]);
  });

  it('un período que cubre todo el rango también entra', async () => {
    const listingId = await newListing();
    const start = new Date(Date.UTC(2026, 9, 1));
    const end = new Date(Date.UTC(2027, 0, 1));
    await block(listingId, start, end);

    expect(await busy(listingId)).toEqual([
      { start_at: start, end_at: end, source: 'BLOQUEO' },
    ]);
  });

  it('no mezcla los períodos de otra publicación', async () => {
    const listingId = await newListing();
    const other = await newListing();
    await reserve(other, nov(10), nov(12));
    await block(other, nov(20), nov(22));

    expect(await busy(listingId)).toEqual([]);
  });

  it('una reserva y un bloqueo sobre los mismos días salen los dos', async () => {
    // La función no fusiona períodos: eso lo decide quien pinta el calendario.
    const listingId = await newListing();
    await reserve(listingId, nov(10), nov(12));
    await block(listingId, nov(10), nov(12));

    expect(await busy(listingId)).toEqual([
      { start_at: nov(10), end_at: nov(12), source: 'BLOQUEO' },
      { start_at: nov(10), end_at: nov(12), source: 'RESERVA' },
    ]);
  });

  it('no expone quién reservó ni el motivo del bloqueo', async () => {
    const listingId = await newListing();
    await reserve(listingId, nov(10), nov(12));
    await block(listingId, nov(20), nov(22));

    for (const row of await busy(listingId)) {
      expect(Object.keys(row).sort()).toEqual(['end_at', 'source', 'start_at']);
    }
  });

  it('usa los índices de DB-03.1 y DB-14.1 sin duplicarlos', async () => {
    const listingId = await newListing();
    // Con pocas filas Postgres prefiere recorrer la tabla; se desactiva el
    // recorrido secuencial solo dentro de esta transacción.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT * FROM listing_busy_periods(
          ${listingId}::uuid, ${FROM}::timestamp, ${TO}::timestamp)`;
    });
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    expect(text).toContain(
      'reservations_listing_id_status_start_at_end_at_idx',
    );
    expect(text).toContain(
      'availability_blocks_listing_id_start_at_end_at_idx',
    );

    // Cada juego de columnas tiene un solo índice: esta task no los duplica.
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE (tablename = 'reservations'
             AND indexdef LIKE '%(listing_id, status, start_at, end_at)%')
         OR (tablename = 'availability_blocks'
             AND indexdef LIKE '%(listing_id, start_at, end_at)%')`;
    expect(indexes).toHaveLength(2);
  });
});
