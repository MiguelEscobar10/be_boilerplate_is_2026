import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Base de pruebas para las pruebas e2e que tocan Postgres.
 *
 * Usa TEST_DATABASE_URL o, si no está, DATABASE_URL con `_test` agregado al
 * nombre de la base. Se niega a correr si la base no es local o su nombre no
 * termina en `_test`, para no tocar nunca la base de desarrollo.
 *
 * Por ahora lo usa solo test/notifications.avisos.e2e-spec.ts. La prueba de
 * restricciones tiene su propia copia de esta función; se unifican cuando su
 * PR esté mergeado.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
export function resolveTestDatabaseUrl(): string {
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

/** Cliente de Prisma conectado a la base de pruebas. */
export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }),
  });
}
