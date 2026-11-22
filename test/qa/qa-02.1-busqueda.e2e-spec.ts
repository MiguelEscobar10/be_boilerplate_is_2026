import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-02.1 (MP4-43): búsqueda por palabra clave en el catálogo (H02).
 *
 * Los casos que prueban un criterio de aceptación de H02 empiezan con «ACn:» y
 * conservan su id al final, entre paréntesis.
 *
 * Cada caso tiene un id (C01, C02...) que se repite en la evidencia de
 * docs/qa/QA-02.1-busqueda.md. Se compara lo que responde
 * `GET /publicaciones` con las publicaciones que hay en la base.
 *
 * Otras pruebas crean publicaciones en la misma base, así que cada búsqueda
 * lleva una marca única (`tag`) y solo ve las de esta prueba.
 */
describe('H02. Buscar equipos y espacios por palabra clave', () => {
  const email = `qa-02.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  const tag = `qa${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlordId: string;

  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, string | number> = {}) =>
    http().get('/api/v1/publicaciones').query(query);

  type Page = {
    items: { id: string; nombre: string }[];
    page: number;
    total: number;
  };
  const names = (body: Page) =>
    body.items.map((i) => i.nombre.replace(` ${tag}`, ''));

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

  const login = async (rol: 'ARRENDADOR' | 'ARRENDATARIO') => {
    const address = `${rol.toLowerCase()}-${email}`;
    await http()
      .post('/api/v1/users')
      .send({
        email: address,
        password,
        rol,
        nombre: 'Persona QA',
        telefono: '70001234',
      })
      .expect(201);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();

    // Se importa después de fijar las variables para que ConfigModule las lea.
    const { AppModule } = await import('../../src/app.module.js');
    const { PrismaService } =
      await import('../../src/prisma/services/prisma.service.js');
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

    // De la más reciente a la más antigua.
    await create('Cámara réflex', { createdAt: new Date('2026-05-01') });
    await create('CÁMARA de video', { createdAt: new Date('2026-04-01') });
    await create('Trípode', {
      description: `Sirve para cualquier camara ${tag}`,
      createdAt: new Date('2026-03-01'),
    });
    await create('Micrófono', {
      location: 'Frente a la tienda de camaras',
      conditions: 'No usar con la camara encendida',
      createdAt: new Date('2026-02-01'),
    });
    await create('Cámara desactivada', {
      isActive: false,
      createdAt: new Date('2026-06-01'),
    });
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { landlordId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('criterio 1: coincide en el nombre o la descripción, sin importar mayúsculas ni tildes', () => {
    it.each([
      ['camara', 'C01'],
      ['CÁMARA', 'C02'],
      ['cÁmArA', 'C03'],
    ])(
      'AC1: «%s» encuentra "Cámara" y "CÁMARA" en el nombre (%s)',
      async (texto) => {
        const { body } = await list({ buscar: `${texto}` }).expect(200);

        // Sin la marca la búsqueda ve toda la base: basta con que estén las dos.
        const all = (body as Page).items.map((i) => i.nombre);
        expect(all.length).toBeGreaterThan(0);
        const mine = await list({ buscar: texto, limit: 50 }).expect(200);
        const found = names(mine.body as Page);
        expect(found).toEqual(
          expect.arrayContaining(['Cámara réflex', 'CÁMARA de video']),
        );
      },
    );

    it('AC1: encuentra por la descripción (C04)', async () => {
      const { body } = await list({ buscar: `camara ${tag}` }).expect(200);

      expect(names(body as Page)).toEqual(['Trípode']);
    });

    it('C05: coincide con una parte de la palabra', async () => {
      const { body } = await list({ buscar: `eflex ${tag}` }).expect(200);

      expect(names(body as Page)).toEqual(['Cámara réflex']);
    });

    it('C06: la ubicación y las condiciones no cuentan para la búsqueda', async () => {
      const { body } = await list({ buscar: tag, limit: 50 }).expect(200);
      expect(names(body as Page)).toContain('Micrófono');

      // "camara" está en su ubicación y en sus condiciones, no en el nombre
      // ni en la descripción.
      const camaras = await list({ buscar: 'camara', limit: 50 }).expect(200);
      expect((camaras.body as Page).items.map((i) => i.nombre)).not.toContain(
        `Micrófono ${tag}`,
      );
    });

    it('C07: cada resultado trae lo que muestra la tarjeta', async () => {
      const listing = await prisma.listing.findFirstOrThrow({
        where: { name: `Cámara réflex ${tag}` },
      });

      const { body } = await list({ buscar: `reflex ${tag}` }).expect(200);

      expect(body).toEqual({
        items: [
          {
            id: listing.id,
            nombre: `Cámara réflex ${tag}`,
            precio: 15,
            tipo: 'EQUIPO',
            tarifaUnidad: 'DIA',
            ubicacion: 'Antiguo Cuscatlán',
            imagenUrl: null,
          },
        ],
        page: 1,
        total: 1,
      });
    });
  });

  describe('criterio 2: más recientes primero, de 12 en 12', () => {
    it('AC2: los resultados salen de la más reciente a la más antigua (C08)', async () => {
      const { body } = await list({ buscar: tag }).expect(200);

      expect(names(body as Page)).toEqual([
        'Cámara réflex',
        'CÁMARA de video',
        'Trípode',
        'Micrófono',
      ]);
    });

    it('AC2: con 13 resultados, la página 1 trae 12 y la página 2 trae 1 (C09)', async () => {
      const t = `trece${tag}`;
      for (let i = 1; i <= 13; i++) {
        await create(`Silla ${i} ${t}`, {
          createdAt: new Date(Date.UTC(2026, 0, i)),
        });
      }

      const first = (await list({ buscar: t }).expect(200)).body as Page;
      const second = (await list({ buscar: t, page: 2 }).expect(200))
        .body as Page;

      expect(first.items).toHaveLength(12);
      expect(first).toMatchObject({ page: 1, total: 13 });
      // La más nueva (día 13) va primero y la más vieja (día 1) queda sola
      // en la página 2.
      expect(first.items[0].nombre).toContain('Silla 13 ');
      expect(second.items.map((i) => i.nombre)).toEqual([
        `Silla 1 ${t} ${tag}`,
      ]);
      expect(second).toMatchObject({ page: 2, total: 13 });
    });

    it('C10: sin parámetros responde la primera página con 12 como máximo', async () => {
      const { body } = await list().expect(200);

      expect((body as Page).page).toBe(1);
      expect((body as Page).items.length).toBeLessThanOrEqual(12);
      expect((body as Page).total).toBeGreaterThanOrEqual(17);
    });

    it('C11: limit acepta hasta 50; 51, 0 y una página inválida son 400', async () => {
      await list({ buscar: tag, limit: 50 }).expect(200);
      await list({ limit: 51 }).expect(400);
      await list({ limit: 0 }).expect(400);
      await list({ page: 0 }).expect(400);
      await list({ page: 'dos' }).expect(400);
    });
  });

  describe('criterio 3: sin coincidencias', () => {
    it('AC3: responde 200 con la lista vacía y total 0 (C12)', async () => {
      const { body } = await list({ buscar: `unicornio-${tag}` }).expect(200);

      expect(body).toEqual({ items: [], page: 1, total: 0 });
    });

    it('C13: los comodines % y _ se buscan como texto', async () => {
      expect(
        ((await list({ buscar: `%${tag}` }).expect(200)).body as Page).total,
      ).toBe(0);
      expect(
        ((await list({ buscar: `C_mara ${tag}` }).expect(200)).body as Page)
          .total,
      ).toBe(0);
    });
  });

  describe('criterio 4: las desactivadas no aparecen', () => {
    it('AC4: no sale al buscarla por su nombre ni al recorrer el catálogo (C14)', async () => {
      const byName = await list({ buscar: `desactivada ${tag}` }).expect(200);
      expect(byName.body).toEqual({ items: [], page: 1, total: 0 });

      const all = await list({ buscar: tag, limit: 50 }).expect(200);
      expect(names(all.body as Page)).not.toContain('Cámara desactivada');
    });

    it('AC4: al desactivar una publicación deja de salir, y vuelve al reactivarla (C15)', async () => {
      const where = { name: `Trípode ${tag}` };
      const before = await list({ buscar: `tripode ${tag}` }).expect(200);
      expect((before.body as Page).total).toBe(1);

      await prisma.listing.updateMany({ where, data: { isActive: false } });
      const off = await list({ buscar: `tripode ${tag}` }).expect(200);
      expect((off.body as Page).total).toBe(0);

      await prisma.listing.updateMany({ where, data: { isActive: true } });
      const on = await list({ buscar: `tripode ${tag}` }).expect(200);
      expect((on.body as Page).total).toBe(1);
    });

    it('C16: el detalle de una desactivada responde 404', async () => {
      const listing = await prisma.listing.findFirstOrThrow({
        where: { name: `Cámara desactivada ${tag}` },
      });

      await http().get(`/api/v1/publicaciones/${listing.id}`).expect(404);
    });
  });

  describe('permisos de cada rol', () => {
    it('C17: responde lo mismo sin sesión, como arrendatario y como arrendador', async () => {
      const anonymous = await list({ buscar: tag }).expect(200);

      for (const rol of ['ARRENDATARIO', 'ARRENDADOR'] as const) {
        const token = await login(rol);
        const res = await list({ buscar: tag })
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(res.body).toEqual(anonymous.body);
      }
    });
  });
});
