import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de la opción "requiere verificación" de la publicación (DB-19.1).
 *
 * Igual que las demás pruebas de restricciones: corre solo contra una base
 * local cuyo nombre termina en `_test` (TEST_DATABASE_URL, o DATABASE_URL +
 * `_test`). Crea su propio arrendador, arrendatarios y revisor con un email
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

describe('requiere verificación: publicación y consulta (DB-19.1)', () => {
  const email = `db-19.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let reviewerId: string;
  let users = 0;

  const newUser = (role: 'ARRENDATARIO' | 'REVISOR' | 'ARRENDADOR') =>
    prisma.user.create({
      data: {
        email: `${role.toLowerCase()}${++users}-${email}`,
        passwordHash: 'no-es-un-hash-real',
        role,
      },
    });

  const newListing = (data: { requiresVerification?: boolean } = {}) =>
    prisma.listing.create({
      data: {
        landlordId,
        type: 'EQUIPO',
        name: 'Proyector',
        location: 'Antiguo Cuscatlán',
        rateAmount: '20.00',
        rateUnit: 'DIA',
        ...data,
      },
    });

  beforeAll(async () => {
    landlordId = (await newUser('ARRENDADOR')).id;
    reviewerId = (await newUser('REVISOR')).id;
  });

  afterAll(async () => {
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  describe('listings.requires_verification', () => {
    it('una publicación nueva no exige verificación por defecto', async () => {
      const listing = await newListing();
      expect(listing.requiresVerification).toBe(false);
    });

    it('el dueño la puede activar y volver a desactivar', async () => {
      const { id } = await newListing();

      const on = await prisma.listing.update({
        where: { id },
        data: { requiresVerification: true },
      });
      expect(on.requiresVerification).toBe(true);

      const off = await prisma.listing.update({
        where: { id },
        data: { requiresVerification: false },
      });
      expect(off.requiresVerification).toBe(false);
    });

    it('un INSERT que no menciona la columna (como las filas de antes de la migración) queda en false', async () => {
      const id = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "listings"
          ("id", "landlord_id", "type", "name", "location", "rate_amount", "rate_unit")
        VALUES
          (${id}::uuid, ${landlordId}::uuid, 'ESPACIO', 'Sala', 'San Salvador', 50, 'HORA')`;

      const listing = await prisma.listing.findUniqueOrThrow({ where: { id } });
      expect(listing.requiresVerification).toBe(false);
    });

    it('la columna es BOOLEAN NOT NULL DEFAULT false', async () => {
      const [column] = await prisma.$queryRaw<
        { data_type: string; is_nullable: string; column_default: string }[]
      >`
        SELECT data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'requires_verification'`;

      expect(column).toEqual({
        data_type: 'boolean',
        is_nullable: 'NO',
        column_default: 'false',
      });
    });

    it('rechaza NULL', async () => {
      const { id } = await newListing();

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "listings" SET "requires_verification" = NULL WHERE "id" = $1::uuid`,
          id,
        ),
      ).rejects.toThrow(/null value|not-null/i);
    });
  });

  describe('si un arrendatario está verificado (sin duplicar datos)', () => {
    /** La misma consulta que usará BE-19.1: alguna verificación APROBADA. */
    const isVerified = async (userId: string) =>
      (await prisma.identityVerification.count({
        where: { userId, status: 'APROBADA' },
      })) > 0;

    const verification = (
      userId: string,
      status: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA',
    ) =>
      prisma.identityVerification.create({
        data: {
          userId,
          documentKey: `verificaciones/${randomUUID()}.pdf`,
          status,
          // Fechas fijas: con `now()` de la base y `new Date()` del cliente,
          // reviewed_at podría quedar milisegundos antes que submitted_at.
          submittedAt: new Date('2026-12-01T09:00:00Z'),
          ...(status === 'PENDIENTE'
            ? {}
            : {
                reviewedById: reviewerId,
                reviewedAt: new Date('2026-12-01T10:00:00Z'),
              }),
        },
      });

    it('está verificado con una APROBADA', async () => {
      const tenant = await newUser('ARRENDATARIO');
      await verification(tenant.id, 'APROBADA');
      expect(await isVerified(tenant.id)).toBe(true);
    });

    it.each(['PENDIENTE', 'RECHAZADA'] as const)(
      'no está verificado si solo tiene una %s',
      async (status) => {
        const tenant = await newUser('ARRENDATARIO');
        await verification(tenant.id, status);
        expect(await isVerified(tenant.id)).toBe(false);
      },
    );

    it('no está verificado si nunca envió una', async () => {
      const tenant = await newUser('ARRENDATARIO');
      expect(await isVerified(tenant.id)).toBe(false);
    });

    it('sigue verificado aunque después tenga una RECHAZADA o una PENDIENTE', async () => {
      const tenant = await newUser('ARRENDATARIO');
      await verification(tenant.id, 'APROBADA');
      await verification(tenant.id, 'RECHAZADA');
      await verification(tenant.id, 'PENDIENTE');
      expect(await isVerified(tenant.id)).toBe(true);
    });

    it('la verificación de uno no cuenta para otro', async () => {
      const verified = await newUser('ARRENDATARIO');
      const other = await newUser('ARRENDATARIO');
      await verification(verified.id, 'APROBADA');
      expect(await isVerified(other.id)).toBe(false);
    });

    it('la tabla users no tiene una columna de "verificado"', async () => {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users'`;
      expect(columns.map((c) => c.column_name)).not.toContainEqual(
        expect.stringMatching(/verif/i),
      );
    });
  });
});
