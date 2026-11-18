import { randomUUID } from 'node:crypto';
import { Prisma, type ReservationStatus } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de las columnas de decisión de `reservations` (DB-04.1) y de la
 * estrategia de bloqueo que va a usar BE-04.1 para aprobar.
 *
 * Corre contra la base `_test` local, igual que las demás pruebas de
 * restricciones. Crea sus propios usuarios y publicaciones con un email único
 * y al final borra solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

describe('reservas: decisión del arrendador (DB-04.1)', () => {
  const email = `db-04.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;

  const newListing = () =>
    prisma.listing.create({
      data: {
        landlordId,
        type: 'EQUIPO',
        name: 'Proyector',
        location: 'San Salvador',
        rateAmount: '10.00',
        rateUnit: 'HORA',
      },
    });

  const START = new Date('2026-12-10T09:00:00Z');
  const END = new Date('2026-12-10T12:00:00Z');
  const DECIDED_AT = new Date('2026-12-01T15:30:00Z');
  const hours = (n: number) => new Date(START.getTime() + n * 3_600_000);

  const pending = (listing = listingId) => ({
    listingId: listing,
    tenantId,
    startAt: START,
    endAt: END,
    rentalCost: '30.00',
    depositAmount: '0.00',
  });
  const decided = (status: ReservationStatus) => ({
    ...pending(),
    status,
    decidedAt: DECIDED_AT,
    decidedById: landlordId,
  });

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
    listingId = (await newListing()).id;
  });

  afterAll(async () => {
    // Primero las reservas: sus FK a publicación y usuarios son RESTRICT.
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  describe('columnas de decisión', () => {
    it('una solicitud nueva no tiene decisión', async () => {
      const reservation = await prisma.reservation.create({ data: pending() });

      expect(reservation.status).toBe('PENDIENTE');
      expect(reservation.decidedAt).toBeNull();
      expect(reservation.decidedById).toBeNull();
      expect(reservation.rejectionReason).toBeNull();
    });

    it('guarda la fecha y el autor al confirmar', async () => {
      const created = await prisma.reservation.create({ data: pending() });

      const reservation = await prisma.reservation.update({
        where: { id: created.id },
        data: {
          status: 'CONFIRMADA',
          decidedAt: DECIDED_AT,
          decidedById: landlordId,
        },
        include: { decidedBy: true },
      });

      expect(reservation.status).toBe('CONFIRMADA');
      expect(reservation.decidedAt).toEqual(DECIDED_AT);
      expect(reservation.decidedBy?.id).toBe(landlordId);
      expect(reservation.rejectionReason).toBeNull();
    });

    it('guarda un rechazo sin motivo', async () => {
      const reservation = await prisma.reservation.create({
        data: decided('RECHAZADA'),
      });

      expect(reservation.status).toBe('RECHAZADA');
      expect(reservation.decidedAt).toEqual(DECIDED_AT);
      expect(reservation.rejectionReason).toBeNull();
    });

    it('guarda un rechazo con motivo', async () => {
      const reservation = await prisma.reservation.create({
        data: {
          ...decided('RECHAZADA'),
          rejectionReason: 'Fechas no disponibles',
        },
      });

      expect(reservation.rejectionReason).toBe('Fechas no disponibles');
    });

    it('acepta un motivo de 500 caracteres y rechaza uno de 501', async () => {
      const ok = await prisma.reservation.create({
        data: { ...decided('RECHAZADA'), rejectionReason: 'a'.repeat(500) },
      });
      expect(ok.rejectionReason).toHaveLength(500);

      await expect(
        prisma.reservation.create({
          data: { ...decided('RECHAZADA'), rejectionReason: 'a'.repeat(501) },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['solo saltos de línea y tabs', '\n\t'],
    ])('rechaza un motivo %s', async (_caso, rejectionReason) => {
      await expect(
        prisma.reservation.create({
          data: { ...decided('RECHAZADA'), rejectionReason },
        }),
      ).rejects.toThrow(/reservations_rejection_reason_check/);
    });

    it.each(['CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'] as const)(
      'rechaza un motivo de rechazo en una reserva %s',
      async (status) => {
        await expect(
          prisma.reservation.create({
            data: { ...decided(status), rejectionReason: 'No aplica' },
          }),
        ).rejects.toThrow(/reservations_rejection_reason_check/);
      },
    );

    it('rechaza un motivo de rechazo en una solicitud PENDIENTE', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...pending(), rejectionReason: 'Todavía no se decide' },
        }),
      ).rejects.toThrow(/reservations_rejection_reason_check/);
    });

    it('rechaza una fecha de decisión sin autor', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...pending(), status: 'CONFIRMADA', decidedAt: DECIDED_AT },
        }),
      ).rejects.toThrow(/reservations_decision_pair_check/);
    });

    it('rechaza un autor de decisión sin fecha', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...pending(), status: 'CONFIRMADA', decidedById: landlordId },
        }),
      ).rejects.toThrow(/reservations_decision_pair_check/);
    });

    it('rechaza una solicitud PENDIENTE con decisión', async () => {
      await expect(
        prisma.reservation.create({ data: decided('PENDIENTE') }),
      ).rejects.toThrow(/reservations_pending_undecided_check/);
    });

    it('acepta una reserva CONFIRMADA sin decisión registrada', async () => {
      // Las reservas anteriores a esta migración y las que otros módulos crean
      // directo en la base no tienen decisión: la base no la exige.
      const reservation = await prisma.reservation.create({
        data: { ...pending(), status: 'CONFIRMADA' },
      });

      expect(reservation.decidedAt).toBeNull();
    });

    it('rechaza un autor que no existe (FK)', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...decided('CONFIRMADA'), decidedById: randomUUID() },
        }),
      ).rejects.toThrow();
    });

    it('no deja borrar al usuario que decidió una reserva (RESTRICT)', async () => {
      const decider = await prisma.user.create({
        data: {
          email: `decider-${email}`,
          passwordHash: 'no-es-un-hash-real',
          role: 'ARRENDADOR',
        },
      });
      const reservation = await prisma.reservation.create({
        data: { ...decided('CONFIRMADA'), decidedById: decider.id },
      });

      await expect(
        prisma.user.delete({ where: { id: decider.id } }),
      ).rejects.toThrow();

      await prisma.reservation.delete({ where: { id: reservation.id } });
    });
  });

  describe('índice de solapamientos', () => {
    it('sigue existiendo y no está duplicado', async () => {
      const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'reservations'
          AND indexdef LIKE '%(listing_id, status, start_at, end_at)%'`;

      expect(indexes).toHaveLength(1);
    });

    it('la búsqueda de reservas incompatibles puede usar el índice', async () => {
      // Con pocas filas Postgres prefiere recorrer la tabla; se desactiva el
      // recorrido secuencial solo dentro de esta transacción para ver si el
      // índice sirve para la consulta.
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
        return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM reservations
          WHERE listing_id = ${listingId}::uuid
            AND status IN ('CONFIRMADA', 'EN_CURSO')
            AND start_at < ${END} AND end_at > ${START}`;
      });

      expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'reservations_listing_id_status_start_at_end_at_idx',
      );
    });
  });

  describe('estrategia de aprobación: bloquear la publicación', () => {
    /**
     * La misma secuencia que documenta DB-04.1 para BE-04.1: dentro de una
     * transacción se bloquea la fila de la publicación, se vuelve a leer el
     * estado, se buscan reservas incompatibles y recién entonces se confirma.
     */
    const approve = (reservationId: string) =>
      prisma.$transaction(async (tx) => {
        const [target] = await tx.$queryRaw<
          { listing_id: string; start_at: Date; end_at: Date }[]
        >`SELECT listing_id, start_at, end_at FROM reservations
          WHERE id = ${reservationId}::uuid`;

        await tx.$queryRaw`
          SELECT id FROM listings
          WHERE id = ${target.listing_id}::uuid FOR UPDATE`;

        const current = await tx.reservation.findUniqueOrThrow({
          where: { id: reservationId },
        });
        if (current.status !== 'PENDIENTE') return 'YA_DECIDIDA';

        const conflicts = await tx.reservation.count({
          where: {
            listingId: target.listing_id,
            status: { in: ['CONFIRMADA', 'EN_CURSO'] },
            startAt: { lt: target.end_at },
            endAt: { gt: target.start_at },
          },
        });
        if (conflicts > 0) return 'CONFLICTO';

        await tx.reservation.update({
          where: { id: reservationId },
          data: {
            status: 'CONFIRMADA',
            decidedAt: new Date(),
            decidedById: landlordId,
          },
        });
        return 'CONFIRMADA';
      });

    it('de dos aprobaciones simultáneas que se cruzan solo confirma una', async () => {
      const listing = await newListing();
      const a = await prisma.reservation.create({ data: pending(listing.id) });
      const b = await prisma.reservation.create({
        data: { ...pending(listing.id), startAt: hours(1), endAt: hours(5) },
      });

      const results = await Promise.all([approve(a.id), approve(b.id)]);

      expect([...results].sort()).toEqual(['CONFIRMADA', 'CONFLICTO']);
      const confirmed = await prisma.reservation.count({
        where: { listingId: listing.id, status: 'CONFIRMADA' },
      });
      expect(confirmed).toBe(1);
      // La que perdió sigue PENDIENTE: no se rechaza sola (H04, criterio 7).
      const stillPending = await prisma.reservation.count({
        where: { listingId: listing.id, status: 'PENDIENTE' },
      });
      expect(stillPending).toBe(1);
    });

    it('la misma solicitud aprobada dos veces a la vez se decide una sola vez', async () => {
      const listing = await newListing();
      const reservation = await prisma.reservation.create({
        data: pending(listing.id),
      });

      const results = await Promise.all([
        approve(reservation.id),
        approve(reservation.id),
      ]);

      expect([...results].sort()).toEqual(['CONFIRMADA', 'YA_DECIDIDA']);
    });

    it('dos aprobaciones simultáneas que no se cruzan se confirman las dos', async () => {
      const listing = await newListing();
      const a = await prisma.reservation.create({ data: pending(listing.id) });
      const b = await prisma.reservation.create({
        data: { ...pending(listing.id), startAt: hours(3), endAt: hours(6) },
      });

      const results = await Promise.all([approve(a.id), approve(b.id)]);

      expect(results).toEqual(['CONFIRMADA', 'CONFIRMADA']);
    });

    it('el bloqueo hace esperar a la segunda transacción hasta que termina la primera', async () => {
      const listing = await newListing();
      const events: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let firstHasLock!: () => void;
      const locked = new Promise<void>((resolve) => (firstHasLock = resolve));

      const lock = (tx: Prisma.TransactionClient) =>
        tx.$queryRaw`
          SELECT id FROM listings WHERE id = ${listing.id}::uuid FOR UPDATE`;

      const first = prisma.$transaction(async (tx) => {
        await lock(tx);
        events.push('primera: tiene el bloqueo');
        firstHasLock();
        await gate;
        events.push('primera: termina');
      });

      await locked;
      const second = prisma.$transaction(async (tx) => {
        await lock(tx);
        events.push('segunda: tiene el bloqueo');
      });

      // La segunda queda esperando en el FOR UPDATE mientras la primera sigue.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(events).toEqual(['primera: tiene el bloqueo']);

      release();
      await Promise.all([first, second]);
      expect(events).toEqual([
        'primera: tiene el bloqueo',
        'primera: termina',
        'segunda: tiene el bloqueo',
      ]);
    });
  });
});
