import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de la consulta del último pago por reserva (DB-06.1).
 *
 * Misma regla que las demás pruebas de base: solo corre contra una base local
 * cuyo nombre termina en `_test`, y al final borra solo lo que creó.
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error('Definí TEST_DATABASE_URL o DATABASE_URL.');
  }

  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;

  const dbName = url.pathname.slice(1);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(
      `La base de pruebas debe ser local (host: ${url.hostname}).`,
    );
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `La base de pruebas debe terminar en _test (es ${dbName}).`,
    );
  }
  return url.toString();
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }),
});

describe('último pago por reserva (DB-06.1)', () => {
  const suffix = `db-06.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;

  const newReservation = () =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId,
        startAt: new Date('2026-12-01T15:00:00Z'),
        endAt: new Date('2026-12-03T15:00:00Z'),
        status: 'CONFIRMADA',
        rentalCost: '40.00',
        depositAmount: '10.00',
      },
    });

  const newPayment = (
    reservationId: string,
    attemptNumber: number,
    createdAt: Date,
    id?: string,
  ) =>
    prisma.simulatedPayment.create({
      data: {
        ...(id ? { id } : {}),
        reservationId,
        totalAmount: '50.00',
        rentalCost: '40.00',
        depositAmount: '10.00',
        status: 'PENDIENTE',
        cardLast4: '4242',
        attemptNumber,
        createdAt,
      },
    });

  /** La misma consulta que usará BE-06.1. */
  const latest = (reservationId: string) =>
    prisma.simulatedPayment.findFirst({
      where: { reservationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

  beforeAll(async () => {
    const user = (name: string) =>
      prisma.user.create({
        data: {
          email: `${name}-${suffix}`,
          passwordHash: 'no-es-un-hash-real',
        },
      });
    landlordId = (await user('arrendador')).id;
    tenantId = (await user('arrendatario')).id;
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name: 'Proyector',
          location: 'San Salvador',
          rateAmount: '20.00',
          rateUnit: 'DIA',
          depositAmount: '10.00',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { listingId } },
    });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await prisma.$disconnect();
  });

  it('con varios intentos devuelve el más reciente', async () => {
    const reserva = await newReservation();
    await newPayment(reserva.id, 1, new Date('2026-11-12T16:00:00Z'));
    const ultimo = await newPayment(
      reserva.id,
      3,
      new Date('2026-11-12T16:20:00Z'),
    );
    await newPayment(reserva.id, 2, new Date('2026-11-12T16:10:00Z'));

    expect((await latest(reserva.id))?.id).toBe(ultimo.id);
  });

  it('con cero intentos no devuelve ningún registro', async () => {
    const reserva = await newReservation();

    expect(await latest(reserva.id)).toBeNull();
  });

  it('no mezcla los pagos de otra reserva', async () => {
    const a = await newReservation();
    const b = await newReservation();
    const deA = await newPayment(a.id, 1, new Date('2026-11-12T16:00:00Z'));
    await newPayment(b.id, 1, new Date('2026-11-12T17:00:00Z'));

    expect((await latest(a.id))?.id).toBe(deA.id);
  });

  it('si dos intentos tienen el mismo created_at, desempata por id descendente', async () => {
    const reserva = await newReservation();
    const mismaHora = new Date('2026-11-12T16:00:00Z');
    await newPayment(
      reserva.id,
      1,
      mismaHora,
      '00000000-0000-4000-8000-000000000001',
    );
    await newPayment(
      reserva.id,
      2,
      mismaHora,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    );

    expect((await latest(reserva.id))?.id).toBe(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    );
  });

  it('reutiliza el índice de DB-05.1 y no lo duplica', async () => {
    const indexes = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'simulated_payments'
        AND indexdef ~ '\\(reservation_id, created_at DESC, id DESC\\)'`;
    expect(indexes.map((i) => i.indexname)).toEqual([
      'simulated_payments_reservation_id_created_at_id_idx',
    ]);

    const reserva = await newReservation();
    await newPayment(reserva.id, 1, new Date('2026-11-12T16:00:00Z'));
    // Con tan pocas filas el planificador prefiere recorrer la tabla;
    // se desactiva ese recorrido solo dentro de la transacción.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT id FROM simulated_payments
        WHERE reservation_id = ${reserva.id}::uuid
        ORDER BY created_at DESC, id DESC LIMIT 1`;
    });
    const texto = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(texto).toContain(
      'simulated_payments_reservation_id_created_at_id_idx',
    );
    expect(texto).not.toMatch(/Sort/);
  });
});
