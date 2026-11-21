import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Consultas del detalle de una publicación (DB-12.1): fotos en orden,
 * promedios de calificaciones y exclusión de las desactivadas.
 *
 * Misma regla que las demás pruebas de base: corre solo contra una base
 * local cuyo nombre termina en `_test` y borra solo lo que creó.
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
describe('listings: consultas del detalle (DB-12.1)', () => {
  const email = `db-12.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;
  let otherListingId: string;
  let unratedId: string;
  let inactiveId: string;

  const newListing = async (ownerId: string, name: string, extra = {}) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: ownerId,
          type: 'EQUIPO',
          name,
          location: 'Santa Tecla',
          rateAmount: '15.00',
          rateUnit: 'DIA',
          ...extra,
        },
      })
    ).id;

  /** Una calificación necesita su propia reserva (una por reserva). */
  const rate = async (
    listing: string,
    owner: string,
    listingScore: number,
    landlordScore: number,
  ) => {
    const reservation = await prisma.reservation.create({
      data: {
        listingId: listing,
        tenantId,
        startAt: new Date('2026-10-01T15:00:00Z'),
        endAt: new Date('2026-10-02T15:00:00Z'),
        status: 'COMPLETADA',
        rentalCost: '30.00',
        depositAmount: '0.00',
      },
    });
    await prisma.listingLandlordRating.create({
      data: {
        reservationId: reservation.id,
        authorId: tenantId,
        listingId: listing,
        landlordId: owner,
        listingScore,
        landlordScore,
      },
    });
  };

  /**
   * La consulta de promedios del detalle: del bien por publicación, del
   * arrendador por arrendador, con un decimal, y el total de calificaciones
   * de la publicación. Sin calificaciones los promedios son NULL.
   */
  const averages = async (listing: string) => {
    const [row] = await prisma.$queryRaw<
      {
        listing_avg: string | null;
        landlord_avg: string | null;
        total: number;
      }[]
    >`
      SELECT
        (SELECT ROUND(AVG(r.listing_score)::numeric, 1)
           FROM listing_landlord_ratings r
          WHERE r.listing_id = l.id)::text AS listing_avg,
        (SELECT ROUND(AVG(r.landlord_score)::numeric, 1)
           FROM listing_landlord_ratings r
          WHERE r.landlord_id = l.landlord_id)::text AS landlord_avg,
        (SELECT COUNT(*)::int
           FROM listing_landlord_ratings r
          WHERE r.listing_id = l.id) AS total
      FROM listings l
      WHERE l.id = ${listing}::uuid AND l.is_active`;
    return row;
  };

  const plan = async (sql: string): Promise<string> => {
    // Con pocas filas PostgreSQL prefiere leer la tabla completa; se apaga
    // esa opción solo dentro de la transacción para ver si el índice sirve.
    const [, , rows] = await prisma.$transaction([
      prisma.$executeRawUnsafe('SET LOCAL enable_seqscan = off'),
      prisma.$executeRawUnsafe('SET LOCAL enable_sort = off'),
      prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`),
    ]);
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  };

  beforeAll(async () => {
    const user = (kind: string) =>
      prisma.user.create({
        data: { email: `${kind}-${email}`, passwordHash: 'no-es-un-hash-real' },
      });
    landlordId = (await user('landlord')).id;
    tenantId = (await user('tenant')).id;
    const otherLandlordId = (await user('other-landlord')).id;

    listingId = await newListing(landlordId, 'Taladro');
    otherListingId = await newListing(landlordId, 'Escalera');
    unratedId = await newListing(otherLandlordId, 'Andamio');
    inactiveId = await newListing(landlordId, 'Desactivada', {
      isActive: false,
    });

    // Las fotos se guardan desordenadas a propósito.
    await prisma.listingImage.createMany({
      data: [2, 0, 3, 1].map((position) => ({
        listingId,
        path: `foto-${position}.jpg`,
        position,
      })),
    });

    // Taladro: bien 5, 4, 4 (promedio 4.33); arrendador 5, 5, 4.
    await rate(listingId, landlordId, 5, 5);
    await rate(listingId, landlordId, 4, 5);
    await rate(listingId, landlordId, 4, 4);
    // Escalera, del mismo arrendador: bien 2; arrendador 3.
    await rate(otherListingId, landlordId, 2, 3);
  });

  afterAll(async () => {
    // De abajo hacia arriba: las FK son RESTRICT.
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

  describe('las imágenes se leen en orden', () => {
    it('devuelve las fotos por posición aunque se guardaron desordenadas', async () => {
      const images = await prisma.listingImage.findMany({
        where: { listingId },
        orderBy: { position: 'asc' },
      });

      expect(images.map((i) => i.position)).toEqual([0, 1, 2, 3]);
    });

    it('existe el índice único (listing_id, position) y la lectura en orden lo usa', async () => {
      const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE indexname = 'listing_images_listing_id_position_key'`;
      expect(rows[0]?.indexdef).toMatch(
        /UNIQUE INDEX .* \(listing_id, "?position"?\)/,
      );

      const text = await plan(
        `SELECT path FROM listing_images WHERE listing_id = '${listingId}' ORDER BY position`,
      );
      expect(text).toContain('listing_images_listing_id_position_key');
      // El índice ya entrega el orden: no hace falta ordenar aparte.
      expect(text).not.toContain('Sort');
    });
  });

  describe('el promedio se calcula sin duplicar datos', () => {
    it('promedia el bien por publicación y el arrendador por arrendador, con un decimal', async () => {
      // Bien: (5 + 4 + 4) / 3 = 4.33 → 4.3.
      // Arrendador: sus cuatro calificaciones, (5 + 5 + 4 + 3) / 4 = 4.25 → 4.3.
      expect(await averages(listingId)).toEqual({
        listing_avg: '4.3',
        landlord_avg: '4.3',
        total: 3,
      });
      // Otra publicación del mismo arrendador: su propio promedio del bien y
      // el mismo promedio del arrendador.
      expect(await averages(otherListingId)).toEqual({
        listing_avg: '2.0',
        landlord_avg: '4.3',
        total: 1,
      });
    });

    it('sin calificaciones los promedios son NULL y el total es 0', async () => {
      expect(await averages(unratedId)).toEqual({
        listing_avg: null,
        landlord_avg: null,
        total: 0,
      });
    });

    it('una calificación nueva cambia el promedio sin tocar la publicación', async () => {
      const before = await prisma.listing.findUniqueOrThrow({
        where: { id: otherListingId },
      });

      await rate(otherListingId, landlordId, 5, 5);

      expect((await averages(otherListingId)).listing_avg).toBe('3.5');
      expect(
        await prisma.listing.findUniqueOrThrow({
          where: { id: otherListingId },
        }),
      ).toEqual(before);
    });

    it('no hay columnas de promedio guardadas en listings ni en users', async () => {
      const rows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('listings', 'users')
          AND (column_name ILIKE '%rating%' OR column_name ILIKE '%score%'
            OR column_name ILIKE '%promedio%' OR column_name ILIKE '%average%')`;
      expect(rows).toEqual([]);
    });

    it('los promedios usan los índices de listing_id y landlord_id', async () => {
      expect(
        await plan(
          `SELECT AVG(listing_score) FROM listing_landlord_ratings WHERE listing_id = '${listingId}'`,
        ),
      ).toContain('listing_landlord_ratings_listing_id_idx');
      expect(
        await plan(
          `SELECT AVG(landlord_score) FROM listing_landlord_ratings WHERE landlord_id = '${landlordId}'`,
        ),
      ).toContain('listing_landlord_ratings_landlord_id_idx');
    });
  });

  describe('se puede excluir una publicación desactivada', () => {
    it('la consulta del detalle no devuelve una desactivada ni una que no existe', async () => {
      expect(await averages(inactiveId)).toBeUndefined();
      expect(await averages(randomUUID())).toBeUndefined();
      expect(
        await prisma.listing.findFirst({
          where: { id: inactiveId, isActive: true },
        }),
      ).toBeNull();
    });

    it('busca por la clave primaria y filtra is_active en esa misma fila', async () => {
      const text = await plan(
        `SELECT name FROM listings WHERE id = '${listingId}' AND is_active`,
      );

      expect(text).toContain('listings_pkey');
      expect(text).toMatch(/Filter: is_active/);
    });
  });
});
