import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de restricciones de la tabla `notifications` (DB-10.1).
 *
 * Corre contra una base de pruebas separada, nunca contra la de desarrollo:
 * usa TEST_DATABASE_URL o, si no está, DATABASE_URL con `_test` agregado al
 * nombre de la base. Se niega a correr si la base no es local o su nombre no
 * termina en `_test`. Además crea un usuario propio con email único y en
 * afterAll borra solo ese usuario (la cascada se lleva sus notificaciones).
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
    throw new Error(`La base de pruebas debe ser local (host: ${url.hostname}).`);
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(`La base de pruebas debe terminar en _test (es ${dbName}).`);
  }
  return url.toString();
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }),
});

describe('notifications: restricciones (DB-10.1)', () => {
  const email = `db-10.1-${randomUUID()}@test.local`;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email, passwordHash: 'no-es-un-hash-real' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Solo los registros creados por esta prueba: todos sus usuarios terminan
    // en el mismo email único, también si alguna prueba falló a mitad.
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  it('asocia la notificación a su usuario y guarda created_at', async () => {
    const n = await prisma.notification.create({
      data: {
        userId,
        sourceModule: 'RESERVAS',
        title: 'Nueva solicitud de reserva',
        message: 'Tenés una solicitud nueva.',
        referenceType: 'reserva',
        referenceId: randomUUID(),
      },
    });

    expect(n.userId).toBe(userId);
    expect(n.createdAt).toBeInstanceOf(Date);
    expect(n.readAt).toBeNull();
  });

  it('permite registrar un aviso sin referencia', async () => {
    const n = await prisma.notification.create({
      data: { userId, sourceModule: 'MENSAJERIA', title: 'Mensaje nuevo', message: 'Hola' },
    });

    expect(n.referenceType).toBeNull();
    expect(n.referenceId).toBeNull();
  });

  it('rechaza un user_id que no existe (FK)', async () => {
    await expect(
      prisma.notification.create({
        data: { userId: randomUUID(), sourceModule: 'RESERVAS', title: 't', message: 'm' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it.each(['user_id', 'source_module', 'title', 'message'])(
    'rechaza %s en NULL',
    async (column) => {
      const values: Record<string, string | null> = {
        user_id: userId,
        source_module: 'RESERVAS',
        title: 't',
        message: 'm',
      };
      values[column] = null;

      await expect(
        prisma.$executeRaw`
          INSERT INTO "notifications" ("id", "user_id", "source_module", "title", "message")
          VALUES (${randomUUID()}::uuid, ${values.user_id}::uuid, ${values.source_module},
                  ${values.title}, ${values.message})`,
      ).rejects.toThrow(/null value in column|violates not-null/i);
    },
  );

  it('lista pendientes y recientes del usuario, y guarda read_at al leer', async () => {
    const owner = await prisma.user.create({
      data: { email: `inbox-${email}`, passwordHash: 'x' },
    });
    try {
      const base = Date.now();
      const [older, newer, read] = await Promise.all(
        [0, 1, 2].map((i) =>
          prisma.notification.create({
            data: {
              userId: owner.id,
              sourceModule: 'PAGOS_GARANTIA',
              title: `Aviso ${i}`,
              message: 'm',
              createdAt: new Date(base + i * 1000),
            },
          }),
        ),
      );

      const readAt = new Date();
      await prisma.notification.update({ where: { id: read.id }, data: { readAt } });

      const pending = await prisma.notification.findMany({
        where: { userId: owner.id, readAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(pending.map((n) => n.id)).toEqual([newer.id, older.id]);

      const recent = await prisma.notification.findMany({
        where: { userId: owner.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(recent.map((n) => n.id)).toEqual([read.id, newer.id, older.id]);
      expect(recent[0].readAt?.getTime()).toBe(readAt.getTime());
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it('la bandeja de pendientes puede usar el índice (user_id, read_at, created_at DESC)', async () => {
    const plan = await prisma.$transaction(async (tx) => {
      // Con pocas filas Postgres prefiere un seq scan; se desactiva solo en
      // esta transacción para comprobar que el índice cubre la consulta.
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<{ 'QUERY PLAN': string }[]>`
        EXPLAIN SELECT * FROM "notifications"
        WHERE "user_id" = ${userId}::uuid AND "read_at" IS NULL
        ORDER BY "created_at" DESC`;
    });

    const text = plan.map((row) => row['QUERY PLAN']).join('\n');
    // Solo se comprueba que el índice se usa. Si además ordena o no con él es
    // decisión del planner según las estadísticas, no del esquema.
    expect(text).toContain('notifications_user_id_read_at_created_at_idx');
  });

  it('borra las notificaciones al borrar el usuario (ON DELETE CASCADE)', async () => {
    const temp = await prisma.user.create({
      data: { email: `cascade-${email}`, passwordHash: 'x' },
    });
    await prisma.notification.create({
      data: { userId: temp.id, sourceModule: 'RESERVAS', title: 't', message: 'm' },
    });

    await prisma.user.delete({ where: { id: temp.id } });

    expect(await prisma.notification.count({ where: { userId: temp.id } })).toBe(0);
  });
});
