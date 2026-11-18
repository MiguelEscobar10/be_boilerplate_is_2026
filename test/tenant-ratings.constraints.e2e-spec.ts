import { randomUUID } from 'node:crypto';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de restricciones de `tenant_ratings` (DB-18.1): la calificación que
 * el arrendador le da al arrendatario de una reserva.
 *
 * Corre contra la base `_test` local. Crea sus propios usuarios, publicación y
 * reservas con un email único y al final borra solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

describe('calificación del arrendatario: restricciones (DB-18.1)', () => {
  const email = `db-18.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;

  const newReservation = async () =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId,
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
    authorId: landlordId,
    tenantId,
    score: 5,
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
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name: 'Generador',
          location: 'Soyapango',
          rateAmount: '30.00',
          rateUnit: 'HORA',
        },
      })
    ).id;
  });

  afterAll(async () => {
    // De abajo hacia arriba: todas las FK son RESTRICT.
    await prisma.tenantRating.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
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

  it('guarda la calificación con su reserva, autor y arrendatario', async () => {
    const data = await valid();
    const rating = await prisma.tenantRating.create({
      data: { ...data, score: 4, comment: 'Devolvió el equipo a tiempo' },
      include: { reservation: true, author: true, tenant: true },
    });

    expect(rating.score).toBe(4);
    expect(rating.comment).toBe('Devolvió el equipo a tiempo');
    expect(rating.createdAt).toBeInstanceOf(Date);
    expect(rating.reservation.id).toBe(data.reservationId);
    expect(rating.author.id).toBe(landlordId);
    expect(rating.tenant.id).toBe(tenantId);
  });

  it('guarda una calificación sin comentario', async () => {
    const rating = await prisma.tenantRating.create({ data: await valid() });

    expect(rating.comment).toBeNull();
  });

  it('se puede leer desde la reserva', async () => {
    const data = await valid();
    await prisma.tenantRating.create({ data });

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: data.reservationId },
      include: { tenantRating: true },
    });

    expect(reservation.tenantRating?.score).toBe(5);
  });

  it.each([1, 2, 3, 4, 5])('acepta el puntaje %i', async (score) => {
    const rating = await prisma.tenantRating.create({
      data: { ...(await valid()), score },
    });

    expect(rating.score).toBe(score);
  });

  it.each([0, 6, -1, 100])('rechaza el puntaje %i', async (score) => {
    const data = await valid();

    await expect(
      prisma.tenantRating.create({ data: { ...data, score } }),
    ).rejects.toThrow(/tenant_ratings_score_check/);
  });

  it('rechaza una segunda calificación de la misma reserva', async () => {
    const data = await valid();
    await prisma.tenantRating.create({ data });

    await expect(
      prisma.tenantRating.create({ data: { ...data, score: 1 } }),
    ).rejects.toThrow(/Unique constraint/);

    const ratings = await prisma.tenantRating.findMany({
      where: { reservationId: data.reservationId },
    });
    expect(ratings).toHaveLength(1);
    expect(ratings[0].score).toBe(5);
  });

  it('de dos calificaciones simultáneas de la misma reserva solo guarda una', async () => {
    const data = await valid();

    const results = await Promise.allSettled([
      prisma.tenantRating.create({ data }),
      prisma.tenantRating.create({ data }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(
      await prisma.tenantRating.count({
        where: { reservationId: data.reservationId },
      }),
    ).toBe(1);
  });

  it('acepta un comentario de 500 caracteres y rechaza uno de 501', async () => {
    const ok = await prisma.tenantRating.create({
      data: { ...(await valid()), comment: 'a'.repeat(500) },
    });
    expect(ok.comment).toHaveLength(500);

    const data = await valid();
    await expect(
      prisma.tenantRating.create({
        data: { ...data, comment: 'a'.repeat(501) },
      }),
    ).rejects.toThrow();
  });

  it('cuenta caracteres y no bytes en el comentario', async () => {
    const rating = await prisma.tenantRating.create({
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
      prisma.tenantRating.create({ data: { ...data, comment } }),
    ).rejects.toThrow(/tenant_ratings_comment_check/);
  });

  it('rechaza que alguien se califique a sí mismo', async () => {
    const data = await valid();

    await expect(
      prisma.tenantRating.create({ data: { ...data, authorId: tenantId } }),
    ).rejects.toThrow(/tenant_ratings_author_not_tenant_check/);
  });

  it.each(['reservationId', 'authorId', 'tenantId'] as const)(
    'rechaza un %s que no existe (FK)',
    async (field) => {
      const data = await valid();

      await expect(
        prisma.tenantRating.create({
          data: { ...data, [field]: randomUUID() },
        }),
      ).rejects.toThrow();
    },
  );

  it('no deja borrar una reserva que ya fue calificada (RESTRICT)', async () => {
    const data = await valid();
    await prisma.tenantRating.create({ data });

    await expect(
      prisma.reservation.delete({ where: { id: data.reservationId } }),
    ).rejects.toThrow();
  });

  it('no deja borrar al autor ni al arrendatario de una calificación (RESTRICT)', async () => {
    const author = await prisma.user.create({
      data: {
        email: `author-${email}`,
        passwordHash: 'no-es-un-hash-real',
        role: 'ARRENDADOR',
      },
    });
    const rated = await prisma.user.create({
      data: { email: `rated-${email}`, passwordHash: 'no-es-un-hash-real' },
    });
    const data = await valid();
    const rating = await prisma.tenantRating.create({
      data: { ...data, authorId: author.id, tenantId: rated.id },
    });

    await expect(
      prisma.user.delete({ where: { id: author.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.user.delete({ where: { id: rated.id } }),
    ).rejects.toThrow();

    await prisma.tenantRating.delete({ where: { id: rating.id } });
  });

  it('tiene el índice único por reserva y el índice por arrendatario', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'tenant_ratings' ORDER BY indexname`;

    expect(indexes.map((index) => index.indexname)).toEqual([
      'tenant_ratings_pkey',
      'tenant_ratings_reservation_id_key',
      'tenant_ratings_tenant_id_created_at_idx',
    ]);
  });
});
