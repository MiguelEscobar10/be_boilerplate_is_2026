import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Filtros del catálogo público (BE-11.1).
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

describe('filtros del catálogo (BE-11.1)', () => {
  const email = `be-11.1-${randomUUID()}@test.local`;
  const tag = `zq${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let landlordId: string;
  let tenantId: string;

  // Todas las consultas llevan la marca para ver solo lo de esta prueba.
  const list = (query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get('/api/v1/publicaciones')
      .query({ buscar: tag, ...query });

  const names = (res: { body: { items: { nombre: string }[] } }) =>
    res.body.items.map((i) => i.nombre.replace(` ${tag}`, ''));

  const create = (name: string, extra: object = {}) =>
    prisma.listing.create({
      data: {
        landlordId,
        type: 'EQUIPO',
        name: `${name} ${tag}`,
        location: 'Antiguo Cuscatlán',
        rateAmount: '15.00',
        rateUnit: 'DIA',
        ...extra,
      },
    });

  /** Instante en hora de El Salvador (UTC-6). */
  const sv = (day: string, hour = '00:00') =>
    new Date(`${day}T${hour}:00-06:00`);

  const reserve = (
    listingId: string,
    status: 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'CANCELADA',
    startAt: Date,
    endAt: Date,
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId,
        status,
        startAt,
        endAt,
        rentalCost: '30.00',
        depositAmount: '0.00',
      },
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();

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

    landlordId = (
      await prisma.user.create({
        data: { email, passwordHash: 'no-es-un-hash-real' },
      })
    ).id;
    tenantId = (
      await prisma.user.create({
        data: { email: `tenant-${email}`, passwordHash: 'no-es-un-hash-real' },
      })
    ).id;

    // De la más reciente a la más antigua: Taladro, Salón, Proyector, Bodega.
    await create('Taladro', {
      rateAmount: '10.00',
      createdAt: new Date('2026-04-01'),
    });
    await create('Salón', {
      type: 'ESPACIO',
      location: 'San Salvador, Escalón',
      rateAmount: '50.00',
      rateUnit: 'HORA',
      createdAt: new Date('2026-03-01'),
    });
    await create('Proyector', {
      location: 'Santa Tecla',
      rateAmount: '20.50',
      createdAt: new Date('2026-02-01'),
    });
    await create('Bodega', {
      type: 'ESPACIO',
      location: 'SAN SALVADOR, centro',
      rateAmount: '100.00',
      createdAt: new Date('2026-01-01'),
    });
    await create('Inactiva', {
      type: 'ESPACIO',
      location: 'San Salvador',
      isActive: false,
    });
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({ where: { tenantId } });
    await prisma.listing.deleteMany({ where: { landlordId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  it('sin filtros devuelve todas las activas', async () => {
    expect(names(await list().expect(200))).toEqual([
      'Taladro',
      'Salón',
      'Proyector',
      'Bodega',
    ]);
  });

  it('filtra por tipo', async () => {
    expect(names(await list({ tipo: 'ESPACIO' }).expect(200))).toEqual([
      'Salón',
      'Bodega',
    ]);
    expect(names(await list({ tipo: 'EQUIPO' }).expect(200))).toEqual([
      'Taladro',
      'Proyector',
    ]);
  });

  it.each([
    ['minúsculas', 'san salvador'],
    ['mayúsculas', 'SAN SALVADOR'],
    ['parte del texto', 'salvad'],
  ])('filtra por ubicación: %s', async (_caso, ubicacion) => {
    expect(names(await list({ ubicacion }).expect(200))).toEqual([
      'Salón',
      'Bodega',
    ]);
  });

  it('la ubicación ignora los acentos', async () => {
    expect(names(await list({ ubicacion: 'escalon' }).expect(200))).toEqual([
      'Salón',
    ]);
    expect(names(await list({ ubicacion: 'cuscatlan' }).expect(200))).toEqual([
      'Taladro',
    ]);
  });

  it('filtra por precio mínimo, máximo y rango, con los extremos incluidos', async () => {
    expect(names(await list({ precioMin: 50 }).expect(200))).toEqual([
      'Salón',
      'Bodega',
    ]);
    expect(names(await list({ precioMax: 20.5 }).expect(200))).toEqual([
      'Taladro',
      'Proyector',
    ]);
    expect(
      names(await list({ precioMin: 20.5, precioMax: 50 }).expect(200)),
    ).toEqual(['Salón', 'Proyector']);
    expect(
      names(await list({ precioMin: 10, precioMax: 10 }).expect(200)),
    ).toEqual(['Taladro']);
    expect(names(await list({ precioMin: 0 }).expect(200))).toHaveLength(4);
  });

  it('combina los filtros entre sí y con la búsqueda', async () => {
    const res = await list({
      tipo: 'ESPACIO',
      ubicacion: 'san salvador',
      precioMax: 60,
    }).expect(200);
    expect(names(res)).toEqual(['Salón']);
    expect(res.body).toMatchObject({ page: 1, total: 1 });

    const none = await list({ tipo: 'EQUIPO', ubicacion: 'san salvador' });
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ items: [], page: 1, total: 0 });
  });

  it('pagina el resultado filtrado y total cuenta las coincidencias', async () => {
    const res = await list({ tipo: 'ESPACIO', limit: 1, page: 2 }).expect(200);
    expect(names(res)).toEqual(['Bodega']);
    expect(res.body).toMatchObject({ page: 2, total: 2 });
  });

  it('nunca devuelve inactivas, aunque cumplan los filtros', async () => {
    const res = await list({ tipo: 'ESPACIO', ubicacion: 'san salvador' });
    expect(names(res)).not.toContain('Inactiva');
  });

  describe('fechas disponibles', () => {
    const rango = { fechaInicio: '2027-03-10', fechaFin: '2027-03-12' };
    let ids: Record<string, string>;

    beforeAll(async () => {
      const rows = await prisma.listing.findMany({ where: { landlordId } });
      ids = Object.fromEntries(
        rows.map((r) => [r.name.replace(` ${tag}`, ''), r.id]),
      );

      // Taladro: reserva CONFIRMADA que se cruza con el rango.
      await reserve(
        ids.Taladro,
        'CONFIRMADA',
        sv('2027-03-11'),
        sv('2027-03-13'),
      );
      // Salón: bloqueo del arrendador dentro del rango.
      await prisma.availabilityBlock.create({
        data: {
          listingId: ids['Salón'],
          startAt: sv('2027-03-12', '08:00'),
          endAt: sv('2027-03-12', '12:00'),
        },
      });
      // Proyector: solo solicitudes que no apartan fechas.
      await reserve(
        ids.Proyector,
        'PENDIENTE',
        sv('2027-03-10'),
        sv('2027-03-12'),
      );
      await reserve(
        ids.Proyector,
        'CANCELADA',
        sv('2027-03-10'),
        sv('2027-03-12'),
      );
      // Bodega: reserva EN_CURSO que termina justo cuando empieza el rango.
      await reserve(ids.Bodega, 'EN_CURSO', sv('2027-03-08'), sv('2027-03-10'));
    });

    it('excluye las que tienen una reserva confirmada o un bloqueo en el rango', async () => {
      expect(names(await list(rango).expect(200))).toEqual([
        'Proyector',
        'Bodega',
      ]);
    });

    it('las solicitudes PENDIENTE y CANCELADA no apartan fechas', async () => {
      expect(names(await list(rango).expect(200))).toContain('Proyector');
    });

    it('una reserva que termina justo al empezar el rango no lo ocupa', async () => {
      expect(names(await list(rango).expect(200))).toContain('Bodega');
      expect(
        names(
          await list({
            fechaInicio: '2027-03-09',
            fechaFin: '2027-03-09',
          }).expect(200),
        ),
      ).not.toContain('Bodega');
    });

    it('fechaFin va incluido: un bloqueo en el último día ocupa', async () => {
      expect(
        names(
          await list({
            fechaInicio: '2027-03-12',
            fechaFin: '2027-03-12',
          }).expect(200),
        ),
      ).not.toContain('Salón');
      expect(
        names(
          await list({
            fechaInicio: '2027-03-10',
            fechaFin: '2027-03-11',
          }).expect(200),
        ),
      ).toContain('Salón');
    });

    it('fuera del rango ocupado todas están disponibles', async () => {
      expect(
        names(
          await list({
            fechaInicio: '2027-04-01',
            fechaFin: '2027-04-05',
          }).expect(200),
        ),
      ).toHaveLength(4);
    });

    it('se combina con los demás filtros', async () => {
      const res = await list({ ...rango, tipo: 'ESPACIO' }).expect(200);
      expect(names(res)).toEqual(['Bodega']);
      expect(res.body.total).toBe(1);
    });
  });

  it('acepta hoy como fechaInicio', async () => {
    // Hoy en El Salvador (UTC-6).
    const hoy = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
    await list({ fechaInicio: hoy, fechaFin: hoy }).expect(200);
  });

  it.each([
    ['un tipo fuera del enum', { tipo: 'VEHICULO' }],
    ['precioMin negativo', { precioMin: -1 }],
    ['precioMax no numérico', { precioMax: 'caro' }],
    ['precioMin con tres decimales', { precioMin: 1.234 }],
    ['precioMin mayor que precioMax', { precioMin: 50, precioMax: 10 }],
    ['ubicacion de 201 caracteres', { ubicacion: 'a'.repeat(201) }],
    ['fechaInicio sin fechaFin', { fechaInicio: '2027-03-10' }],
    ['fechaFin sin fechaInicio', { fechaFin: '2027-03-10' }],
    [
      'una fecha con otro formato',
      { fechaInicio: '10/03/2027', fechaFin: '2027-03-12' },
    ],
    [
      'una fecha que no existe',
      { fechaInicio: '2027-02-30', fechaFin: '2027-03-12' },
    ],
    [
      'fechaInicio en el pasado',
      { fechaInicio: '2020-01-01', fechaFin: '2027-03-12' },
    ],
    [
      'fechaFin anterior a fechaInicio',
      { fechaInicio: '2027-03-12', fechaFin: '2027-03-10' },
    ],
  ])('responde 400 con %s', async (_caso, query) => {
    await list(query as Record<string, string | number>).expect(400);
  });
});
