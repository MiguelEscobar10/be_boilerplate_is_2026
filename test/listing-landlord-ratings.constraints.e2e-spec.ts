import { randomUUID } from 'node:crypto';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de restricciones de `listing_landlord_ratings` (DB-17.1): la
 * calificación que el arrendatario le da al bien y a su arrendador al terminar
 * una reserva.
 *
 * Corre contra la base `_test` local. Crea sus propios usuarios, publicaciones
 * y reservas con un email único y al final borra solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

describe('calificación del bien y del arrendador: restricciones (DB-17.1)', () => {
  const email = `db-17.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let otherLandlordId: string;
  let tenantId: string;
  let otherTenantId: string;
  let listingId: string;
  let otherListingId: string;

  const newReservation = async (
    over: { listingId?: string; tenantId?: string } = {},
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId: over.listingId ?? listingId,
          tenantId: over.tenantId ?? tenantId,
          startAt: new Date('2026-10-01T09:00:00Z'),
          endAt: new Date('2026-10-01T12:00:00Z'),
          status: 'COMPLETADA',
          rentalCost: '30.00',
          depositAmount: '0.00',
        },
      })
    ).id;

  // Cada prueba califica una reserva nueva, porque solo admite una.
  const valid = async () => ({
    reservationId: await newReservation(),
    authorId: tenantId,
    listingId,
    landlordId,
    listingScore: 5,
    landlordScore: 4,
  });

  const newUser = (kind: string, role: 'ARRENDADOR' | 'ARRENDATARIO') =>
    prisma.user.create({
      data: {
        email: `${kind}-${email}`,
        passwordHash: 'no-es-un-hash-real',
        role,
      },
    });

  const newListing = (ownerId: string, name: string) =>
    prisma.listing.create({
      data: {
        landlordId: ownerId,
        type: 'EQUIPO',
        name,
        location: 'Soyapango',
        rateAmount: '30.00',
        rateUnit: 'HORA',
      },
    });

  beforeAll(async () => {
    const landlord = await newUser('landlord', 'ARRENDADOR');
    const otherLandlord = await newUser('other-landlord', 'ARRENDADOR');
    const tenant = await newUser('tenant', 'ARRENDATARIO');
    const otherTenant = await newUser('other-tenant', 'ARRENDATARIO');
    landlordId = landlord.id;
    otherLandlordId = otherLandlord.id;
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
    listingId = (await newListing(landlordId, 'Generador')).id;
    otherListingId = (await newListing(otherLandlordId, 'Andamio')).id;
  });

  afterAll(async () => {
    // De abajo hacia arriba: todas las FK son RESTRICT.
    await prisma.listingLandlordRating.deleteMany({
      where: { author: { email: { endsWith: email } } },
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

  it('guarda la calificación con su reserva, autor, publicación y arrendador', async () => {
    const data = await valid();
    const rating = await prisma.listingLandlordRating.create({
      data: { ...data, comment: 'Todo en orden' },
      include: {
        reservation: true,
        author: true,
        listing: true,
        landlord: true,
      },
    });

    expect(rating.listingScore).toBe(5);
    expect(rating.landlordScore).toBe(4);
    expect(rating.comment).toBe('Todo en orden');
    expect(rating.createdAt).toBeInstanceOf(Date);
    expect(rating.reservation.id).toBe(data.reservationId);
    expect(rating.author.id).toBe(tenantId);
    expect(rating.listing.id).toBe(listingId);
    expect(rating.landlord.id).toBe(landlordId);
  });

  it('guarda una calificación sin comentario', async () => {
    const rating = await prisma.listingLandlordRating.create({
      data: await valid(),
    });

    expect(rating.comment).toBeNull();
  });

  it('se puede leer desde la reserva, la publicación y el arrendador', async () => {
    const data = await valid();
    await prisma.listingLandlordRating.create({ data });

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: data.reservationId },
      include: { listingLandlordRating: true },
    });
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: { ratings: true },
    });
    const landlord = await prisma.user.findUniqueOrThrow({
      where: { id: landlordId },
      include: { listingRatingsReceived: true },
    });
    const author = await prisma.user.findUniqueOrThrow({
      where: { id: tenantId },
      include: { listingRatingsWritten: true },
    });

    expect(reservation.listingLandlordRating?.listingScore).toBe(5);
    expect(listing.ratings.length).toBeGreaterThan(0);
    expect(landlord.listingRatingsReceived.length).toBeGreaterThan(0);
    expect(author.listingRatingsWritten.length).toBeGreaterThan(0);
  });

  it.each([1, 2, 3, 4, 5])('acepta el puntaje %i en los dos', async (score) => {
    const rating = await prisma.listingLandlordRating.create({
      data: {
        ...(await valid()),
        listingScore: score,
        landlordScore: score,
      },
    });

    expect(rating.listingScore).toBe(score);
    expect(rating.landlordScore).toBe(score);
  });

  it('los dos puntajes son independientes', async () => {
    const rating = await prisma.listingLandlordRating.create({
      data: { ...(await valid()), listingScore: 5, landlordScore: 1 },
    });

    expect(rating.listingScore).toBe(5);
    expect(rating.landlordScore).toBe(1);
  });

  it.each([0, 6, -1, 100])('rechaza el puntaje del bien %i', async (score) => {
    const data = await valid();

    await expect(
      prisma.listingLandlordRating.create({
        data: { ...data, listingScore: score },
      }),
    ).rejects.toThrow(/listing_landlord_ratings_listing_score_check/);
  });

  it.each([0, 6, -1, 100])(
    'rechaza el puntaje del arrendador %i',
    async (score) => {
      const data = await valid();

      await expect(
        prisma.listingLandlordRating.create({
          data: { ...data, landlordScore: score },
        }),
      ).rejects.toThrow(/listing_landlord_ratings_landlord_score_check/);
    },
  );

  it('rechaza una segunda calificación de la misma reserva', async () => {
    const data = await valid();
    await prisma.listingLandlordRating.create({ data });

    await expect(
      prisma.listingLandlordRating.create({
        data: { ...data, listingScore: 1, landlordScore: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const ratings = await prisma.listingLandlordRating.findMany({
      where: { reservationId: data.reservationId },
    });
    expect(ratings).toHaveLength(1);
    expect(ratings[0].listingScore).toBe(5);
  });

  it('de dos calificaciones simultáneas de la misma reserva solo guarda una', async () => {
    const data = await valid();

    const results = await Promise.allSettled([
      prisma.listingLandlordRating.create({ data }),
      prisma.listingLandlordRating.create({ data }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(
      await prisma.listingLandlordRating.count({
        where: { reservationId: data.reservationId },
      }),
    ).toBe(1);
  });

  it('acepta un comentario de 500 caracteres y rechaza uno de 501', async () => {
    const ok = await prisma.listingLandlordRating.create({
      data: { ...(await valid()), comment: 'a'.repeat(500) },
    });
    expect(ok.comment).toHaveLength(500);

    const data = await valid();
    await expect(
      prisma.listingLandlordRating.create({
        data: { ...data, comment: 'a'.repeat(501) },
      }),
    ).rejects.toMatchObject({ code: 'P2000' });
  });

  it('cuenta caracteres y no bytes en el comentario', async () => {
    const rating = await prisma.listingLandlordRating.create({
      data: { ...(await valid()), comment: 'ñ'.repeat(500) },
    });

    expect(rating.comment).toHaveLength(500);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['solo saltos de línea y tabs', '\n\t'],
  ])('rechaza un comentario %s', async (_caso, comment) => {
    const data = await valid();

    await expect(
      prisma.listingLandlordRating.create({ data: { ...data, comment } }),
    ).rejects.toThrow(/listing_landlord_ratings_comment_check/);
  });

  it('acepta un comentario con espacios alrededor del texto', async () => {
    const rating = await prisma.listingLandlordRating.create({
      data: { ...(await valid()), comment: '  muy bien  ' },
    });

    expect(rating.comment).toBe('  muy bien  ');
  });

  describe('reserva, autor, publicación y arrendador', () => {
    it('rechaza una reserva que no existe (FK)', async () => {
      const data = await valid();

      await expect(
        prisma.listingLandlordRating.create({
          data: { ...data, reservationId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rechaza un autor que no es el arrendatario de la reserva', async () => {
      const data = await valid();

      await expect(
        prisma.listingLandlordRating.create({
          data: { ...data, authorId: otherTenantId },
        }),
      ).rejects.toThrow(/listing_landlord_ratings_consistency_check/);
    });

    it('rechaza un arrendador que no es el dueño de la publicación', async () => {
      const data = await valid();

      await expect(
        prisma.listingLandlordRating.create({
          data: { ...data, landlordId: otherLandlordId },
        }),
      ).rejects.toThrow(/listing_landlord_ratings_consistency_check/);
    });

    it('rechaza una publicación que no es la de la reserva', async () => {
      const data = await valid();

      await expect(
        prisma.listingLandlordRating.create({
          data: {
            ...data,
            listingId: otherListingId,
            landlordId: otherLandlordId,
          },
        }),
      ).rejects.toThrow(/listing_landlord_ratings_consistency_check/);
    });

    it('rechaza la publicación de otra reserva aunque el arrendador sea el de esa publicación', async () => {
      const reservationId = await newReservation({
        listingId: otherListingId,
        tenantId,
      });

      // Reserva de la publicación del otro arrendador, calificada como si
      // fuera del primero: el arrendador no cuadra con la publicación de la
      // reserva.
      await expect(
        prisma.listingLandlordRating.create({
          data: {
            reservationId,
            authorId: tenantId,
            listingId: otherListingId,
            landlordId,
            listingScore: 3,
            landlordScore: 3,
          },
        }),
      ).rejects.toThrow(/listing_landlord_ratings_consistency_check/);
    });

    it.each([
      ['el autor', () => ({ authorId: otherTenantId })],
      ['el arrendador', () => ({ landlordId: otherLandlordId })],
      ['la publicación', () => ({ listingId: otherListingId })],
    ])(
      'también revisa al cambiar %s de una calificación',
      async (_c, change) => {
        const rating = await prisma.listingLandlordRating.create({
          data: await valid(),
        });

        await expect(
          prisma.listingLandlordRating.update({
            where: { id: rating.id },
            data: change(),
          }),
        ).rejects.toThrow(/listing_landlord_ratings_consistency_check/);
      },
    );

    it('también revisa al cambiar la reserva de una calificación', async () => {
      const rating = await prisma.listingLandlordRating.create({
        data: await valid(),
      });
      const otherReservationId = await newReservation({
        listingId: otherListingId,
        tenantId: otherTenantId,
      });

      await expect(
        prisma.listingLandlordRating.update({
          where: { id: rating.id },
          data: { reservationId: otherReservationId },
        }),
      ).rejects.toThrow(/listing_landlord_ratings_consistency_check/);
    });

    it('deja corregir el comentario y los puntajes de una calificación', async () => {
      const rating = await prisma.listingLandlordRating.create({
        data: await valid(),
      });

      const updated = await prisma.listingLandlordRating.update({
        where: { id: rating.id },
        data: { listingScore: 2, landlordScore: 3, comment: 'Corregido' },
      });

      expect(updated.listingScore).toBe(2);
      expect(updated.landlordScore).toBe(3);
      expect(updated.comment).toBe('Corregido');
    });

    it('rechaza que el arrendador se califique a sí mismo', async () => {
      // El arrendador reserva su propia publicación: la reserva y el trigger
      // cuadran, pero nadie se califica como arrendador a sí mismo.
      const reservationId = await newReservation({
        listingId,
        tenantId: landlordId,
      });

      await expect(
        prisma.listingLandlordRating.create({
          data: {
            reservationId,
            authorId: landlordId,
            listingId,
            landlordId,
            listingScore: 5,
            landlordScore: 5,
          },
        }),
      ).rejects.toThrow(/listing_landlord_ratings_author_not_landlord_check/);
    });

    it('no deja borrar la reserva, la publicación ni a las personas con una calificación', async () => {
      const data = await valid();
      await prisma.listingLandlordRating.create({ data });

      await expect(
        prisma.reservation.delete({ where: { id: data.reservationId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        prisma.listing.delete({ where: { id: listingId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        prisma.user.delete({ where: { id: tenantId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        prisma.user.delete({ where: { id: landlordId } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  it('las cuatro claves foráneas son RESTRICT', async () => {
    // Borrar la reserva, la publicación o las personas ya lo frena también
    // otra tabla (reservations), así que la regla de estas FK se comprueba en
    // el catálogo: confdeltype 'r' = RESTRICT.
    const rows = await prisma.$queryRaw<
      { conname: string; confdeltype: string }[]
    >`
      SELECT conname, confdeltype::text AS confdeltype
      FROM pg_constraint
      WHERE conrelid = 'listing_landlord_ratings'::regclass AND contype = 'f'
      ORDER BY conname`;

    expect(rows.map((r) => r.conname)).toEqual([
      'listing_landlord_ratings_author_id_fkey',
      'listing_landlord_ratings_landlord_id_fkey',
      'listing_landlord_ratings_listing_id_fkey',
      'listing_landlord_ratings_reservation_id_fkey',
    ]);
    expect(rows.every((r) => r.confdeltype === 'r')).toBe(true);
  });

  describe('promedios', () => {
    // Publicaciones y arrendadores propios de esta prueba, para que las otras
    // calificaciones no cuenten en los promedios.
    let avgLandlordA: string;
    let avgLandlordB: string;
    let listingA1: string;
    let listingA2: string;
    let listingB1: string;

    const rate = async (
      listing: string,
      landlord: string,
      listingScore: number,
      landlordScore: number,
    ) => {
      const reservationId = await newReservation({ listingId: listing });
      await prisma.listingLandlordRating.create({
        data: {
          reservationId,
          authorId: tenantId,
          listingId: listing,
          landlordId: landlord,
          listingScore,
          landlordScore,
        },
      });
    };

    beforeAll(async () => {
      avgLandlordA = (await newUser('avg-a', 'ARRENDADOR')).id;
      avgLandlordB = (await newUser('avg-b', 'ARRENDADOR')).id;
      listingA1 = (await newListing(avgLandlordA, 'A1')).id;
      listingA2 = (await newListing(avgLandlordA, 'A2')).id;
      listingB1 = (await newListing(avgLandlordB, 'B1')).id;

      // A1: bien 5, 4, 4 -> 4.33; A2: bien 2; B1: sin calificaciones.
      // Arrendador A: 5, 3, 3, 1 -> 3; arrendador B: sin calificaciones.
      await rate(listingA1, avgLandlordA, 5, 5);
      await rate(listingA1, avgLandlordA, 4, 3);
      await rate(listingA1, avgLandlordA, 4, 3);
      await rate(listingA2, avgLandlordA, 2, 1);
    });

    it('se pueden calcular por publicación, con un decimal', async () => {
      const rows = await prisma.$queryRaw<
        { listing_id: string; avg: string; n: bigint }[]
      >`
        SELECT listing_id,
               ROUND(AVG(listing_score)::numeric, 1)::text AS avg,
               COUNT(*) AS n
        FROM listing_landlord_ratings
        WHERE listing_id IN (${listingA1}::uuid, ${listingA2}::uuid, ${listingB1}::uuid)
        GROUP BY listing_id`;
      const byListing = Object.fromEntries(rows.map((r) => [r.listing_id, r]));

      expect(byListing[listingA1].avg).toBe('4.3');
      expect(Number(byListing[listingA1].n)).toBe(3);
      expect(byListing[listingA2].avg).toBe('2.0');
      // Sin calificaciones no hay fila: el servicio devuelve null.
      expect(byListing[listingB1]).toBeUndefined();
    });

    it('se pueden calcular por arrendador, con un decimal', async () => {
      const rows = await prisma.$queryRaw<
        { landlord_id: string; avg: string }[]
      >`
        SELECT landlord_id, ROUND(AVG(landlord_score)::numeric, 1)::text AS avg
        FROM listing_landlord_ratings
        WHERE landlord_id IN (${avgLandlordA}::uuid, ${avgLandlordB}::uuid)
        GROUP BY landlord_id`;
      const byLandlord = Object.fromEntries(
        rows.map((r) => [r.landlord_id, r]),
      );

      expect(byLandlord[avgLandlordA].avg).toBe('3.0');
      expect(byLandlord[avgLandlordB]).toBeUndefined();
    });

    it('el promedio del bien y el del arrendador no se mezclan', async () => {
      const bien = await prisma.listingLandlordRating.aggregate({
        where: { listingId: listingA1 },
        _avg: { listingScore: true, landlordScore: true },
      });

      expect(bien._avg.listingScore).toBeCloseTo(4.33, 2);
      expect(bien._avg.landlordScore).toBeCloseTo(3.67, 2);
    });
  });

  it('tiene índices por publicación y por arrendador, y el único por reserva', async () => {
    const rows = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'listing_landlord_ratings'`;
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(defs['listing_landlord_ratings_listing_id_idx']).toMatch(
      /\(listing_id\)/,
    );
    expect(defs['listing_landlord_ratings_landlord_id_idx']).toMatch(
      /\(landlord_id\)/,
    );
    expect(defs['listing_landlord_ratings_reservation_id_key']).toMatch(
      /UNIQUE INDEX .*\(reservation_id\)/,
    );
  });
});
