import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de restricciones de `listings` y `listing_images` (DB-01.1).
 *
 * Igual que la de notificaciones: corre solo contra una base local cuyo
 * nombre termina en `_test` (TEST_DATABASE_URL, o DATABASE_URL + `_test`).
 * Crea su propio arrendador con un email único y al final borra solo lo que
 * creó.
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

describe('listings: restricciones (DB-01.1)', () => {
  const email = `db-01.1-${randomUUID()}@test.local`;
  let landlordId: string;

  // Datos mínimos válidos; cada prueba cambia solo lo que quiere probar.
  const valid = () => ({
    landlordId,
    type: 'EQUIPO' as const,
    name: 'Taladro percutor',
    location: 'Antiguo Cuscatlán',
    rateAmount: '15.00',
    rateUnit: 'DIA' as const,
  });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email, passwordHash: 'no-es-un-hash-real' },
    });
    landlordId = user.id;
  });

  afterAll(async () => {
    // Primero las publicaciones (la FK es RESTRICT) y después los usuarios.
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  it('crea una publicación con valores por defecto', async () => {
    const listing = await prisma.listing.create({ data: valid() });

    expect(listing.isActive).toBe(true);
    expect(listing.depositAmount.toFixed(2)).toBe('0.00');
    expect(listing.rateAmount.toFixed(2)).toBe('15.00');
    expect(listing.createdAt).toBeInstanceOf(Date);
  });

  it('guarda los montos con dos decimales', async () => {
    const listing = await prisma.listing.create({
      data: { ...valid(), rateAmount: '19.999', depositAmount: '10.005' },
    });

    expect(listing.rateAmount.toFixed(2)).toBe('20.00');
    expect(listing.depositAmount.toFixed(2)).toBe('10.01');
  });

  it.each(['0', '-1'])('rechaza una tarifa de %s', async (rateAmount) => {
    await expect(
      prisma.listing.create({ data: { ...valid(), rateAmount } }),
    ).rejects.toThrow(/listings_rate_amount_check/);
  });

  it('rechaza un depósito negativo', async () => {
    await expect(
      prisma.listing.create({ data: { ...valid(), depositAmount: '-0.01' } }),
    ).rejects.toThrow(/listings_deposit_amount_check/);
  });

  it('rechaza un nombre de 101 caracteres', async () => {
    await expect(
      prisma.listing.create({ data: { ...valid(), name: 'a'.repeat(101) } }),
    ).rejects.toMatchObject({ code: 'P2000' });
  });

  it.each([
    ['name', '   ', 'listings_name_not_blank_check'],
    ['location', '', 'listings_location_not_blank_check'],
  ])('rechaza %s vacío', async (field, value, constraint) => {
    await expect(
      prisma.listing.create({ data: { ...valid(), [field]: value } }),
    ).rejects.toThrow(new RegExp(constraint));
  });

  it.each([
    ['type', 'ListingType', 'VEHICULO'],
    ['rate_unit', 'RateUnit', 'MES'],
  ])(
    'rechaza un valor de %s fuera del enum',
    async (column, enumName, value) => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "listings" SET "${column}" = $1::"${enumName}" WHERE false`,
          value,
        ),
      ).rejects.toThrow(/invalid input value for enum/i);
    },
  );

  it('rechaza un landlord_id que no existe (FK)', async () => {
    await expect(
      prisma.listing.create({ data: { ...valid(), landlordId: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('devuelve las imágenes de una publicación en orden', async () => {
    const listing = await prisma.listing.create({
      data: {
        ...valid(),
        images: {
          create: [
            { path: 'listings/c.jpg', position: 2 },
            { path: 'listings/a.jpg', position: 0 },
            { path: 'listings/b.png', position: 1 },
          ],
        },
      },
    });

    const withImages = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
      include: { images: { orderBy: { position: 'asc' } } },
    });
    expect(withImages.images.map((i) => i.path)).toEqual([
      'listings/a.jpg',
      'listings/b.png',
      'listings/c.jpg',
    ]);
  });

  it('no permite dos imágenes en la misma posición', async () => {
    const listing = await prisma.listing.create({ data: valid() });
    await prisma.listingImage.create({
      data: { listingId: listing.id, path: 'x.jpg', position: 0 },
    });

    await expect(
      prisma.listingImage.create({
        data: { listingId: listing.id, path: 'y.jpg', position: 0 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rechaza una posición negativa', async () => {
    const listing = await prisma.listing.create({ data: valid() });

    await expect(
      prisma.listingImage.create({
        data: { listingId: listing.id, path: 'x.jpg', position: -1 },
      }),
    ).rejects.toThrow(/listing_images_position_check/);
  });

  it('borra las imágenes al borrar la publicación (ON DELETE CASCADE)', async () => {
    const listing = await prisma.listing.create({
      data: {
        ...valid(),
        images: { create: [{ path: 'x.jpg', position: 0 }] },
      },
    });

    await prisma.listing.delete({ where: { id: listing.id } });

    expect(
      await prisma.listingImage.count({ where: { listingId: listing.id } }),
    ).toBe(0);
  });

  it('no deja borrar a un arrendador que tiene publicaciones (RESTRICT)', async () => {
    const owner = await prisma.user.create({
      data: { email: `restrict-${email}`, passwordHash: 'x' },
    });
    await prisma.listing.create({ data: { ...valid(), landlordId: owner.id } });

    await expect(
      prisma.user.delete({ where: { id: owner.id } }),
    ).rejects.toMatchObject({
      code: 'P2003',
    });
  });
});
