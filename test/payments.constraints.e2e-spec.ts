import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de restricciones de `simulated_payments` (DB-05.1).
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

type PaymentData = {
  reservationId?: string;
  totalAmount?: string;
  rentalCost?: string;
  depositAmount?: string;
  status?: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  cardLast4?: string;
  rejectionReason?: string | null;
  attemptNumber?: number;
};

describe('pagos simulados: restricciones (DB-05.1)', () => {
  const suffix = `db-05.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;
  let reservationId: string;
  let otherReservationId: string;

  const newUser = (name: string) =>
    prisma.user.create({
      data: { email: `${name}-${suffix}`, passwordHash: 'no-es-un-hash-real' },
    });

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

  const newPayment = (data: PaymentData = {}) =>
    prisma.simulatedPayment.create({
      data: {
        reservationId: data.reservationId ?? reservationId,
        totalAmount: data.totalAmount ?? '50.00',
        rentalCost: data.rentalCost ?? '40.00',
        depositAmount: data.depositAmount ?? '10.00',
        status: data.status,
        cardLast4: data.cardLast4 ?? '4242',
        rejectionReason: data.rejectionReason,
        attemptNumber: data.attemptNumber ?? 1,
      },
    });

  beforeAll(async () => {
    landlordId = (await newUser('arrendador')).id;
    tenantId = (await newUser('arrendatario')).id;
    const listing = await prisma.listing.create({
      data: {
        landlordId,
        type: 'EQUIPO',
        name: 'Proyector',
        location: 'San Salvador',
        rateAmount: '20.00',
        rateUnit: 'DIA',
        depositAmount: '10.00',
      },
    });
    listingId = listing.id;
    reservationId = (await newReservation()).id;
    otherReservationId = (await newReservation()).id;
  });

  afterAll(async () => {
    // Orden por las FK RESTRICT: pagos, reservas, publicación, usuarios.
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { listingId } },
    });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { listingId } },
    });
  });

  it('guarda un intento válido con sus valores por defecto', async () => {
    const payment = await newPayment({ totalAmount: '50.004' });

    expect(payment.status).toBe('PENDIENTE');
    expect(payment.rejectionReason).toBeNull();
    expect(payment.createdAt).toBeInstanceOf(Date);
    expect(payment.totalAmount.toFixed(2)).toBe('50.00');
    expect(payment.cardLast4).toBe('4242');
  });

  it('rechaza una reserva que no existe (FK)', async () => {
    await expect(
      newPayment({ reservationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it.each([
    [
      'total_amount',
      { totalAmount: '-1.00', rentalCost: '-1.00', depositAmount: '0.00' },
      /simulated_payments_(total_amount|rental_cost)_check/,
    ],
    [
      'rental_cost',
      { totalAmount: '10.00', rentalCost: '-5.00', depositAmount: '15.00' },
      /simulated_payments_rental_cost_check/,
    ],
    [
      'deposit_amount',
      { totalAmount: '10.00', rentalCost: '15.00', depositAmount: '-5.00' },
      /simulated_payments_deposit_amount_check/,
    ],
  ])('rechaza %s negativo', async (_column, amounts, error) => {
    await expect(newPayment(amounts)).rejects.toThrow(error);
  });

  it('acepta importes en cero', async () => {
    await expect(
      newPayment({ totalAmount: '0', rentalCost: '0', depositAmount: '0' }),
    ).resolves.toBeDefined();
  });

  it('rechaza un total que no es costo + depósito', async () => {
    await expect(newPayment({ totalAmount: '49.99' })).rejects.toThrow(
      /simulated_payments_total_matches_parts_check/,
    );
  });

  it.each([1, 2, 3])('acepta el intento %i', async (attemptNumber) => {
    await expect(newPayment({ attemptNumber })).resolves.toBeDefined();
  });

  it.each([0, 4])('rechaza el intento %i', async (attemptNumber) => {
    await expect(newPayment({ attemptNumber })).rejects.toThrow(
      /simulated_payments_attempt_number_check/,
    );
  });

  it('rechaza repetir el número de intento en la misma reserva', async () => {
    await newPayment({
      attemptNumber: 1,
      status: 'RECHAZADO',
      rejectionReason: 'Fondos insuficientes',
    });

    await expect(newPayment({ attemptNumber: 1 })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('el mismo número de intento sí se usa en otra reserva', async () => {
    await newPayment({ attemptNumber: 1 });

    await expect(
      newPayment({ reservationId: otherReservationId, attemptNumber: 1 }),
    ).resolves.toBeDefined();
  });

  it('rechaza un segundo APROBADO en la misma reserva', async () => {
    await newPayment({ attemptNumber: 1, status: 'APROBADO' });

    await expect(
      newPayment({ attemptNumber: 2, status: 'APROBADO' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cada reserva puede tener su propio APROBADO', async () => {
    await newPayment({ status: 'APROBADO' });

    await expect(
      newPayment({ reservationId: otherReservationId, status: 'APROBADO' }),
    ).resolves.toBeDefined();
  });

  it('conserva los RECHAZADO anteriores y el APROBADO final en el historial', async () => {
    const reason = 'Tarjeta rechazada por el emisor';
    const first = await newPayment({
      attemptNumber: 1,
      status: 'RECHAZADO',
      rejectionReason: reason,
      cardLast4: '0002',
    });
    const second = await newPayment({
      attemptNumber: 2,
      status: 'RECHAZADO',
      rejectionReason: reason,
      cardLast4: '0002',
    });
    const third = await newPayment({ attemptNumber: 3, status: 'APROBADO' });

    const history = await prisma.simulatedPayment.findMany({
      where: { reservationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    expect(history).toHaveLength(3);
    expect(history.map((p) => p.id).sort()).toEqual(
      [first.id, second.id, third.id].sort(),
    );
    expect(history.filter((p) => p.status === 'RECHAZADO')).toHaveLength(2);
  });

  it.each([
    ['con letras', '42a2'],
    ['con un espacio', '42 2'],
    ['de 3 dígitos', '424'],
  ])('rechaza una tarjeta %s', async (_case, cardLast4) => {
    await expect(newPayment({ cardLast4 })).rejects.toThrow(
      /simulated_payments_card_last4_check/,
    );
  });

  it('rechaza una tarjeta de 5 dígitos (CHAR(4))', async () => {
    await expect(newPayment({ cardLast4: '42424' })).rejects.toMatchObject({
      code: 'P2000',
    });
  });

  it('exige motivo en un RECHAZADO', async () => {
    await expect(newPayment({ status: 'RECHAZADO' })).rejects.toThrow(
      /simulated_payments_rejection_reason_check/,
    );
  });

  it('rechaza un motivo de solo espacios en un RECHAZADO', async () => {
    await expect(
      newPayment({ status: 'RECHAZADO', rejectionReason: '   ' }),
    ).rejects.toThrow(/simulated_payments_rejection_reason_check/);
  });

  it.each(['PENDIENTE', 'APROBADO'] as const)(
    'rechaza un motivo en un %s',
    async (status) => {
      await expect(
        newPayment({ status, rejectionReason: 'No aplica' }),
      ).rejects.toThrow(/simulated_payments_rejection_reason_check/);
    },
  );

  it('rechaza un motivo de más de 200 caracteres', async () => {
    await expect(
      newPayment({ status: 'RECHAZADO', rejectionReason: 'a'.repeat(201) }),
    ).rejects.toMatchObject({ code: 'P2000' });
  });

  it('crea los índices del historial y del APROBADO único', async () => {
    const indexes = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'simulated_payments'`;
    const byName = new Map(indexes.map((i) => [i.indexname, i.indexdef]));

    expect(
      byName.get('simulated_payments_reservation_id_created_at_id_idx'),
    ).toMatch(/created_at DESC, id DESC/);
    expect(
      byName.get('simulated_payments_one_approved_per_reservation_key'),
    ).toMatch(/UNIQUE.*WHERE \(status = 'APROBADO'/);
  });

  it('no deja borrar una reserva que tiene pagos (RESTRICT)', async () => {
    await newPayment();

    await expect(
      prisma.reservation.delete({ where: { id: reservationId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});
