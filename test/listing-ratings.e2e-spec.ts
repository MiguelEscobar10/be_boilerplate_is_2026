import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { ListingRatingsService } from '@ListingRatings';
import type { ReservationStatus, UserRole } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Calificación del bien y del arrendador (BE-17.1) con la app completa contra
 * la base de pruebas (ver test/helpers/test-database.ts).
 *
 * Crea dos arrendatarios y dos arrendadores con email único, firma sus tokens
 * con el JwtService de la app y al final borra solo lo que creó. Las reservas
 * se crean directo en la base con el estado que cada caso necesita.
 */
const prisma = createTestPrismaClient();

interface Cuenta {
  id: string;
  token: string;
}

describe('calificar el bien y al arrendador (BE-17.1)', () => {
  const sufijo = `be-17.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let arrendatario: Cuenta;
  let otroArrendatario: Cuenta;
  let arrendador: Cuenta;
  let otroArrendador: Cuenta;
  let listingId: string;
  let segundoListingId: string;
  let ajenoListingId: string;
  let service: ListingRatingsService;

  const calificar = (
    reservaId: string,
    body: Record<string, unknown> = { puntajeBien: 4, puntajeArrendador: 5 },
    cuenta: Cuenta | null = arrendatario,
  ) => {
    const req = request(app.getHttpServer())
      .post(`/api/v1/reservas/${reservaId}/calificacion`)
      .send(body);
    return cuenta ? req.set('Authorization', `Bearer ${cuenta.token}`) : req;
  };

  const reservar = async (
    status: ReservationStatus = 'COMPLETADA',
    listing = listingId,
    tenantId = arrendatario.id,
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId: listing,
          tenantId,
          startAt: new Date('2026-10-01T15:00:00Z'),
          endAt: new Date('2026-10-01T18:00:00Z'),
          status,
          rentalCost: '10.00',
          depositAmount: '5.00',
        },
        select: { id: true },
      })
    ).id;

  const guardadas = (reservationId: string) =>
    prisma.listingLandlordRating.findMany({ where: { reservationId } });

  const limpiarCalificaciones = () =>
    prisma.listingLandlordRating.deleteMany({
      where: { author: { email: { endsWith: sufijo } } },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Mismas opciones que main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    service = app.get(ListingRatingsService);

    const jwt = app.get(JwtService);
    const crear = async (nombre: string, role: UserRole): Promise<Cuenta> => {
      const email = `${nombre}-${sufijo}`;
      const { id } = await prisma.user.create({
        data: { email, passwordHash: 'no-es-un-hash-real', role },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    arrendatario = await crear('arrendatario', 'ARRENDATARIO');
    otroArrendatario = await crear('otro-arrendatario', 'ARRENDATARIO');
    arrendador = await crear('arrendador', 'ARRENDADOR');
    otroArrendador = await crear('otro-arrendador', 'ARRENDADOR');

    const publicar = async (landlordId: string, name: string) =>
      (
        await prisma.listing.create({
          data: {
            landlordId,
            type: 'EQUIPO',
            name,
            location: 'San Salvador',
            rateAmount: '10.00',
            rateUnit: 'DIA',
          },
          select: { id: true },
        })
      ).id;
    listingId = await publicar(arrendador.id, 'Taladro');
    segundoListingId = await publicar(arrendador.id, 'Sierra');
    ajenoListingId = await publicar(otroArrendador.id, 'Compresor');
  });

  afterAll(async () => {
    const usuarios = { email: { endsWith: sufijo } };
    await limpiarCalificaciones();
    await prisma.reservation.deleteMany({ where: { tenant: usuarios } });
    await prisma.listing.deleteMany({ where: { landlord: usuarios } });
    await prisma.user.deleteMany({ where: usuarios });
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(limpiarCalificaciones);

  describe('POST /reservas/:id/calificacion', () => {
    it('califica una reserva COMPLETADA y guarda los datos de la reserva', async () => {
      const reservaId = await reservar();

      const res = await calificar(reservaId, {
        puntajeBien: 4,
        puntajeArrendador: 5,
        comentario: '  Todo en orden  ',
      });

      expect(res.status).toBe(201);
      expect(Object.keys(res.body)).toEqual(['id']);
      const [fila] = await guardadas(reservaId);
      expect(fila).toMatchObject({
        id: res.body.id,
        authorId: arrendatario.id,
        listingId,
        landlordId: arrendador.id,
        listingScore: 4,
        landlordScore: 5,
        comment: 'Todo en orden',
      });
    });

    it('el comentario es opcional: sin él o vacío se guarda null', async () => {
      const a = await reservar();
      const b = await reservar();

      expect(
        (await calificar(a, { puntajeBien: 1, puntajeArrendador: 1 })).status,
      ).toBe(201);
      expect(
        (
          await calificar(b, {
            puntajeBien: 5,
            puntajeArrendador: 5,
            comentario: '   ',
          })
        ).status,
      ).toBe(201);

      expect((await guardadas(a))[0].comment).toBeNull();
      expect((await guardadas(b))[0].comment).toBeNull();
    });

    it('acepta los extremos: puntajes 1 y 5 y un comentario de 500 caracteres', async () => {
      const reservaId = await reservar();

      const res = await calificar(reservaId, {
        puntajeBien: 1,
        puntajeArrendador: 5,
        comentario: 'a'.repeat(500),
      });

      expect(res.status).toBe(201);
    });

    it.each([
      ['puntajeBien 0', { puntajeBien: 0, puntajeArrendador: 3 }],
      ['puntajeBien 6', { puntajeBien: 6, puntajeArrendador: 3 }],
      ['puntajeArrendador 0', { puntajeBien: 3, puntajeArrendador: 0 }],
      ['puntajeArrendador 6', { puntajeBien: 3, puntajeArrendador: 6 }],
      ['puntaje decimal', { puntajeBien: 4.5, puntajeArrendador: 3 }],
      ['puntaje como texto', { puntajeBien: '4', puntajeArrendador: 3 }],
      ['falta puntajeBien', { puntajeArrendador: 3 }],
      ['falta puntajeArrendador', { puntajeBien: 3 }],
      ['null', { puntajeBien: null, puntajeArrendador: 3 }],
      [
        'comentario de 501 caracteres',
        { puntajeBien: 3, puntajeArrendador: 3, comentario: 'a'.repeat(501) },
      ],
      [
        'comentario que no es texto',
        { puntajeBien: 3, puntajeArrendador: 3, comentario: 7 },
      ],
      [
        'campo extra',
        { puntajeBien: 3, puntajeArrendador: 3, arrendadorId: randomUUID() },
      ],
    ])('400 por %s, sin guardar nada', async (_caso, body) => {
      const reservaId = await reservar();

      const res = await calificar(reservaId, body);

      expect(res.status).toBe(400);
      expect(await guardadas(reservaId)).toHaveLength(0);
    });

    it('un id que no es UUID da 400', async () => {
      expect((await calificar('no-es-uuid')).status).toBe(400);
    });

    it.each([
      'PENDIENTE',
      'CONFIRMADA',
      'RECHAZADA',
      'CANCELADA',
      'EN_CURSO',
    ] as const)('una reserva %s da 422, sin guardar nada', async (status) => {
      const reservaId = await reservar(status);

      const res = await calificar(reservaId);

      expect(res.status).toBe(422);
      expect(res.body.codigo).toBe('RESERVA_NO_COMPLETADA');
      expect(await guardadas(reservaId)).toHaveLength(0);
    });

    it('una reserva ya calificada da 409 y no cambia la primera', async () => {
      const reservaId = await reservar();
      await calificar(reservaId, { puntajeBien: 5, puntajeArrendador: 5 });

      const res = await calificar(reservaId, {
        puntajeBien: 1,
        puntajeArrendador: 1,
      });

      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('RESERVA_YA_CALIFICADA');
      const filas = await guardadas(reservaId);
      expect(filas).toHaveLength(1);
      expect(filas[0].listingScore).toBe(5);
    });

    it('dos envíos simultáneos: uno da 201, el otro 409 y queda una fila', async () => {
      const reservaId = await reservar();

      const [a, b] = await Promise.all([
        calificar(reservaId),
        calificar(reservaId),
      ]);

      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      expect(await guardadas(reservaId)).toHaveLength(1);
    });

    it('una reserva ajena da 404, igual que una inexistente', async () => {
      const reservaId = await reservar();

      const ajena = await calificar(
        reservaId,
        { puntajeBien: 4, puntajeArrendador: 4 },
        otroArrendatario,
      );
      const inexistente = await calificar(randomUUID());

      expect(ajena.status).toBe(404);
      expect(inexistente.status).toBe(404);
      expect(ajena.body).toEqual(inexistente.body);
      expect(await guardadas(reservaId)).toHaveLength(0);
    });

    it('la reserva ajena que no está COMPLETADA también da 404 (no 422)', async () => {
      const reservaId = await reservar('CONFIRMADA');

      const res = await calificar(
        reservaId,
        { puntajeBien: 4, puntajeArrendador: 4 },
        otroArrendatario,
      );

      expect(res.status).toBe(404);
    });

    it('el arrendador no califica por aquí: 403', async () => {
      const reservaId = await reservar();

      const res = await calificar(
        reservaId,
        { puntajeBien: 4, puntajeArrendador: 4 },
        arrendador,
      );

      expect(res.status).toBe(403);
      expect(await guardadas(reservaId)).toHaveLength(0);
    });

    it('sin sesión: 401', async () => {
      const reservaId = await reservar();

      expect(
        (
          await calificar(
            reservaId,
            { puntajeBien: 4, puntajeArrendador: 4 },
            null,
          )
        ).status,
      ).toBe(401);
    });
  });

  describe('GET /reservas/:id/calificacion', () => {
    const consultar = (
      reservaId: string,
      cuenta: Cuenta | null = arrendatario,
    ) => {
      const req = request(app.getHttpServer()).get(
        `/api/v1/reservas/${reservaId}/calificacion`,
      );
      return cuenta ? req.set('Authorization', `Bearer ${cuenta.token}`) : req;
    };

    it('devuelve la calificación que dejó el arrendatario', async () => {
      const reservaId = await reservar();
      const creada = await calificar(reservaId, {
        puntajeBien: 4,
        puntajeArrendador: 5,
        comentario: 'Todo en orden',
      });

      const res = await consultar(reservaId);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: creada.body.id,
        reservaId,
        puntajeBien: 4,
        puntajeArrendador: 5,
        comentario: 'Todo en orden',
      });
      expect(new Date(res.body.fechaRegistro).getTime()).not.toBeNaN();
    });

    it('reserva propia sin calificar: 404 con CALIFICACION_NO_REGISTRADA', async () => {
      const res = await consultar(await reservar());

      expect(res.status).toBe(404);
      expect(res.body.codigo).toBe('CALIFICACION_NO_REGISTRADA');
    });

    it('reserva ajena (calificada o no) igual que una inexistente', async () => {
      const calificada = await reservar();
      await calificar(calificada);
      const sinCalificar = await reservar();

      const respuestas = [
        await consultar(calificada, otroArrendatario),
        await consultar(sinCalificar, otroArrendatario),
        await consultar(randomUUID(), otroArrendatario),
      ];

      for (const res of respuestas) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(respuestas[2].body);
        expect(res.body).not.toHaveProperty('codigo');
      }
    });

    it('arrendador 403, sin sesión 401, id inválido 400', async () => {
      const reservaId = await reservar();

      expect((await consultar(reservaId, arrendador)).status).toBe(403);
      expect((await consultar(reservaId, null)).status).toBe(401);
      expect((await consultar('no-es-uuid')).status).toBe(400);
    });
  });

  describe('promedioCalificaciones', () => {
    it('sin calificaciones devuelve null en los dos', async () => {
      expect(await service.promedioCalificaciones(listingId)).toEqual({
        promedioBien: null,
        promedioArrendador: null,
      });
    });

    it('promedia el bien por publicación y el arrendador por arrendador, con un decimal', async () => {
      // Taladro: bien 4, 4, 5 -> 4.3; Sierra: bien 2 -> 2.0.
      // Arrendador (las dos publicaciones): 5, 4, 4, 3 -> 4.0.
      const r1 = await reservar();
      const r2 = await reservar();
      const r3 = await reservar();
      const r4 = await reservar('COMPLETADA', segundoListingId);
      await calificar(r1, { puntajeBien: 4, puntajeArrendador: 5 });
      await calificar(r2, { puntajeBien: 4, puntajeArrendador: 4 });
      await calificar(r3, { puntajeBien: 5, puntajeArrendador: 4 });
      await calificar(r4, { puntajeBien: 2, puntajeArrendador: 3 });

      expect(await service.promedioCalificaciones(listingId)).toEqual({
        promedioBien: 4.3,
        promedioArrendador: 4,
      });
      expect(await service.promedioCalificaciones(segundoListingId)).toEqual({
        promedioBien: 2,
        promedioArrendador: 4,
      });
    });

    it('no mezcla las calificaciones de otro arrendador', async () => {
      const mia = await reservar();
      const ajena = await reservar('COMPLETADA', ajenoListingId);
      await calificar(mia, { puntajeBien: 5, puntajeArrendador: 5 });
      await calificar(ajena, { puntajeBien: 1, puntajeArrendador: 1 });

      expect(await service.promedioCalificaciones(listingId)).toEqual({
        promedioBien: 5,
        promedioArrendador: 5,
      });
      expect(await service.promedioCalificaciones(ajenoListingId)).toEqual({
        promedioBien: 1,
        promedioArrendador: 1,
      });
    });

    it('redondea a un decimal hacia arriba en .05 (4.25 -> 4.3, 2.75 -> 2.8)', async () => {
      const ids = [
        await reservar(),
        await reservar(),
        await reservar(),
        await reservar(),
      ];
      // Bien 4, 4, 4, 5 -> 4.25; arrendador 3, 3, 3, 2 -> 2.75.
      const puntajes = [
        [4, 3],
        [4, 3],
        [4, 3],
        [5, 2],
      ];
      for (const [i, [bien, arr]] of puntajes.entries()) {
        await calificar(ids[i], { puntajeBien: bien, puntajeArrendador: arr });
      }

      expect(await service.promedioCalificaciones(listingId)).toEqual({
        promedioBien: 4.3,
        promedioArrendador: 2.8,
      });
    });

    it('una publicación que no existe devuelve null en los dos', async () => {
      expect(await service.promedioCalificaciones(randomUUID())).toEqual({
        promedioBien: null,
        promedioArrendador: null,
      });
    });
  });
});
