import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { ListingRatingsService } from '@ListingRatings';
import { createTestPrismaClient } from '../helpers/test-database.js';

/**
 * QA-17.1 (MP4-92): prueba de la calificación del bien y del arrendador (H17).
 *
 * Los ids (R01 a R13) se repiten en docs/qa/QA-17.1-calificacion.md. Cada caso
 * llama a POST /api/v1/reservas/:id/calificacion con el JWT de un login real y
 * revisa la respuesta, lo guardado en `listing_landlord_ratings` y, para los
 * promedios, `promedioCalificaciones` (lo que BE-12.1 mostrará en el detalle).
 *
 * - Las reservas se crean directo en la base en el estado que pide cada caso.
 * - R12 y R13 insertan directo en la tabla para comprobar que la base rechaza
 *   lo mismo que la API (puntajes fuera de rango y segunda calificación).
 *
 * Corre contra la base `_test` (test/helpers/test-database.ts). Los correos
 * llevan un sufijo único por ejecución y en afterAll se borra solo lo creado.
 */
const prisma = createTestPrismaClient();

type Quien = 't1' | 't2' | 'l1' | 'l2';
type Estado =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'EN_CURSO'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'COMPLETADA';

describe('H17. Calificar el bien y al arrendador', () => {
  const sufijo = `qa-17.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let service: ListingRatingsService;
  const user = {} as Record<Quien, { id: string; token: string }>;
  let taladro: string; // de l1
  let sierra: string; // de l1
  let compresor: string; // de l2

  const http = () => request(app.getHttpServer());

  const calificar = (
    reservaId: string,
    body: unknown = { puntajeBien: 4, puntajeArrendador: 5 },
    quien: Quien | null = 't1',
  ) => {
    const req = http()
      .post(`/api/v1/reservas/${reservaId}/calificacion`)
      .send(body as object);
    return quien
      ? req.set('Authorization', `Bearer ${user[quien].token}`)
      : req;
  };

  async function cuenta(quien: Quien, rol: 'ARRENDADOR' | 'ARRENDATARIO') {
    const email = `${quien}-${sufijo}`;
    const { body } = await http()
      .post('/api/v1/users')
      .send({ email, password, rol, nombre: quien, telefono: '70001234' })
      .expect(201);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    user[quien] = { id: body.id, token: login.body.accessToken };
  }

  const reserva = async (
    listingId: string,
    estado: Estado = 'COMPLETADA',
    tenantId = user.t1.id,
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId,
          startAt: new Date('2027-01-10T15:00:00Z'),
          endAt: new Date('2027-01-12T15:00:00Z'),
          status: estado,
          rentalCost: '20.00',
          depositAmount: '5.00',
        },
        select: { id: true },
      })
    ).id;

  const filas = (reservationId: string) =>
    prisma.listingLandlordRating.findMany({ where: { reservationId } });

  const totalFilas = () =>
    prisma.listingLandlordRating.count({
      where: { author: { email: { endsWith: sufijo } } },
    });

  const limpiar = () =>
    prisma.listingLandlordRating.deleteMany({
      where: { author: { email: { endsWith: sufijo } } },
    });

  const publicar = async (landlordId: string, name: string) =>
    (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name,
          location: 'Santa Tecla',
          rateAmount: '10.00',
          rateUnit: 'DIA',
        },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    service = app.get(ListingRatingsService);

    await cuenta('t1', 'ARRENDATARIO');
    await cuenta('t2', 'ARRENDATARIO');
    await cuenta('l1', 'ARRENDADOR');
    await cuenta('l2', 'ARRENDADOR');
    taladro = await publicar(user.l1.id, 'Taladro');
    sierra = await publicar(user.l1.id, 'Sierra');
    compresor = await publicar(user.l2.id, 'Compresor');
  }, 60_000);

  afterAll(async () => {
    await limpiar();
    const usuarios = { email: { endsWith: sufijo } };
    await prisma.reservation.deleteMany({ where: { tenant: usuarios } });
    await prisma.listing.deleteMany({ where: { landlord: usuarios } });
    await prisma.user.deleteMany({ where: usuarios });
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(limpiar);

  it('AC1: califica una reserva COMPLETADA propia y guarda lo de la reserva (R01)', async () => {
    const id = await reserva(taladro);

    const res = await calificar(id, {
      puntajeBien: 4,
      puntajeArrendador: 5,
      comentario: '  Todo en orden  ',
    });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['id']);
    expect(await filas(id)).toMatchObject([
      {
        id: res.body.id,
        authorId: user.t1.id,
        listingId: taladro,
        landlordId: user.l1.id,
        listingScore: 4,
        landlordScore: 5,
        comment: 'Todo en orden',
      },
    ]);
  });

  it('R02 los extremos y el comentario opcional', async () => {
    const a = await reserva(taladro);
    const b = await reserva(taladro);
    const c = await reserva(taladro);

    const ra = await calificar(a, { puntajeBien: 1, puntajeArrendador: 1 });
    const rb = await calificar(b, {
      puntajeBien: 5,
      puntajeArrendador: 5,
      comentario: '   ',
    });
    const rc = await calificar(c, {
      puntajeBien: 3,
      puntajeArrendador: 2,
      comentario: 'a'.repeat(500),
    });

    expect([ra.status, rb.status, rc.status]).toEqual([201, 201, 201]);
    expect((await filas(a))[0].comment).toBeNull();
    expect((await filas(b))[0].comment).toBeNull();
    expect((await filas(c))[0].comment).toHaveLength(500);
  });

  it.each([
    'PENDIENTE',
    'CONFIRMADA',
    'EN_CURSO',
    'RECHAZADA',
    'CANCELADA',
  ] as const)('AC3: la reserva %s da 422 y no guarda nada (R03)', async (estado) => {
    const id = await reserva(taladro, estado);

    const res = await calificar(id);

    expect(res.status).toBe(422);
    expect(res.body.codigo).toBe('RESERVA_NO_COMPLETADA');
    expect(await filas(id)).toHaveLength(0);
  });

  it('AC4: calificar otra vez da 409 y conserva la primera (R04)', async () => {
    const id = await reserva(taladro);
    await calificar(id, { puntajeBien: 5, puntajeArrendador: 4 });

    const res = await calificar(id, { puntajeBien: 1, puntajeArrendador: 1 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      codigo: 'RESERVA_YA_CALIFICADA',
      message: 'Ya calificaste esta reserva.',
    });
    expect(await filas(id)).toMatchObject([
      { listingScore: 5, landlordScore: 4 },
    ]);
  });

  it('R05 cinco envíos a la vez (3 repeticiones): un 201, cuatro 409 y una fila', async () => {
    for (let i = 0; i < 3; i++) {
      const id = await reserva(taladro);

      const res = await Promise.all(
        Array.from({ length: 5 }, () => calificar(id)),
      );

      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      expect(res.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await filas(id)).toHaveLength(1);
    }
  });

  it('AC5: reserva de otro arrendatario, de otro estado e inexistente: el mismo 404 (R06)', async () => {
    const ajena = await reserva(taladro, 'COMPLETADA', user.t2.id);
    const ajenaEnCurso = await reserva(taladro, 'EN_CURSO', user.t2.id);

    const respuestas = [
      await calificar(ajena),
      await calificar(ajenaEnCurso),
      await calificar(randomUUID()),
    ];

    for (const res of respuestas) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(respuestas[2].body);
      expect(res.body).not.toHaveProperty('codigo');
    }
    expect(await totalFilas()).toBe(0);
  });

  it.each([
    ['puntajeBien 0', { puntajeBien: 0, puntajeArrendador: 3 }],
    ['puntajeBien 6', { puntajeBien: 6, puntajeArrendador: 3 }],
    ['puntajeArrendador 0', { puntajeBien: 3, puntajeArrendador: 0 }],
    ['puntajeArrendador 6', { puntajeBien: 3, puntajeArrendador: 6 }],
    ['puntaje decimal', { puntajeBien: 4.5, puntajeArrendador: 3 }],
    ['puntaje como texto', { puntajeBien: '4', puntajeArrendador: 3 }],
    ['puntaje negativo', { puntajeBien: -1, puntajeArrendador: 3 }],
    ['falta un puntaje', { puntajeBien: 3 }],
    ['sin body', {}],
    [
      'comentario de 501 caracteres',
      { puntajeBien: 3, puntajeArrendador: 3, comentario: 'a'.repeat(501) },
    ],
    [
      'comentario que no es texto',
      { puntajeBien: 3, puntajeArrendador: 3, comentario: 7 },
    ],
    [
      'campo extra (arrendadorId)',
      { puntajeBien: 3, puntajeArrendador: 3, arrendadorId: randomUUID() },
    ],
    [
      'campo extra (publicacionId)',
      { puntajeBien: 3, puntajeArrendador: 3, publicacionId: randomUUID() },
    ],
  ])('AC6: %s: 400 con mensaje y sin guardar nada (R07)', async (_caso, body) => {
    const id = await reserva(taladro);

    const res = await calificar(id, body);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toMatch(/\S/);
    expect(await filas(id)).toHaveLength(0);
  });

  it('R08 permisos: los dos arrendadores 403, sin sesión y token falso 401, id inválido 400', async () => {
    const id = await reserva(taladro);

    expect((await calificar(id, undefined, 'l1')).status).toBe(403);
    expect((await calificar(id, undefined, 'l2')).status).toBe(403);
    expect((await calificar(id, undefined, null)).status).toBe(401);
    expect(
      (
        await http()
          .post(`/api/v1/reservas/${id}/calificacion`)
          .set('Authorization', 'Bearer falso')
          .send({ puntajeBien: 4, puntajeArrendador: 4 })
      ).status,
    ).toBe(401);
    expect((await calificar('no-es-uuid')).status).toBe(400);
    expect(await totalFilas()).toBe(0);
  });

  it('R09 el bien y el arrendador salen de la reserva, no del body', async () => {
    const id = await reserva(compresor);

    await calificar(id, { puntajeBien: 2, puntajeArrendador: 3 });

    expect(await filas(id)).toMatchObject([
      { listingId: compresor, landlordId: user.l2.id, authorId: user.t1.id },
    ]);
  });

  it('AC2: el promedio del detalle refleja las calificaciones, con un decimal y null sin ellas (R10)', async () => {
    expect(await service.promedioCalificaciones(taladro)).toEqual({
      promedioBien: null,
      promedioArrendador: null,
    });

    // Taladro: bien 4, 4, 5 -> 4.3. Sierra: bien 2. Arrendador l1: 5, 4, 4, 3 -> 4.
    const t1 = await reserva(taladro);
    const t2 = await reserva(taladro);
    const t3 = await reserva(taladro);
    const s1 = await reserva(sierra);
    await calificar(t1, { puntajeBien: 4, puntajeArrendador: 5 });
    await calificar(t2, { puntajeBien: 4, puntajeArrendador: 4 });
    await calificar(t3, { puntajeBien: 5, puntajeArrendador: 4 });
    await calificar(s1, { puntajeBien: 2, puntajeArrendador: 3 });

    expect(await service.promedioCalificaciones(taladro)).toEqual({
      promedioBien: 4.3,
      promedioArrendador: 4,
    });
    expect(await service.promedioCalificaciones(sierra)).toEqual({
      promedioBien: 2,
      promedioArrendador: 4,
    });
  });

  it('R11 una calificación rechazada no cambia el promedio, y otro arrendador no se mezcla', async () => {
    const buena = await reserva(taladro);
    const otraBuena = await reserva(compresor);
    const invalida = await reserva(taladro);
    await calificar(buena, { puntajeBien: 5, puntajeArrendador: 5 });
    await calificar(otraBuena, { puntajeBien: 1, puntajeArrendador: 1 });
    expect(
      (await calificar(invalida, { puntajeBien: 9, puntajeArrendador: 1 }))
        .status,
    ).toBe(400);
    expect(
      (await calificar(buena, { puntajeBien: 1, puntajeArrendador: 1 })).status,
    ).toBe(409);

    expect(await service.promedioCalificaciones(taladro)).toEqual({
      promedioBien: 5,
      promedioArrendador: 5,
    });
    expect(await service.promedioCalificaciones(compresor)).toEqual({
      promedioBien: 1,
      promedioArrendador: 1,
    });
  });

  it('R12 la base rechaza puntajes fuera de 1 a 5 aunque no pase por la API', async () => {
    const id = await reserva(taladro);
    const base = {
      reservationId: id,
      authorId: user.t1.id,
      listingId: taladro,
      landlordId: user.l1.id,
    };

    for (const [listingScore, landlordScore] of [
      [0, 3],
      [6, 3],
      [3, 0],
      [3, 6],
    ]) {
      await expect(
        prisma.listingLandlordRating.create({
          data: { ...base, listingScore, landlordScore },
        }),
      ).rejects.toThrow();
    }
    expect(await filas(id)).toHaveLength(0);
  });

  it('R13 la base rechaza una segunda calificación de la misma reserva', async () => {
    const id = await reserva(taladro);
    await calificar(id);

    await expect(
      prisma.listingLandlordRating.create({
        data: {
          reservationId: id,
          authorId: user.t1.id,
          listingId: taladro,
          landlordId: user.l1.id,
          listingScore: 1,
          landlordScore: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await filas(id)).toHaveLength(1);
  });
});
