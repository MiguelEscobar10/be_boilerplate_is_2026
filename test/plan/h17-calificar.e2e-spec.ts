import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { createTestPrismaClient } from '../helpers/test-database.js';

/**
 * Plan de pruebas, H17. Calificar el bien y al arrendador: pruebas de
 * componente.
 *
 * Un `it('ACn: ...')` por criterio de aceptación y, al final, los casos
 * negativos. Cada prueba llama a POST /api/v1/reservas/:id/calificacion con el
 * JWT de un login real y revisa lo guardado y, para los promedios, el detalle
 * público de la publicación (GET /api/v1/publicaciones/:id, H12).
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
  const sufijo = `plan-h17-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
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

  const detalle = async (listingId: string) =>
    (await http().get(`/api/v1/publicaciones/${listingId}`).expect(200)).body;

  it('AC1: con la reserva COMPLETADA puedo poner de 1 a 5 al bien y al arrendador por separado, y un comentario opcional de hasta 500 caracteres', async () => {
    const r1 = await reserva(taladro);
    const r2 = await reserva(taladro);
    const r3 = await reserva(taladro);

    await calificar(r1, { puntajeBien: 1, puntajeArrendador: 5 }).expect(201);
    await calificar(r2, {
      puntajeBien: 5,
      puntajeArrendador: 1,
      comentario: 'a'.repeat(500),
    }).expect(201);
    await calificar(r3, {
      puntajeBien: 3,
      puntajeArrendador: 4,
      comentario: 'Buen equipo',
    }).expect(201);

    expect(await filas(r1)).toMatchObject([
      { listingScore: 1, landlordScore: 5, comment: null },
    ]);
    expect((await filas(r2))[0].comment).toHaveLength(500);
    expect((await filas(r3))[0].comment).toBe('Buen equipo');
  });

  it('AC2: al guardarse, los promedios del bien y del arrendador se actualizan en el detalle de la publicación', async () => {
    const antes = await detalle(sierra);
    expect(antes).toMatchObject({
      promedioBien: null,
      promedioArrendador: null,
      totalCalificaciones: 0,
    });

    await calificar(await reserva(sierra), {
      puntajeBien: 4,
      puntajeArrendador: 5,
    }).expect(201);
    await calificar(
      await reserva(sierra, 'COMPLETADA', user.t2.id),
      { puntajeBien: 5, puntajeArrendador: 4 },
      't2',
    ).expect(201);

    expect(await detalle(sierra)).toMatchObject({
      promedioBien: 4.5,
      promedioArrendador: 4.5,
      totalCalificaciones: 2,
    });
  });

  it('AC3: si la reserva todavía no está COMPLETADA, el sistema no deja calificar', async () => {
    for (const estado of [
      'PENDIENTE',
      'CONFIRMADA',
      'EN_CURSO',
      'RECHAZADA',
      'CANCELADA',
    ] as const) {
      const id = await reserva(taladro, estado);

      const res = await calificar(id).expect(422);

      expect(res.body.codigo, estado).toBe('RESERVA_NO_COMPLETADA');
      expect(await filas(id), estado).toHaveLength(0);
    }
  });

  it('AC4: si ya califiqué esa reserva, no me deja otra vez y se avisa que ya fue calificada', async () => {
    const id = await reserva(taladro);
    await calificar(id, { puntajeBien: 4, puntajeArrendador: 4 }).expect(201);

    const res = await calificar(id, {
      puntajeBien: 1,
      puntajeArrendador: 1,
    }).expect(409);

    expect(res.body).toMatchObject({
      codigo: 'RESERVA_YA_CALIFICADA',
      message: 'Ya calificaste esta reserva.',
    });
    expect(await filas(id)).toMatchObject([{ listingScore: 4 }]);
  });

  it('AC5: si la reserva es de otro arrendatario, no me deja calificarla', async () => {
    const id = await reserva(taladro, 'COMPLETADA', user.t2.id);

    const res = await calificar(id, undefined, 't1').expect(404);

    expect(res.body).not.toHaveProperty('codigo');
    expect(await filas(id)).toHaveLength(0);
  });

  it('AC6: si la nota no está entre 1 y 5 o el comentario pasa de 500 caracteres, no se guarda y se indica qué corregir', async () => {
    const id = await reserva(taladro);
    const invalidos = [
      { puntajeBien: 0, puntajeArrendador: 5 },
      { puntajeBien: 6, puntajeArrendador: 5 },
      { puntajeBien: 4, puntajeArrendador: 0 },
      { puntajeBien: 4, puntajeArrendador: 3.5 },
      { puntajeBien: 4 },
      { puntajeBien: 4, puntajeArrendador: 5, comentario: 'a'.repeat(501) },
    ];

    for (const body of invalidos) {
      const res = await calificar(id, body).expect(400);
      expect(res.body.message, JSON.stringify(body)).toBeDefined();
    }
    expect(await filas(id)).toHaveLength(0);
  });

  describe('casos negativos', () => {
    it('NEG1: sin sesión es 401 y un arrendador no puede calificar (403)', async () => {
      const id = await reserva(taladro);

      await calificar(id, undefined, null).expect(401);
      await calificar(id, undefined, 'l1').expect(403);
      expect(await filas(id)).toHaveLength(0);
    });

    it('NEG2: una reserva inexistente da 404', async () => {
      await calificar(randomUUID()).expect(404);
    });

    it('NEG3: una calificación rechazada no cambia el promedio', async () => {
      await calificar(await reserva(compresor), {
        puntajeBien: 2,
        puntajeArrendador: 2,
      }).expect(201);
      const antes = await detalle(compresor);

      await calificar(await reserva(compresor), {
        puntajeBien: 9,
        puntajeArrendador: 9,
      }).expect(400);

      expect(await detalle(compresor)).toMatchObject({
        promedioBien: antes.promedioBien,
        totalCalificaciones: antes.totalCalificaciones,
      });
    });

    it('NEG4: el bien y el arrendador calificados salen de la reserva, no de lo que mande el cliente', async () => {
      const id = await reserva(taladro);

      await calificar(id, {
        puntajeBien: 4,
        puntajeArrendador: 5,
        publicacionId: compresor,
      }).expect(400);

      expect(await filas(id)).toHaveLength(0);
    });
  });
});
