import { randomUUID } from 'node:crypto';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de lo que DB-14.1 agrega a `availability_blocks`: autor, fecha de
 * creación, el CHECK del motivo y el índice de traslapes. Lo que viene de
 * DB-03.1 (período, largo del motivo, FK y CASCADE con la publicación) ya lo
 * cubre test/reservations.constraints.e2e-spec.ts.
 *
 * Corre contra la base `_test` local. Crea sus propios usuarios y
 * publicaciones con un email único y al final borra solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

describe('bloqueos de disponibilidad: restricciones (DB-14.1)', () => {
  const email = `db-14.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let listingId: string;

  const newListing = () =>
    prisma.listing.create({
      data: {
        landlordId,
        type: 'ESPACIO',
        name: 'Sala de reuniones',
        location: 'Santa Tecla',
        rateAmount: '25.00',
        rateUnit: 'DIA',
      },
    });

  const START = new Date('2026-12-20T06:00:00Z');
  const END = new Date('2026-12-22T06:00:00Z');
  const days = (n: number) => new Date(START.getTime() + n * 86_400_000);
  const valid = (listing = listingId) => ({
    listingId: listing,
    startAt: START,
    endAt: END,
    createdById: landlordId,
  });

  beforeAll(async () => {
    const landlord = await prisma.user.create({
      data: {
        email: `landlord-${email}`,
        passwordHash: 'no-es-un-hash-real',
        role: 'ARRENDADOR',
      },
    });
    landlordId = landlord.id;
    listingId = (await newListing()).id;
  });

  afterAll(async () => {
    // Los bloqueos se borran con su publicación (CASCADE) y recién entonces
    // se pueden borrar los usuarios (created_by es RESTRICT).
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  describe('autor y fecha de creación', () => {
    it('guarda quién creó el bloqueo y cuándo', async () => {
      const before = Date.now();
      const block = await prisma.availabilityBlock.create({
        data: { ...valid(), reason: 'Mantenimiento' },
        include: { createdBy: true },
      });

      expect(block.createdBy?.id).toBe(landlordId);
      expect(block.createdAt).toBeInstanceOf(Date);
      // Margen de un minuto por si el reloj de la base y el de la prueba difieren.
      expect(Math.abs(block.createdAt.getTime() - before)).toBeLessThan(60_000);
      expect(block.reason).toBe('Mantenimiento');
    });

    it('acepta un bloqueo sin autor', async () => {
      // La base no lo exige para no romper las filas que otros módulos crean
      // directo en la tabla; BE-14.1 lo guarda siempre.
      const block = await prisma.availabilityBlock.create({
        data: { listingId, startAt: START, endAt: END },
      });

      expect(block.createdById).toBeNull();
      expect(block.createdAt).toBeInstanceOf(Date);
    });

    it('rechaza un autor que no existe (FK)', async () => {
      await expect(
        prisma.availabilityBlock.create({
          data: { ...valid(), createdById: randomUUID() },
        }),
      ).rejects.toThrow();
    });

    it('no deja borrar al usuario que creó un bloqueo (RESTRICT)', async () => {
      const author = await prisma.user.create({
        data: {
          email: `author-${email}`,
          passwordHash: 'no-es-un-hash-real',
          role: 'ARRENDADOR',
        },
      });
      const block = await prisma.availabilityBlock.create({
        data: { ...valid(), createdById: author.id },
      });

      await expect(
        prisma.user.delete({ where: { id: author.id } }),
      ).rejects.toThrow();

      await prisma.availabilityBlock.delete({ where: { id: block.id } });
    });

    it('created_at no admite NULL', async () => {
      const [column] = await prisma.$queryRaw<
        { is_nullable: string; column_default: string | null }[]
      >`SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'availability_blocks' AND column_name = 'created_at'`;

      expect(column.is_nullable).toBe('NO');
      expect(column.column_default).toBe('CURRENT_TIMESTAMP');
    });
  });

  describe('período y motivo', () => {
    it.each([
      ['igual al inicio', START],
      ['anterior al inicio', days(-1)],
    ])('rechaza un bloqueo con fin %s', async (_caso, endAt) => {
      await expect(
        prisma.availabilityBlock.create({ data: { ...valid(), endAt } }),
      ).rejects.toThrow(/availability_blocks_period_check/);
    });

    it('acepta un motivo de 200 caracteres y rechaza uno de 201', async () => {
      const ok = await prisma.availabilityBlock.create({
        data: { ...valid(), reason: 'a'.repeat(200) },
      });
      expect(ok.reason).toHaveLength(200);

      await expect(
        prisma.availabilityBlock.create({
          data: { ...valid(), reason: 'a'.repeat(201) },
        }),
      ).rejects.toThrow();
    });

    it.each([
      ['vacío', ''],
      ['solo espacios', '   '],
      ['solo saltos de línea y tabs', '\n\t'],
    ])('rechaza un motivo %s', async (_caso, reason) => {
      await expect(
        prisma.availabilityBlock.create({ data: { ...valid(), reason } }),
      ).rejects.toThrow(/availability_blocks_reason_check/);
    });

    it('rechaza una publicación que no existe (FK)', async () => {
      await expect(
        prisma.availabilityBlock.create({
          data: { ...valid(), listingId: randomUUID() },
        }),
      ).rejects.toThrow();
    });
  });

  describe('índice de traslapes', () => {
    it('existe el índice (listing_id, start_at, end_at)', async () => {
      const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'availability_blocks'
          AND indexdef LIKE '%(listing_id, start_at, end_at)%'`;

      expect(indexes.map((index) => index.indexname)).toEqual([
        'availability_blocks_listing_id_start_at_end_at_idx',
      ]);
    });

    it('la búsqueda de bloqueos que se cruzan con un rango puede usar el índice', async () => {
      // Con pocas filas Postgres prefiere recorrer la tabla; se desactiva el
      // recorrido secuencial solo dentro de esta transacción.
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
        return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
          EXPLAIN SELECT id FROM availability_blocks
          WHERE listing_id = ${listingId}::uuid
            AND start_at < ${END} AND end_at > ${START}`;
      });

      expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'availability_blocks_listing_id_start_at_end_at_idx',
      );
    });

    it('encuentra solo los bloqueos de la publicación que se cruzan con el rango', async () => {
      const listing = await newListing();
      const other = await newListing();
      const block = (startAt: Date, endAt: Date, target = listing.id) =>
        prisma.availabilityBlock.create({
          data: { ...valid(target), startAt, endAt },
        });

      const inside = await block(days(0.5), days(1.5));
      const overlapsStart = await block(days(-2), days(1));
      const overlapsEnd = await block(days(1), days(5));
      await block(days(-3), START); // termina justo cuando empieza el rango
      await block(END, days(4)); // empieza justo cuando termina el rango
      await block(days(0.5), days(1.5), other.id); // otra publicación

      // Rango consultado: [START, END), es decir, días 0 a 2.
      const found = await prisma.availabilityBlock.findMany({
        where: {
          listingId: listing.id,
          startAt: { lt: END },
          endAt: { gt: START },
        },
        select: { id: true },
      });

      expect(found.map((row) => row.id).sort()).toEqual(
        [inside.id, overlapsStart.id, overlapsEnd.id].sort(),
      );
    });
  });
});
