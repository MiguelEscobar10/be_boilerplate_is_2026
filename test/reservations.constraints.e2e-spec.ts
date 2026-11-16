import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ReservationStatus } from '@PrismaClient';

/**
 * Prueba de restricciones de `reservations` y `availability_blocks` (DB-03.1).
 *
 * Igual que las de publicaciones y notificaciones: corre solo contra una base
 * local cuyo nombre termina en `_test` (TEST_DATABASE_URL, o DATABASE_URL +
 * `_test`). Crea su propio arrendador, arrendatario y publicación con un email
 * único y al final borra solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
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

describe('reservas y bloqueos: restricciones (DB-03.1)', () => {
  const email = `db-03.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;

  const newListing = (owner = landlordId) =>
    prisma.listing.create({
      data: {
        landlordId: owner,
        type: 'EQUIPO',
        name: 'Taladro percutor',
        location: 'Antiguo Cuscatlán',
        rateAmount: '15.00',
        rateUnit: 'HORA',
      },
    });

  // Una reserva de 3 horas; cada prueba cambia solo lo que quiere probar.
  const START = new Date('2026-12-01T09:00:00Z');
  const END = new Date('2026-12-01T12:00:00Z');
  const hours = (n: number) => new Date(START.getTime() + n * 3_600_000);
  const valid = () => ({
    listingId,
    tenantId,
    startAt: START,
    endAt: END,
    rentalCost: '45.00',
    depositAmount: '20.00',
  });
  const validBlock = () => ({ listingId, startAt: START, endAt: END });

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
    // Las reservas van primero: sus FK a publicación y usuario son RESTRICT.
    // Los bloqueos se borran solos con la publicación (CASCADE).
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  describe('reservations', () => {
    it('guarda la reserva en PENDIENTE y la relaciona con publicación y arrendatario', async () => {
      const reservation = await prisma.reservation.create({
        data: valid(),
        include: { listing: true, tenant: true },
      });

      expect(reservation.status).toBe('PENDIENTE');
      expect(reservation.createdAt).toBeInstanceOf(Date);
      expect(reservation.listing.id).toBe(listingId);
      expect(reservation.tenant.id).toBe(tenantId);
      expect(reservation.startAt).toEqual(START);
      expect(reservation.endAt).toEqual(END);
    });

    it('guarda los importes con dos decimales', async () => {
      const reservation = await prisma.reservation.create({
        data: { ...valid(), rentalCost: '19.999', depositAmount: '10.005' },
      });

      expect(reservation.rentalCost.toFixed(2)).toBe('20.00');
      expect(reservation.depositAmount.toFixed(2)).toBe('10.01');
    });

    it('el enum ReservationStatus tiene los seis estados de la sección 2.3', async () => {
      const [row] = await prisma.$queryRaw<{ values: string[] }[]>`
        SELECT enum_range(NULL::"ReservationStatus")::text[] AS values`;

      const expected = [
        'PENDIENTE',
        'CONFIRMADA',
        'RECHAZADA',
        'CANCELADA',
        'EN_CURSO',
        'COMPLETADA',
      ];
      expect(row.values).toEqual(expected);
      expect(Object.values(ReservationStatus)).toEqual(expected);
    });

    it.each(Object.values(ReservationStatus))(
      'acepta el estado %s',
      async (status) => {
        const reservation = await prisma.reservation.create({
          data: { ...valid(), status },
        });
        expect(reservation.status).toBe(status);
      },
    );

    it('rechaza un estado fuera del enum', async () => {
      // SQL crudo: el cliente de Prisma ya lo rechazaría antes de llegar a la base.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "reservations" SET "status" = $1::"ReservationStatus" WHERE false`,
          'ANULADA',
        ),
      ).rejects.toThrow(/invalid input value for enum/i);
    });

    it.each([
      ['fin igual al inicio', { endAt: START }],
      ['fin anterior al inicio', { endAt: hours(-1) }],
    ])('rechaza un período con %s', async (_, period) => {
      await expect(
        prisma.reservation.create({ data: { ...valid(), ...period } }),
      ).rejects.toThrow(/reservations_period_check/);
    });

    it('rechaza un costo de alquiler negativo', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...valid(), rentalCost: '-0.01' },
        }),
      ).rejects.toThrow(/reservations_rental_cost_check/);
    });

    it('rechaza un depósito negativo', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...valid(), depositAmount: '-0.01' },
        }),
      ).rejects.toThrow(/reservations_deposit_amount_check/);
    });

    it('acepta importes en cero', async () => {
      const reservation = await prisma.reservation.create({
        data: { ...valid(), rentalCost: '0', depositAmount: '0' },
      });
      expect(reservation.rentalCost.toFixed(2)).toBe('0.00');
      expect(reservation.depositAmount.toFixed(2)).toBe('0.00');
    });

    it('rechaza una publicación que no existe (FK)', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...valid(), listingId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rechaza un arrendatario que no existe (FK)', async () => {
      await expect(
        prisma.reservation.create({
          data: { ...valid(), tenantId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('no deja borrar una publicación que tiene reservas (RESTRICT)', async () => {
      const listing = await newListing();
      await prisma.reservation.create({
        data: { ...valid(), listingId: listing.id },
      });

      await expect(
        prisma.listing.delete({ where: { id: listing.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('no deja borrar a un arrendatario que tiene reservas (RESTRICT)', async () => {
      const other = await prisma.user.create({
        data: { email: `restrict-${email}`, passwordHash: 'x' },
      });
      await prisma.reservation.create({
        data: { ...valid(), tenantId: other.id },
      });

      await expect(
        prisma.user.delete({ where: { id: other.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('tiene el índice (listing_id, status, start_at, end_at) para buscar solapamientos', async () => {
      const [row] = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'reservations'
          AND indexname = 'reservations_listing_id_status_start_at_end_at_idx'`;

      expect(row.indexdef).toContain('(listing_id, status, start_at, end_at)');
    });

    it('encuentra las reservas CONFIRMADA o EN_CURSO que se cruzan con un rango', async () => {
      const listing = await newListing();
      const create = (status: ReservationStatus, from: number, to: number) =>
        prisma.reservation.create({
          data: {
            ...valid(),
            listingId: listing.id,
            status,
            startAt: hours(from),
            endAt: hours(to),
          },
        });
      const confirmed = await create('CONFIRMADA', 0, 3);
      const inProgress = await create('EN_CURSO', 2, 5);
      await create('PENDIENTE', 1, 4); // se cruza, pero no ocupa fechas
      await create('RECHAZADA', 1, 4); // se cruza, pero no ocupa fechas
      await create('CONFIRMADA', 10, 12); // fuera del rango

      // Rango pedido: de la hora 1 a la hora 4.
      const found = await prisma.reservation.findMany({
        where: {
          listingId: listing.id,
          status: { in: ['CONFIRMADA', 'EN_CURSO'] },
          startAt: { lt: hours(4) },
          endAt: { gt: hours(1) },
        },
        orderBy: { startAt: 'asc' },
      });

      expect(found.map((r) => r.id)).toEqual([confirmed.id, inProgress.id]);
    });
  });

  describe('availability_blocks', () => {
    it('guarda un bloqueo sin motivo y otro con motivo', async () => {
      const without = await prisma.availabilityBlock.create({
        data: validBlock(),
      });
      const withReason = await prisma.availabilityBlock.create({
        data: { ...validBlock(), reason: 'Mantenimiento del equipo' },
      });

      expect(without.reason).toBeNull();
      expect(withReason.reason).toBe('Mantenimiento del equipo');
      expect(withReason.listingId).toBe(listingId);
    });

    it.each([
      ['fin igual al inicio', { endAt: START }],
      ['fin anterior al inicio', { endAt: hours(-1) }],
    ])('rechaza un bloqueo con %s', async (_, period) => {
      await expect(
        prisma.availabilityBlock.create({
          data: { ...validBlock(), ...period },
        }),
      ).rejects.toThrow(/availability_blocks_period_check/);
    });

    it('acepta un motivo de 200 caracteres y rechaza uno de 201', async () => {
      const ok = await prisma.availabilityBlock.create({
        data: { ...validBlock(), reason: 'a'.repeat(200) },
      });
      expect(ok.reason).toHaveLength(200);

      await expect(
        prisma.availabilityBlock.create({
          data: { ...validBlock(), reason: 'a'.repeat(201) },
        }),
      ).rejects.toMatchObject({ code: 'P2000' });
    });

    it('rechaza una publicación que no existe (FK)', async () => {
      await expect(
        prisma.availabilityBlock.create({
          data: { ...validBlock(), listingId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('borra los bloqueos al borrar la publicación (ON DELETE CASCADE)', async () => {
      const listing = await newListing();
      await prisma.availabilityBlock.create({
        data: { ...validBlock(), listingId: listing.id },
      });

      await prisma.listing.delete({ where: { id: listing.id } });

      expect(
        await prisma.availabilityBlock.count({
          where: { listingId: listing.id },
        }),
      ).toBe(0);
    });
  });
});
