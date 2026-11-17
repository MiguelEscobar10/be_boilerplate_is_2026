import { randomUUID } from 'node:crypto';
import { Prisma } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de la consulta de ingresos por bien (DB-21.1): la función
 * `listing_income(landlord_id, from, to)` y el índice
 * `simulated_payments(status, created_at)`.
 *
 * Misma regla que las demás pruebas de base: solo corre contra una base local
 * cuyo nombre termina en `_test` (ver test/helpers/test-database.ts), y al
 * final borra solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

type IncomeRow = {
  listing_id: string;
  listing_name: string;
  is_active: boolean;
  income: Prisma.Decimal;
  income_text: string;
};

type PaymentData = {
  reservationId: string;
  rentalCost?: string;
  depositAmount?: string;
  status?: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  attemptNumber?: number;
  createdAt?: Date;
};

// Rango de noviembre de 2026 en UTC: [FROM, TO).
const FROM = new Date('2026-11-01T00:00:00.000Z');
const TO = new Date('2026-12-01T00:00:00.000Z');
const IN_RANGE = new Date('2026-11-15T12:00:00.000Z');

describe('ingresos por bien: consulta listing_income (DB-21.1)', () => {
  const suffix = `db-21.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let otherLandlordId: string;
  let tenantId: string;
  // Bienes del arrendador, en el orden en que los devuelve la consulta.
  let projectorId: string;
  let roomId: string;
  let inactiveId: string;
  // Bien de otro arrendador.
  let foreignId: string;

  const newUser = (name: string) =>
    prisma.user.create({
      data: { email: `${name}-${suffix}`, passwordHash: 'no-es-un-hash-real' },
    });

  const newListing = (owner: string, name: string, isActive = true) =>
    prisma.listing.create({
      data: {
        landlordId: owner,
        type: 'EQUIPO',
        name,
        location: 'San Salvador',
        rateAmount: '20.00',
        rateUnit: 'DIA',
        depositAmount: '15.00',
        isActive,
      },
    });

  const newReservation = async (listingId: string) =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId,
          startAt: new Date('2026-12-10T15:00:00Z'),
          endAt: new Date('2026-12-12T15:00:00Z'),
          status: 'CONFIRMADA',
          rentalCost: '40.00',
          depositAmount: '15.00',
        },
      })
    ).id;

  const newPayment = (data: PaymentData) => {
    const rentalCost = new Prisma.Decimal(data.rentalCost ?? '40.00');
    const depositAmount = new Prisma.Decimal(data.depositAmount ?? '15.00');
    const status = data.status ?? 'APROBADO';
    return prisma.simulatedPayment.create({
      data: {
        reservationId: data.reservationId,
        rentalCost,
        depositAmount,
        totalAmount: rentalCost.plus(depositAmount),
        status,
        cardLast4: status === 'RECHAZADO' ? '0002' : '4242',
        rejectionReason:
          status === 'RECHAZADO'
            ? 'Tarjeta rechazada por la pasarela de prueba'
            : null,
        attemptNumber: data.attemptNumber ?? 1,
        createdAt: data.createdAt ?? IN_RANGE,
      },
    });
  };

  /** Un pago APROBADO en su propia reserva del bien. */
  const approvedPayment = async (
    listingId: string,
    rentalCost: string,
    createdAt: Date = IN_RANGE,
  ) =>
    newPayment({
      reservationId: await newReservation(listingId),
      rentalCost,
      createdAt,
    });

  // Llamada igual a la que hará BE-21.1: fechas como Date de JS y parámetros
  // casteados.
  const income = (
    landlord: string,
    from: Date = FROM,
    to: Date = TO,
    client: Pick<typeof prisma, '$queryRaw'> = prisma,
  ) => client.$queryRaw<IncomeRow[]>`
    SELECT listing_id, listing_name, is_active, income, income::text AS income_text
    FROM listing_income(${landlord}::uuid, ${from}::timestamp, ${to}::timestamp)`;

  const incomeOf = async (listingId: string, from?: Date, to?: Date) => {
    const rows = await income(landlordId, from, to);
    return rows.find((r) => r.listing_id === listingId)?.income_text;
  };

  beforeAll(async () => {
    landlordId = (await newUser('arrendador')).id;
    otherLandlordId = (await newUser('otro-arrendador')).id;
    tenantId = (await newUser('arrendatario')).id;
    projectorId = (await newListing(landlordId, 'A Proyector')).id;
    roomId = (await newListing(landlordId, 'B Sala de reuniones')).id;
    inactiveId = (await newListing(landlordId, 'C Bodega', false)).id;
    foreignId = (await newListing(otherLandlordId, 'Taladro ajeno')).id;
  });

  const listingIds = () => [projectorId, roomId, inactiveId, foreignId];

  afterEach(async () => {
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { listingId: { in: listingIds() } } },
    });
    await prisma.reservation.deleteMany({
      where: { listingId: { in: listingIds() } },
    });
  });

  afterAll(async () => {
    // Orden por las FK RESTRICT: pagos, reservas, publicaciones, usuarios.
    await prisma.listing.deleteMany({ where: { id: { in: listingIds() } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await prisma.$disconnect();
  });

  it('devuelve la suma por publicación con dos decimales', async () => {
    await approvedPayment(projectorId, '0.10');
    await approvedPayment(projectorId, '0.20');
    await approvedPayment(roomId, '25.5');

    const rows = await income(landlordId);

    expect(rows.map((r) => [r.listing_name, r.income_text])).toEqual([
      ['A Proyector', '0.30'],
      ['B Sala de reuniones', '25.50'],
      ['C Bodega', '0.00'],
    ]);
    expect(rows[0].income).toBeInstanceOf(Prisma.Decimal);
    expect(rows[0].income.toFixed(2)).toBe('0.30');
  });

  it('suma varias reservas y varios pagos del mismo bien', async () => {
    // Reserva con dos rechazos y el APROBADO final: solo cuenta el aprobado.
    const reservationId = await newReservation(projectorId);
    await newPayment({ reservationId, status: 'RECHAZADO', attemptNumber: 1 });
    await newPayment({ reservationId, status: 'RECHAZADO', attemptNumber: 2 });
    await newPayment({ reservationId, rentalCost: '40.00', attemptNumber: 3 });
    // Otras dos reservas del mismo bien, cada una con su APROBADO.
    await approvedPayment(projectorId, '60.00');
    await approvedPayment(projectorId, '30.25');

    expect(await incomeOf(projectorId)).toBe('130.25');
  });

  it.each(['PENDIENTE', 'RECHAZADO'] as const)(
    'no cuenta un pago %s',
    async (status) => {
      await newPayment({
        reservationId: await newReservation(projectorId),
        status,
        rentalCost: '99.00',
      });
      await approvedPayment(projectorId, '10.00');

      expect(await incomeOf(projectorId)).toBe('10.00');
    },
  );

  it('no suma el depósito', async () => {
    await newPayment({
      reservationId: await newReservation(projectorId),
      rentalCost: '40.00',
      depositAmount: '500.00',
    });

    expect(await incomeOf(projectorId)).toBe('40.00');
  });

  it.each([
    ['justo en el inicio', 'cuenta', FROM, true],
    ['1 ms antes del inicio', 'no cuenta', new Date(FROM.getTime() - 1), false],
    ['1 ms antes del fin', 'cuenta', new Date(TO.getTime() - 1), true],
    ['justo en el fin', 'no cuenta', TO, false],
  ] as const)('un pago %s %s', async (_case, _verb, createdAt, counts) => {
    await approvedPayment(projectorId, '12.34', createdAt);

    expect(await incomeOf(projectorId)).toBe(counts ? '12.34' : '0.00');
  });

  it('un bien sin ingresos en el rango aparece con 0.00', async () => {
    // Tiene un pago APROBADO, pero en octubre.
    await approvedPayment(roomId, '80.00', new Date('2026-10-20T12:00:00Z'));

    expect(await incomeOf(roomId)).toBe('0.00');
  });

  it('incluye los bienes desactivados, con su is_active', async () => {
    await approvedPayment(inactiveId, '45.00');

    const rows = await income(landlordId);
    const inactive = rows.find((r) => r.listing_id === inactiveId);

    expect(inactive).toMatchObject({ is_active: false, income_text: '45.00' });
    expect(rows.find((r) => r.listing_id === roomId)).toMatchObject({
      is_active: true,
      income_text: '0.00',
    });
  });

  it('no devuelve bienes de otro arrendador', async () => {
    await approvedPayment(foreignId, '70.00');
    await approvedPayment(projectorId, '5.00');

    const mine = await income(landlordId);
    const theirs = await income(otherLandlordId);

    expect(mine.map((r) => r.listing_id)).toEqual([
      projectorId,
      roomId,
      inactiveId,
    ]);
    expect(theirs).toEqual([
      expect.objectContaining({ listing_id: foreignId, income_text: '70.00' }),
    ]);
  });

  it('un arrendador sin bienes no recibe filas', async () => {
    expect(await income(tenantId)).toEqual([]);
  });

  it('con desde >= hasta no cuenta ningún pago', async () => {
    await approvedPayment(projectorId, '10.00');

    const rows = await income(landlordId, TO, FROM);

    expect(rows.map((r) => r.income_text)).toEqual(['0.00', '0.00', '0.00']);
  });

  it('con fechas Date no depende de la zona horaria del servidor', async () => {
    // Pagos en los dos bordes, que se moverían si alguna capa convirtiera la
    // fecha a hora local.
    await approvedPayment(projectorId, '1.00', FROM);
    await approvedPayment(projectorId, '2.00', new Date(TO.getTime() - 1));
    await approvedPayment(projectorId, '4.00', TO);
    const expected = '3.00';

    const originalTz = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/El_Salvador', 'Asia/Tokyo']) {
        // Zona del proceso de Node (la del servidor del backend)...
        process.env.TZ = tz;
        // ...y la de la sesión de Postgres, dentro de una transacción.
        const rows = await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${tz}'`);
          return income(landlordId, FROM, TO, tx);
        });

        expect(
          rows.find((r) => r.listing_id === projectorId)?.income_text,
          `zona ${tz}`,
        ).toBe(expected);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('crea el índice (status, created_at) en simulated_payments', async () => {
    const [index] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'simulated_payments'
        AND indexname = 'simulated_payments_status_created_at_idx'`;

    expect(index?.indexdef).toMatch(/\(status, created_at\)/);
  });

  it('crea la función listing_income(uuid, timestamp, timestamp)', async () => {
    const [fn] = await prisma.$queryRaw<{ args: string; volatility: string }[]>`
      SELECT pg_get_function_identity_arguments(p.oid) AS args,
             p.provolatile::text AS volatility
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = current_schema() AND p.proname = 'listing_income'`;

    expect(fn).toEqual({
      args: 'p_landlord_id uuid, p_from timestamp without time zone, p_to timestamp without time zone',
      volatility: 's',
    });
  });
});
