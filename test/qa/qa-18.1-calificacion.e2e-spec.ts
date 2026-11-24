import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-18.1 (MP4-96): pruebas de la calificación del arrendatario (H18).
 *
 * Cada caso tiene un id (R01, R02...) que se repite en la evidencia de
 * docs/qa/QA-18.1-calificacion.md. Además de la respuesta HTTP, cada caso
 * revisa lo guardado en `tenant_ratings` y la marca `arrendatarioCalificado`
 * de "Mis solicitudes".
 *
 * Las reservas se crean directo en la base en el estado que pide cada caso:
 * así cada caso prueba un estado sin pasar por la entrega y la devolución
 * (BE-08.1 y BE-09.2).
 */

type Session = { token: string; userId: string };
type Status =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'EN_CURSO'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'COMPLETADA';

describe('H18. Calificar al arrendatario', () => {
  const email = `qa-18.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let accounts = 0;
  let nextDay = 0;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, who: Session | null) =>
    who ? req.set('Authorization', `Bearer ${who.token}`) : req;

  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `${rol.toLowerCase()}${++accounts}-${email}`;
    await http()
      .post('/api/v1/users')
      .send({
        email: address,
        password,
        rol,
        nombre: `Persona ${accounts}`,
        telefono: '70001234',
      })
      .expect(201);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken as string, userId: user.id };
  };

  const listingOf = async (owner: Session) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.userId,
          type: 'EQUIPO',
          name: 'Taladro',
          location: 'Soyapango',
          rateAmount: '10.00',
          rateUnit: 'DIA',
        },
      })
    ).id;

  const reservation = async (
    status: Status = 'COMPLETADA',
    owner = landlord,
  ) => {
    const start = new Date(Date.UTC(2026, 9, 1 + nextDay++, 15));
    return prisma.reservation.create({
      data: {
        listingId: await listingOf(owner),
        tenantId: tenant.userId,
        startAt: start,
        endAt: new Date(start.getTime() + 3 * 3_600_000),
        status,
        rentalCost: '30.00',
        depositAmount: '10.00',
      },
    });
  };

  const rate = (
    id: string,
    body: Record<string, unknown>,
    who: Session | null = landlord,
  ) =>
    auth(
      http()
        .post(`/api/v1/reservas/${id}/calificacion-arrendatario`)
        .send(body),
      who,
    );

  const ratingsOf = (reservationId: string) =>
    prisma.tenantRating.findMany({ where: { reservationId } });

  const flagOf = async (reservationId: string) => {
    const res = await auth(
      http()
        .get('/api/v1/arrendador/solicitudes')
        .query({ estado: 'COMPLETADA', limit: '50' }),
      landlord,
    ).expect(200);
    return res.body.items.find((i: { id: string }) => i.id === reservationId)
      ?.arrendatarioCalificado as boolean | undefined;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
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

    landlord = await account('ARRENDADOR');
    otherLandlord = await account('ARRENDADOR');
    tenant = await account('ARRENDATARIO');
  });

  afterAll(async () => {
    await prisma.tenantRating.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('calificar una reserva COMPLETADA propia (AC1)', () => {
    it('AC1: de 1 a 5 con comentario: 201, se guarda con autor y arrendatario de la reserva, y la solicitud queda marcada (R01)', async () => {
      const r = await reservation();
      expect(await flagOf(r.id)).toBe(false);

      const res = await rate(r.id, {
        puntaje: 4,
        comentario: '  Devolvió todo limpio  ',
      }).expect(201);

      expect(res.body).toEqual({ id: expect.any(String) });
      expect(await ratingsOf(r.id)).toEqual([
        expect.objectContaining({
          id: res.body.id,
          authorId: landlord.userId,
          tenantId: tenant.userId,
          score: 4,
          comment: 'Devolvió todo limpio',
        }),
      ]);
      expect(await flagOf(r.id)).toBe(true);
    });

    it('AC1: los extremos 1 y 5 se aceptan, el comentario es opcional (sin él o en blanco queda vacío) y acepta 500 caracteres (R02)', async () => {
      const casos = [
        { puntaje: 1 },
        { puntaje: 5, comentario: '   ' },
        { puntaje: 3, comentario: 'ñ'.repeat(500) },
      ];
      const esperado = [
        [1, null],
        [5, null],
        [3, 'ñ'.repeat(500)],
      ];
      for (const [i, body] of casos.entries()) {
        const r = await reservation();
        await rate(r.id, body).expect(201);
        const [saved] = await ratingsOf(r.id);
        expect([saved.score, saved.comment]).toEqual(esperado[i]);
      }
    });

    it('AC1: el body no deja elegir a quién se califica: un arrendatarioId de más es 400 (R03)', async () => {
      const r = await reservation();
      await rate(r.id, { puntaje: 5, arrendatarioId: landlord.userId }).expect(
        400,
      );
      expect(await ratingsOf(r.id)).toHaveLength(0);
    });
  });

  describe('la reserva no está COMPLETADA (AC2)', () => {
    it('AC2: PENDIENTE, CONFIRMADA, EN_CURSO, RECHAZADA y CANCELADA: 422 RESERVA_NO_COMPLETADA y no se guarda nada (R04)', async () => {
      for (const status of [
        'PENDIENTE',
        'CONFIRMADA',
        'EN_CURSO',
        'RECHAZADA',
        'CANCELADA',
      ] as const) {
        const r = await reservation(status);
        const res = await rate(r.id, { puntaje: 5 }).expect(422);
        expect(res.body).toMatchObject({
          codigo: 'RESERVA_NO_COMPLETADA',
          message:
            'Solo puedes calificar al arrendatario de una reserva COMPLETADA.',
        });
        expect(await ratingsOf(r.id)).toHaveLength(0);
      }
    });
  });

  describe('una sola vez (AC3)', () => {
    it('AC3: calificar otra vez: 409 «Esta reserva ya fue calificada.» y se conserva la primera (R05)', async () => {
      const r = await reservation();
      await rate(r.id, { puntaje: 2, comentario: 'Llegó tarde' }).expect(201);

      const res = await rate(r.id, {
        puntaje: 5,
        comentario: 'Cambié de opinión',
      }).expect(409);

      expect(res.body).toMatchObject({
        codigo: 'RESERVA_YA_CALIFICADA',
        message: 'Esta reserva ya fue calificada.',
      });
      const guardadas = await ratingsOf(r.id);
      expect(guardadas.map((g) => [g.score, g.comment])).toEqual([
        [2, 'Llegó tarde'],
      ]);
    });

    it('AC3: cinco envíos a la vez (doble clic, pestañas): uno 201, cuatro 409 y una sola fila (5 repeticiones) (R06)', async () => {
      for (let vuelta = 0; vuelta < 5; vuelta++) {
        const r = await reservation();
        const respuestas = await Promise.all(
          Array.from({ length: 5 }, (_, i) => rate(r.id, { puntaje: i + 1 })),
        );
        expect(respuestas.map((x) => x.status).sort((a, b) => a - b)).toEqual([
          201, 409, 409, 409, 409,
        ]);
        expect(await ratingsOf(r.id)).toHaveLength(1);
      }
    });
  });

  describe('reserva de un bien de otro arrendador (AC4)', () => {
    it('AC4: 404 «La reserva no existe.», igual que una inexistente, aunque no esté COMPLETADA (R07)', async () => {
      const completada = await reservation('COMPLETADA', otherLandlord);
      const enCurso = await reservation('EN_CURSO', otherLandlord);

      for (const id of [completada.id, enCurso.id, randomUUID()]) {
        const res = await rate(id, { puntaje: 5 }).expect(404);
        expect(res.body.message).toBe('La reserva no existe.');
      }
      expect(await ratingsOf(completada.id)).toHaveLength(0);
    });
  });

  describe('valores inválidos (AC5)', () => {
    it('AC5: puntaje 0, 6, 4.5, "5" o sin puntaje; comentario de 501 o que no es texto: 400 con qué corregir y no se guarda nada (R08)', async () => {
      const r = await reservation();
      const malos: [Record<string, unknown>, RegExp][] = [
        [{ puntaje: 0 }, /puntaje/i],
        [{ puntaje: 6 }, /puntaje/i],
        [{ puntaje: 4.5 }, /puntaje/i],
        [{ puntaje: '5' }, /puntaje/i],
        [{}, /puntaje/i],
        [{ puntaje: 5, comentario: 'c'.repeat(501) }, /comentario/i],
        [{ puntaje: 5, comentario: 123 }, /comentario/i],
      ];
      for (const [body, campo] of malos) {
        const res = await rate(r.id, body).expect(400);
        expect(JSON.stringify(res.body.message)).toMatch(campo);
      }
      expect(await ratingsOf(r.id)).toHaveLength(0);
      expect(await flagOf(r.id)).toBe(false);
    });
  });

  describe('casos negativos: permisos por rol', () => {
    it('R09: el arrendatario no puede usar la función (403) y sin sesión es 401; no se guarda nada', async () => {
      const r = await reservation();
      await rate(r.id, { puntaje: 1 }, tenant).expect(403);
      await rate(r.id, { puntaje: 1 }, null).expect(401);
      await rate('no-es-uuid', { puntaje: 1 }).expect(400);
      expect(await ratingsOf(r.id)).toHaveLength(0);
    });
  });
});
