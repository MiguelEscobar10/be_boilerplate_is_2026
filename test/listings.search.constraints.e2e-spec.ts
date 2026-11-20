import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Índices de búsqueda (DB-02.1) y de filtros (DB-11.1) del catálogo.
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

describe('listings: índices de búsqueda (DB-02.1)', () => {
  const email = `db-02.1-${randomUUID()}@test.local`;
  // Marca única para que la prueba solo vea sus propias publicaciones.
  const tag = `zq${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  let landlordId: string;

  /** La consulta que hará BE-02.1: activas cuyo nombre o descripción contienen el texto. */
  const search = async (text: string): Promise<string[]> => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM listings
      WHERE is_active
        AND landlord_id = ${landlordId}::uuid
        AND (search_text(name) LIKE '%' || search_text(${text}) || '%'
          OR search_text(description) LIKE '%' || search_text(${text}) || '%')
      ORDER BY created_at DESC, id DESC`;
    return rows.map((r) => r.name);
  };

  const create = (name: string, extra: object = {}) =>
    prisma.listing.create({
      data: {
        landlordId,
        type: 'EQUIPO',
        name,
        location: 'Antiguo Cuscatlán',
        rateAmount: '15.00',
        rateUnit: 'DIA',
        ...extra,
      },
    });

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email, passwordHash: 'no-es-un-hash-real' },
    });
    landlordId = user.id;
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { landlordId } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it('tiene las extensiones unaccent y pg_trgm', async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension
      WHERE extname IN ('unaccent', 'pg_trgm') ORDER BY extname`;
    expect(rows.map((r) => r.extname)).toEqual(['pg_trgm', 'unaccent']);
  });

  it('tiene los tres índices de la migración', async () => {
    const rows = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'listings'`;
    const def = (name: string) =>
      rows.find((r) => r.indexname === name)?.indexdef ?? '';

    expect(def('listings_name_search_idx')).toMatch(
      /USING gin \(search_text\(\(name\)::text\) gin_trgm_ops\)/,
    );
    expect(def('listings_description_search_idx')).toMatch(
      /USING gin \(search_text\(\(description\)::text\) gin_trgm_ops\)/,
    );
    expect(def('listings_is_active_created_at_id_idx')).toMatch(
      /\(is_active, created_at DESC, id DESC\)/,
    );
  });

  it('search_text quita mayúsculas y acentos', async () => {
    const [row] = await prisma.$queryRaw<{ value: string }[]>`
      SELECT search_text('SALÓN de Reuniones, Ñandú') AS value`;
    expect(row.value).toBe('salon de reuniones, nandu');
  });

  it('no devuelve nada cuando no hay registros', async () => {
    expect(await search(tag)).toEqual([]);
  });

  it('encuentra por nombre o descripción sin distinguir mayúsculas ni acentos', async () => {
    await create(`Salón ${tag}`);
    await create('Proyector', { description: `Incluye BATERÍA ${tag}` });
    await create('Escalera');

    expect(await search(`salon ${tag}`)).toEqual([`Salón ${tag}`]);
    expect(await search(`SALÓN ${tag}`)).toEqual([`Salón ${tag}`]);
    expect(await search(`bateria ${tag}`)).toEqual(['Proyector']);
    expect((await search(tag)).sort((a, b) => a.localeCompare(b))).toEqual([
      'Proyector',
      `Salón ${tag}`,
    ]);
  });

  it('excluye las publicaciones inactivas', async () => {
    await create(`Inactiva ${tag}`, { isActive: false });
    expect(await search(`inactiva ${tag}`)).toEqual([]);
  });

  it('ordena de la más reciente a la más antigua', async () => {
    const t = `orden${tag}`;
    await create(`Vieja ${t}`, { createdAt: new Date('2026-01-01') });
    await create(`Nueva ${t}`, { createdAt: new Date('2026-06-01') });
    expect(await search(t)).toEqual([`Nueva ${t}`, `Vieja ${t}`]);
  });

  it('la búsqueda y el orden por defecto pueden usar los índices', async () => {
    // Con pocas filas PostgreSQL prefiere leer la tabla completa; se apaga
    // esa opción solo dentro de la transacción para ver si el índice sirve.
    const plan = async (sql: string): Promise<string> => {
      const [, , rows] = await prisma.$transaction([
        prisma.$executeRawUnsafe('SET LOCAL enable_seqscan = off'),
        // Con tan pocas filas también prefiere ordenar a mano.
        prisma.$executeRawUnsafe('SET LOCAL enable_sort = off'),
        prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`),
      ]);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    };

    const text = await plan(
      `SELECT id FROM listings WHERE search_text(name) LIKE '%taladro%' OR search_text(description) LIKE '%taladro%'`,
    );
    expect(text).toContain('listings_name_search_idx');
    expect(text).toContain('listings_description_search_idx');

    expect(
      await plan(
        'SELECT id FROM listings WHERE is_active ORDER BY created_at DESC, id DESC LIMIT 12',
      ),
    ).toContain('listings_is_active_created_at_id_idx');
  });

  it('tiene los índices de los filtros (DB-11.1)', async () => {
    const rows = await prisma.$queryRaw<
      { indexname: string; indexdef: string }[]
    >`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'listings'`;
    const def = (name: string) =>
      rows.find((r) => r.indexname === name)?.indexdef ?? '';

    expect(def('listings_is_active_type_created_at_id_idx')).toMatch(
      /\(is_active, type, created_at DESC, id DESC\)/,
    );
    expect(def('listings_is_active_rate_amount_idx')).toMatch(
      /\(is_active, rate_amount\)/,
    );
    expect(def('listings_location_search_idx')).toMatch(
      /USING gin \(search_text\(\(location\)::text\) gin_trgm_ops\)/,
    );
  });

  it('los filtros de tipo, tarifa y ubicación pueden usar sus índices (DB-11.1)', async () => {
    const plan = async (sql: string): Promise<string> => {
      const [, , rows] = await prisma.$transaction([
        prisma.$executeRawUnsafe('SET LOCAL enable_seqscan = off'),
        // Con tan pocas filas también prefiere ordenar a mano.
        prisma.$executeRawUnsafe('SET LOCAL enable_sort = off'),
        prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`),
      ]);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    };

    expect(
      await plan(
        `SELECT id FROM listings WHERE is_active AND type = 'ESPACIO' ORDER BY created_at DESC, id DESC LIMIT 12`,
      ),
    ).toContain('listings_is_active_type_created_at_id_idx');
    expect(
      await plan(
        'SELECT id FROM listings WHERE is_active AND rate_amount BETWEEN 10 AND 20',
      ),
    ).toContain('listings_is_active_rate_amount_idx');
    expect(
      await plan(
        `SELECT id FROM listings WHERE search_text(location) LIKE '%cuscatlan%'`,
      ),
    ).toContain('listings_location_search_idx');
  });
});
