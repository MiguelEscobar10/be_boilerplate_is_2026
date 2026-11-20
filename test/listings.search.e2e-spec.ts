import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Catálogo público con búsqueda y paginación (BE-02.1).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`). Cada búsqueda lleva una marca única para ver solo las
 * publicaciones que crea esta prueba.
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base)
    throw new Error('Definí TEST_DATABASE_URL o DATABASE_URL.');

  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(
      `La base de pruebas debe ser local (host: ${url.hostname}).`,
    );
  }
  if (!url.pathname.slice(1).endsWith('_test')) {
    throw new Error(
      `La base de pruebas debe terminar en _test (es ${url.pathname.slice(1)}).`,
    );
  }
  return url.toString();
}

describe('catálogo público (BE-02.1)', () => {
  const email = `be-02.1-${randomUUID()}@test.local`;
  const tag = `zq${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let landlordId: string;

  const list = (query: Record<string, string | number> = {}) =>
    request(app.getHttpServer()).get('/api/v1/publicaciones').query(query);

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

  const names = (body: { items: { nombre: string }[] }) =>
    body.items.map((i) => i.nombre);

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();

    // Se importa después de fijar las variables para que ConfigModule las lea.
    const { AppModule } = await import('../src/app.module.js');
    const { PrismaService } =
      await import('../src/prisma/services/prisma.service.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: { email, passwordHash: 'no-es-un-hash-real' },
    });
    landlordId = user.id;

    await create(`Taladro percutor ${tag}`, {
      createdAt: new Date('2026-03-01'),
      rateAmount: '15.50',
      images: {
        create: [
          { path: 'a.jpg', position: 0 },
          { path: 'b.jpg', position: 1 },
        ],
      },
    });
    await create(`Salón ${tag}`, {
      type: 'ESPACIO',
      rateUnit: 'HORA',
      createdAt: new Date('2026-02-01'),
    });
    await create('Proyector', {
      description: `Incluye BATERÍA y cable ${tag}`,
      createdAt: new Date('2026-01-01'),
    });
    await create(`Taladro inactivo ${tag}`, { isActive: false });
    await create(`Descuento 100% ${tag}`, {
      createdAt: new Date('2025-12-01'),
    });
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { landlordId } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('es público y devuelve la forma del contrato', async () => {
    const res = await list({ buscar: `PERCUTOR ${tag}` }).expect(200);
    const listing = await prisma.listing.findFirstOrThrow({
      where: { name: `Taladro percutor ${tag}` },
    });

    expect(res.body).toEqual({
      items: [
        {
          id: listing.id,
          nombre: `Taladro percutor ${tag}`,
          precio: 15.5,
          tipo: 'EQUIPO',
          tarifaUnidad: 'DIA',
          ubicacion: 'Antiguo Cuscatlán',
          imagenUrl: `/api/v1/publicaciones/${listing.id}/imagenes/0`,
        },
      ],
      page: 1,
      total: 1,
    });
  });

  it.each([
    ['minúsculas y sin acento', 'salon'],
    ['mayúsculas y con acento', 'SALÓN'],
    ['parte de una palabra', 'alón'],
  ])('busca en el nombre: %s', async (_caso, texto) => {
    const res = await list({ buscar: `${texto} ${tag}` }).expect(200);
    expect(names(res.body)).toEqual([`Salón ${tag}`]);
    expect(res.body.items[0].imagenUrl).toBeNull();
  });

  it('busca en la descripción sin distinguir mayúsculas ni acentos', async () => {
    const res = await list({ buscar: `bateria y cable ${tag}` }).expect(200);
    expect(names(res.body)).toEqual(['Proyector']);
  });

  it('no devuelve publicaciones inactivas', async () => {
    const res = await list({ buscar: `inactivo ${tag}` }).expect(200);
    expect(res.body).toEqual({ items: [], page: 1, total: 0 });
  });

  it('con cero resultados responde 200 con items vacío', async () => {
    const res = await list({ buscar: `no-existe-${tag}` }).expect(200);
    expect(res.body).toEqual({ items: [], page: 1, total: 0 });
  });

  it('ordena de la más reciente a la más antigua', async () => {
    const res = await list({ buscar: tag }).expect(200);
    expect(names(res.body)).toEqual([
      `Taladro percutor ${tag}`,
      `Salón ${tag}`,
      'Proyector',
      `Descuento 100% ${tag}`,
    ]);
    expect(res.body.total).toBe(4);
  });

  it('pagina con limit y page, y total cuenta todas las coincidencias', async () => {
    const first = await list({ buscar: tag, limit: 3 }).expect(200);
    const second = await list({ buscar: tag, limit: 3, page: 2 }).expect(200);
    const third = await list({ buscar: tag, limit: 3, page: 3 }).expect(200);

    expect(first.body.items).toHaveLength(3);
    expect(names(second.body)).toEqual([`Descuento 100% ${tag}`]);
    expect(second.body).toMatchObject({ page: 2, total: 4 });
    expect(third.body).toEqual({ items: [], page: 3, total: 4 });
  });

  it('sin parámetros devuelve 12 por página, solo activas', async () => {
    const t = `doce${tag}`;
    for (let i = 0; i < 13; i++) await create(`Silla ${i} ${t}`);

    const filtered = await list({ buscar: t }).expect(200);
    expect(filtered.body.items).toHaveLength(12);
    expect(filtered.body.total).toBe(13);

    const all = await list().expect(200);
    expect(all.body.page).toBe(1);
    expect(all.body.items).toHaveLength(12);
    expect(all.body.total).toBe(
      await prisma.listing.count({ where: { isActive: true } }),
    );
  });

  it('acepta limit 50 y un buscar vacío', async () => {
    await list({ limit: 50, buscar: '' }).expect(200);
    await list({ buscar: '   ' }).expect(200);
  });

  it('trata % y _ como texto, no como comodines', async () => {
    const percent = await list({ buscar: `100% ${tag}` }).expect(200);
    expect(names(percent.body)).toEqual([`Descuento 100% ${tag}`]);

    const wildcard = await list({ buscar: `Taladro%${tag}` }).expect(200);
    expect(wildcard.body.total).toBe(0);
    const underscore = await list({ buscar: `Taladro_percutor` }).expect(200);
    expect(underscore.body.total).toBe(0);
  });

  it.each([
    ['page=0', { page: 0 }],
    ['page negativa', { page: -1 }],
    ['page no numérica', { page: 'abc' }],
    ['page decimal', { page: 1.5 }],
    ['limit=0', { limit: 0 }],
    ['limit=51', { limit: 51 }],
    ['limit no numérico', { limit: 'doce' }],
    ['buscar de 101 caracteres', { buscar: 'a'.repeat(101) }],
    ['un parámetro desconocido', { orden: 'precio' }],
  ])('responde 400 con %s', async (_caso, query) => {
    await list(query as Record<string, string | number>).expect(400);
  });
});
