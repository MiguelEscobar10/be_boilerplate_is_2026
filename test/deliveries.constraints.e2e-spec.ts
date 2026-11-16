import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de restricciones de `deliveries` y `delivery_photos` (DB-08.1).
 *
 * Igual que las demás pruebas de restricciones: corre solo contra una base
 * local cuyo nombre termina en `_test`. Crea su propio arrendador,
 * arrendatario, publicación y reservas con un email único y al final borra
 * solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

describe('entregas: restricciones (DB-08.1)', () => {
  const email = `db-08.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;

  const START = new Date('2026-12-01T09:00:00Z');
  const END = new Date('2026-12-01T12:00:00Z');

  const newReservation = (status: 'CONFIRMADA' | 'PENDIENTE' = 'CONFIRMADA') =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId,
        startAt: START,
        endAt: END,
        status,
        rentalCost: '45.00',
        depositAmount: '20.00',
      },
    });

  const delivery = (
    reservationId: string,
    note = 'Equipo completo, sin rayones',
  ) =>
    ({
      reservationId,
      initialConditionNote: note,
      registeredById: landlordId,
    }) as const;

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
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name: 'Taladro percutor',
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'HORA',
        },
      })
    ).id;
  });

  afterAll(async () => {
    // Las entregas van primero: su FK a la reserva y al usuario es RESTRICT.
    // Las fotos se borran solas con la entrega (CASCADE).
    await prisma.delivery.deleteMany({
      where: { reservation: { tenant: { email: { endsWith: email } } } },
    });
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  describe('deliveries', () => {
    it('guarda la entrega con la fecha real, la nota y quién la registró', async () => {
      const reservation = await newReservation();

      const saved = await prisma.delivery.create({
        data: delivery(reservation.id),
        include: { reservation: true, registeredBy: true },
      });

      expect(saved.deliveredAt).toBeInstanceOf(Date);
      expect(saved.initialConditionNote).toBe('Equipo completo, sin rayones');
      expect(saved.reservation.id).toBe(reservation.id);
      expect(saved.registeredBy.id).toBe(landlordId);
    });

    it('una reserva tiene como máximo una entrega (UNIQUE reservation_id)', async () => {
      const reservation = await newReservation();
      await prisma.delivery.create({ data: delivery(reservation.id) });

      await expect(
        prisma.delivery.create({ data: delivery(reservation.id, 'Otra') }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(
        await prisma.delivery.count({
          where: { reservationId: reservation.id },
        }),
      ).toBe(1);
    });

    it('acepta una nota de 500 caracteres y rechaza una de 501', async () => {
      const ok = await prisma.delivery.create({
        data: delivery((await newReservation()).id, 'a'.repeat(500)),
      });
      expect(ok.initialConditionNote).toHaveLength(500);

      await expect(
        prisma.delivery.create({
          data: delivery((await newReservation()).id, 'a'.repeat(501)),
        }),
      ).rejects.toMatchObject({ code: 'P2000' });
    });

    it.each([
      ['vacía', ''],
      ['solo espacios', '   '],
      ['solo saltos de línea y tabs', '\n\t\n'],
    ])('rechaza una nota %s', async (_, note) => {
      const reservation = await newReservation();

      await expect(
        prisma.delivery.create({ data: delivery(reservation.id, note) }),
      ).rejects.toThrow(/deliveries_initial_condition_note_check/);
    });

    it('rechaza una reserva que no existe (FK)', async () => {
      await expect(
        prisma.delivery.create({ data: delivery(randomUUID()) }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rechaza un usuario que no existe (FK)', async () => {
      const reservation = await newReservation();

      await expect(
        prisma.delivery.create({
          data: { ...delivery(reservation.id), registeredById: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('no deja borrar una reserva que tiene entrega (RESTRICT)', async () => {
      const reservation = await newReservation();
      await prisma.delivery.create({ data: delivery(reservation.id) });

      await expect(
        prisma.reservation.delete({ where: { id: reservation.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('registra la entrega y pasa la reserva a EN_CURSO en una sola transacción', async () => {
      const reservation = await newReservation();

      await prisma.$transaction([
        prisma.delivery.create({ data: delivery(reservation.id) }),
        prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: 'EN_CURSO' },
        }),
      ]);

      const after = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservation.id },
        include: { delivery: true },
      });
      expect(after.status).toBe('EN_CURSO');
      expect(after.delivery).not.toBeNull();
    });

    it('si la entrega falla (duplicada), la reserva no cambia de estado', async () => {
      const reservation = await newReservation();
      await prisma.delivery.create({ data: delivery(reservation.id) });

      await expect(
        prisma.$transaction([
          prisma.reservation.update({
            where: { id: reservation.id },
            data: { status: 'EN_CURSO' },
          }),
          prisma.delivery.create({ data: delivery(reservation.id, 'Otra') }),
        ]),
      ).rejects.toMatchObject({ code: 'P2002' });

      const after = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });
      expect(after.status).toBe('CONFIRMADA');
    });
  });

  describe('delivery_photos', () => {
    it('guarda hasta 5 fotos en orden, de la posición 0 a la 4', async () => {
      const { id } = await prisma.delivery.create({
        data: delivery((await newReservation()).id),
      });

      await prisma.deliveryPhoto.createMany({
        data: [0, 1, 2, 3, 4].map((position) => ({
          deliveryId: id,
          path: `entregas/${randomUUID()}.jpg`,
          position,
        })),
      });

      const photos = await prisma.deliveryPhoto.findMany({
        where: { deliveryId: id },
        orderBy: { position: 'asc' },
      });
      expect(photos.map((p) => p.position)).toEqual([0, 1, 2, 3, 4]);
    });

    it.each([
      ['una sexta foto (posición 5)', 5],
      ['una posición negativa', -1],
    ])('rechaza %s', async (_, position) => {
      const { id } = await prisma.delivery.create({
        data: delivery((await newReservation()).id),
      });

      await expect(
        prisma.deliveryPhoto.create({
          data: { deliveryId: id, path: 'entregas/x.jpg', position },
        }),
      ).rejects.toThrow(/delivery_photos_position_check/);
    });

    it('rechaza dos fotos en la misma posición', async () => {
      const { id } = await prisma.delivery.create({
        data: delivery((await newReservation()).id),
      });
      await prisma.deliveryPhoto.create({
        data: { deliveryId: id, path: 'entregas/a.jpg', position: 0 },
      });

      await expect(
        prisma.deliveryPhoto.create({
          data: { deliveryId: id, path: 'entregas/b.jpg', position: 0 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('rechaza una ruta vacía', async () => {
      const { id } = await prisma.delivery.create({
        data: delivery((await newReservation()).id),
      });

      await expect(
        prisma.deliveryPhoto.create({
          data: { deliveryId: id, path: '  ', position: 0 },
        }),
      ).rejects.toThrow(/delivery_photos_path_check/);
    });

    it('rechaza una entrega que no existe (FK)', async () => {
      await expect(
        prisma.deliveryPhoto.create({
          data: {
            deliveryId: randomUUID(),
            path: 'entregas/x.jpg',
            position: 0,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('borra las fotos al borrar la entrega (ON DELETE CASCADE)', async () => {
      const { id } = await prisma.delivery.create({
        data: delivery((await newReservation()).id),
      });
      await prisma.deliveryPhoto.create({
        data: { deliveryId: id, path: 'entregas/a.jpg', position: 0 },
      });

      await prisma.delivery.delete({ where: { id } });

      expect(
        await prisma.deliveryPhoto.count({ where: { deliveryId: id } }),
      ).toBe(0);
    });

    it('una entrega sin fotos es válida (son opcionales)', async () => {
      const saved = await prisma.delivery.create({
        data: delivery((await newReservation()).id),
        include: { photos: true },
      });
      expect(saved.photos).toEqual([]);
    });
  });
});
