import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de restricciones del rol y del perfil de usuario (DB-00.1).
 *
 * Misma regla que las demás pruebas de base: solo corre contra una base local
 * cuyo nombre termina en `_test`, y al final borra solo lo que creó.
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

describe('cuentas: rol y perfil (DB-00.1)', () => {
  const suffix = `db-00.1-${randomUUID()}@test.local`;
  let n = 0;
  const newUser = (role?: 'ARRENDADOR' | 'ARRENDATARIO' | 'REVISOR') =>
    prisma.user.create({
      data: {
        email: `${n++}-${suffix}`,
        passwordHash: 'no-es-un-hash-real',
        role,
      },
    });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await prisma.$disconnect();
  });

  it('una cuenta sin rol explícito queda como ARRENDATARIO', async () => {
    expect((await newUser()).role).toBe('ARRENDATARIO');
  });

  it.each(['ARRENDADOR', 'ARRENDATARIO', 'REVISOR'] as const)(
    'acepta el rol %s',
    async (role) => {
      expect((await newUser(role)).role).toBe(role);
    },
  );

  it('rechaza un rol fuera del enum', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "users" SET "role" = $1::"UserRole" WHERE false`,
        'ADMIN',
      ),
    ).rejects.toThrow(/invalid input value for enum/i);
  });

  it('guarda el perfil y lo relaciona con su usuario', async () => {
    const user = await newUser('ARRENDADOR');
    await prisma.userProfile.create({
      data: { userId: user.id, name: 'Lee Fuentes', phone: '70001234' },
    });

    const withProfile = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { profile: true },
    });
    expect(withProfile.profile).toMatchObject({
      name: 'Lee Fuentes',
      phone: '70001234',
    });
  });

  it('no permite dos perfiles para el mismo usuario', async () => {
    const user = await newUser();
    await prisma.userProfile.create({
      data: { userId: user.id, name: 'Uno', phone: '70001234' },
    });

    await expect(
      prisma.userProfile.create({
        data: { userId: user.id, name: 'Dos', phone: '70005678' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it.each([
    ['con letras', '7000-1234'],
    ['de 7 dígitos', '7000123'],
    ['de 16 dígitos', '1234567890123456'],
  ])('rechaza un teléfono %s', async (_case, phone) => {
    const user = await newUser();
    await expect(
      prisma.userProfile.create({
        data: { userId: user.id, name: 'Ana', phone },
      }),
    ).rejects.toThrow(/user_profiles_phone_check|P2000|too long/i);
  });

  it('rechaza un nombre en blanco', async () => {
    const user = await newUser();
    await expect(
      prisma.userProfile.create({
        data: { userId: user.id, name: '   ', phone: '70001234' },
      }),
    ).rejects.toThrow(/user_profiles_name_not_blank_check/);
  });

  it('borra el perfil al borrar el usuario (ON DELETE CASCADE)', async () => {
    const user = await newUser();
    await prisma.userProfile.create({
      data: { userId: user.id, name: 'Ana', phone: '70001234' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.userProfile.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });
});
