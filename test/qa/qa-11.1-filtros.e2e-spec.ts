import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-11.1 (MP4-47): filtros del catálogo, fechas disponibles y rangos
 * inválidos (H11).
 *
 * Cada caso tiene un id (C01, C02...) que se repite en la evidencia de
 * docs/qa/QA-11.1-filtros.md. Se compara lo que responde
 * `GET /publicaciones` con lo que hay en la base: publicaciones, reservas en
 * cada estado y bloqueos.
 *
 * Todas las consultas llevan una marca única en `buscar` para ver solo las
 * publicaciones de esta prueba. Las reservas se crean directo en la base
 * (BE-03.1 todavía no está en main); el bloqueo usa el endpoint real de H14.
 */
type Status =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'EN_CURSO'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'COMPLETADA';

describe('QA-11.1: filtros del catálogo', () => {
  const email = `qa-11.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  const tag = `qa${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlordId: string;
  let landlordToken: string;
  let tenantId: string;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, string | number> = {}) =>
    http()
      .get('/api/v1/publicaciones')
      .query({ buscar: tag, ...query });

  type Page = {
    items: {
      nombre: string;
      precio: number;
      tipo: string;
      ubicacion: string;
    }[];
    page: number;
    total: number;
  };
  const names = (res: { body: Page }) =>
    res.body.items.map((i) => i.nombre.replace(` ${tag}`, ''));

  /** Día `n` contado desde hoy en El Salvador (UTC-6), como `AAAA-MM-DD`. */
  const day = (n: number) =>
    new Date(Date.now() - 6 * 3_600_000 + n * 86_400_000)
      .toISOString()
      .slice(0, 10);
  /** Las 00:00 de El Salvador de ese día. */
  const at = (n: number, hour = '00:00') =>
    new Date(`${day(n)}T${hour}:00-06:00`);

  const create = async (name: string, extra: object = {}) => {
    const listing = await prisma.listing.create({
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
    ids[name] = listing.id;
  };

  const reserve = (name: string, status: Status, from: Date, to: Date) =>
    prisma.reservation.create({
      data: {
        listingId: ids[name],
        tenantId,
        status,
        startAt: from,
        endAt: to,
        rentalCost: '30.00',
        depositAmount: '0.00',
      },
    });

  // El rango que se consulta en los casos de fechas: del día 10 al 12.
  const RANGO = { fechaInicio: day(10), fechaFin: day(12) };

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

    await http()
      .post('/api/v1/users')
      .send({
        email,
        password,
        rol: 'ARRENDADOR',
        nombre: 'Dueña QA',
        telefono: '70001234',
      })
      .expect(201);
    landlordToken = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.accessToken;
    landlordId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    tenantId = (
      await prisma.user.create({
        data: { email: `tenant-${email}`, passwordHash: 'no-es-un-hash-real' },
      })
    ).id;

    // De la más reciente a la más antigua.
    await create('Taladro', {
      rateAmount: '10.00',
      location: 'Santa Tecla',
      createdAt: new Date('2026-06-01'),
    });
    await create('Salón', {
      type: 'ESPACIO',
      location: 'San Salvador, Escalón',
      rateAmount: '50.00',
      rateUnit: 'HORA',
      createdAt: new Date('2026-05-01'),
    });
    await create('Proyector', {
      location: 'Santa Tecla',
      rateAmount: '20.50',
      createdAt: new Date('2026-04-01'),
    });
    await create('Bodega', {
      type: 'ESPACIO',
      location: 'SAN SALVADOR, centro',
      rateAmount: '100.00',
      rateUnit: 'SEMANA',
      createdAt: new Date('2026-03-01'),
    });
    await create('Cancha', {
      type: 'ESPACIO',
      location: 'Soyapango',
      rateAmount: '30.00',
      rateUnit: 'HORA',
      createdAt: new Date('2026-02-01'),
    });
    await create('Inactiva', {
      type: 'ESPACIO',
      location: 'San Salvador',
      rateAmount: '50.00',
      isActive: false,
    });

    // Ocupación dentro del rango (días 10 a 12):
    await reserve('Taladro', 'CONFIRMADA', at(11), at(13));
    await reserve('Salón', 'EN_CURSO', at(9), at(10, '08:00'));
    await http()
      .post(`/api/v1/publicaciones/${ids.Proyector}/bloqueos`)
      .set('Authorization', `Bearer ${landlordToken}`)
      .send({
        inicio: `${day(12)}T08:00:00-06:00`,
        fin: `${day(12)}T12:00:00-06:00`,
        motivo: 'Mantenimiento',
      })
      .expect(201);
    // Bodega: solo cosas que no apartan fechas.
    await reserve('Bodega', 'PENDIENTE', at(10), at(12));
    await reserve('Bodega', 'RECHAZADA', at(10), at(12));
    await reserve('Bodega', 'CANCELADA', at(10), at(12));
    await reserve('Bodega', 'COMPLETADA', at(10), at(12));
    // Cancha: una reserva que termina justo cuando empieza el rango.
    await reserve('Cancha', 'CONFIRMADA', at(8), at(10));
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({ where: { tenantId } });
    await prisma.listing.deleteMany({ where: { landlordId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('criterio 1: tipo, ubicación y precio', () => {
    it('C01: por tipo, todos los resultados son de ese tipo', async () => {
      const espacios = await list({ tipo: 'ESPACIO' }).expect(200);
      expect(names(espacios)).toEqual(['Salón', 'Bodega', 'Cancha']);
      expect(
        espacios.body.items.every(
          (i: Page['items'][0]) => i.tipo === 'ESPACIO',
        ),
      ).toBe(true);

      expect(names(await list({ tipo: 'EQUIPO' }).expect(200))).toEqual([
        'Taladro',
        'Proyector',
      ]);
    });

    it('C02: por ubicación, sin distinguir mayúsculas ni tildes', async () => {
      for (const ubicacion of ['san salvador', 'SAN SALVADOR', 'Salvador']) {
        expect(names(await list({ ubicacion }).expect(200))).toEqual([
          'Salón',
          'Bodega',
        ]);
      }
      expect(names(await list({ ubicacion: 'escalon' }).expect(200))).toEqual([
        'Salón',
      ]);
    });

    it('C03: por rango de precio, con los extremos incluidos', async () => {
      const res = await list({ precioMin: 20.5, precioMax: 50 }).expect(200);
      expect(names(res)).toEqual(['Salón', 'Proyector', 'Cancha']);
      expect(
        res.body.items.every(
          (i: Page['items'][0]) => i.precio >= 20.5 && i.precio <= 50,
        ),
      ).toBe(true);

      expect(names(await list({ precioMin: 100 }).expect(200))).toEqual([
        'Bodega',
      ]);
      expect(names(await list({ precioMax: 10 }).expect(200))).toEqual([
        'Taladro',
      ]);
    });

    it('C04: los tres a la vez devuelven solo lo que cumple los tres', async () => {
      const res = await list({
        tipo: 'ESPACIO',
        ubicacion: 'san salvador',
        precioMax: 60,
      }).expect(200);

      expect(names(res)).toEqual(['Salón']);
      expect(res.body).toMatchObject({ page: 1, total: 1 });
    });

    it('C05: una inactiva no aparece aunque cumpla todos los filtros', async () => {
      const res = await list({
        tipo: 'ESPACIO',
        ubicacion: 'san salvador',
        precioMin: 50,
        precioMax: 50,
      }).expect(200);

      expect(names(res)).toEqual(['Salón']);
    });
  });

  describe('criterio 2: fechas disponibles', () => {
    it('C06: excluye las que tienen una reserva CONFIRMADA o EN_CURSO o un bloqueo en el rango', async () => {
      const res = await list(RANGO).expect(200);

      expect(names(res)).toEqual(['Bodega', 'Cancha']);
      expect(res.body.total).toBe(2);
    });

    it('C07: las solicitudes PENDIENTE, RECHAZADA, CANCELADA y COMPLETADA no excluyen', async () => {
      expect(names(await list(RANGO).expect(200))).toContain('Bodega');
    });

    it('C08: una reserva que termina justo al empezar el rango no excluye; un día antes sí', async () => {
      expect(names(await list(RANGO).expect(200))).toContain('Cancha');

      const antes = await list({
        fechaInicio: day(9),
        fechaFin: day(9),
      }).expect(200);
      expect(names(antes)).not.toContain('Cancha');
    });

    it('C09: el último día del rango cuenta (bloqueo del día 12)', async () => {
      const hasta11 = await list({
        fechaInicio: day(11),
        fechaFin: day(11),
      }).expect(200);
      expect(names(hasta11)).toContain('Proyector');

      const dia12 = await list({
        fechaInicio: day(12),
        fechaFin: day(12),
      }).expect(200);
      expect(names(dia12)).not.toContain('Proyector');
    });

    it('C10: fuera de los períodos ocupados aparecen todas', async () => {
      const res = await list({
        fechaInicio: day(30),
        fechaFin: day(35),
      }).expect(200);

      expect(res.body.total).toBe(5);
    });

    it('C11: hoy es una fecha de inicio válida', async () => {
      await list({ fechaInicio: day(0), fechaFin: day(0) }).expect(200);
    });
  });

  describe('criterio 3: palabra clave con filtros, orden y páginas', () => {
    it('C12: los resultados cumplen la palabra y los filtros, más reciente primero', async () => {
      const res = await http()
        .get('/api/v1/publicaciones')
        .query({ buscar: tag, tipo: 'EQUIPO', ...RANGO })
        .expect(200);
      // Con fechas y tipo EQUIPO no queda ninguno: Taladro y Proyector están ocupados.
      expect(res.body).toEqual({ items: [], page: 1, total: 0 });

      const espacios = await http()
        .get('/api/v1/publicaciones')
        .query({ buscar: tag, tipo: 'ESPACIO', ...RANGO })
        .expect(200);
      expect(names(espacios)).toEqual(['Bodega', 'Cancha']);

      const salon = await http()
        .get('/api/v1/publicaciones')
        .query({ buscar: `salon ${tag}`, tipo: 'ESPACIO', precioMax: 60 })
        .expect(200);
      expect(names(salon)).toEqual(['Salón']);
    });

    it('C13: con 13 resultados filtrados, páginas de 12 y el total cuenta todos', async () => {
      const t = `trece${tag}`;
      for (let i = 1; i <= 13; i++) {
        await create(`Silla ${i} ${t}`, {
          location: 'Mejicanos',
          rateAmount: '2.00',
          createdAt: new Date(Date.UTC(2026, 0, i)),
        });
      }
      const query = { buscar: t, ubicacion: 'mejicanos', precioMax: 5 };

      const first = await http()
        .get('/api/v1/publicaciones')
        .query(query)
        .expect(200);
      const second = await http()
        .get('/api/v1/publicaciones')
        .query({ ...query, page: 2 })
        .expect(200);

      expect(first.body.items).toHaveLength(12);
      expect(first.body).toMatchObject({ page: 1, total: 13 });
      expect(first.body.items[0].nombre).toContain('Silla 13 ');
      expect(second.body.items).toHaveLength(1);
      expect(second.body).toMatchObject({ page: 2, total: 13 });
    });
  });

  describe('criterio 4: ninguna publicación cumple', () => {
    it('C14: responde 200 con la lista vacía y total 0', async () => {
      const res = await list({ tipo: 'EQUIPO', precioMin: 500 }).expect(200);

      expect(res.body).toEqual({ items: [], page: 1, total: 0 });
    });
  });

  describe('criterio 5: rangos inválidos', () => {
    it.each([
      [
        'C15',
        'precio mínimo mayor que el máximo',
        { precioMin: 50, precioMax: 10 },
      ],
      ['C16', 'precio negativo', { precioMin: -1 }],
      ['C17', 'precio que no es un número', { precioMax: 'caro' }],
      ['C18', 'fechas al revés', { fechaInicio: day(12), fechaFin: day(10) }],
      [
        'C19',
        'fecha de inicio en el pasado',
        { fechaInicio: day(-1), fechaFin: day(10) },
      ],
      ['C20', 'solo una de las dos fechas', { fechaInicio: day(10) }],
      [
        'C21',
        'una fecha que no existe',
        { fechaInicio: '2027-02-30', fechaFin: '2027-03-02' },
      ],
      [
        'C22',
        'una fecha con otro formato',
        { fechaInicio: '10/03/2027', fechaFin: '12/03/2027' },
      ],
      ['C23', 'un tipo que no existe', { tipo: 'VEHICULO' }],
      ['C24', 'una página inválida', { tipo: 'EQUIPO', page: 0 }],
    ])(
      '%s: %s es 400 con un mensaje que dice qué está mal',
      async (_id, _caso, query) => {
        const res = await list(query as Record<string, string | number>).expect(
          400,
        );

        const message = Array.isArray(res.body.message)
          ? res.body.message.join(' ')
          : String(res.body.message);
        expect(message.length).toBeGreaterThan(10);
        expect(message).toMatch(/precio|fecha|tipo|page/i);
      },
    );
  });

  describe('permisos de cada rol', () => {
    it('C25: los filtros responden lo mismo sin sesión y con sesión', async () => {
      const anonymous = await list({ tipo: 'ESPACIO', ...RANGO }).expect(200);
      const withSession = await list({ tipo: 'ESPACIO', ...RANGO })
        .set('Authorization', `Bearer ${landlordToken}`)
        .expect(200);

      expect(withSession.body).toEqual(anonymous.body);
    });
  });
});
