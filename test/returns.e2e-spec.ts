import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

/**
 * Registro de la devolución (BE-09.1).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`). Las reservas se crean directo en la base, ya entregadas
 * (EN_CURSO con su fila en `deliveries`) o en el estado que el caso necesita.
 */
const HOUR = 3_600_000;

describe('devoluciones (BE-09.1)', () => {
  const email = `be-09.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let stranger: Session;
  let listingId: string;
  let accounts = 0;

  type Session = { token: string; userId: string };
  type Status = 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'COMPLETADA';

  const DELIVERED_AT = new Date(Date.now() - 24 * HOUR);
  const afterDelivery = () => new Date(Date.now() - HOUR).toISOString();

  const http = () => request(app.getHttpServer());

  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `${rol === 'ARRENDADOR' ? 'dueno' : 'inquilino'}${++accounts}-${email}`;
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

  /** Reserva del bien del arrendador; EN_CURSO y entregada por defecto. */
  const newReservation = async (status: Status = 'EN_CURSO') => {
    const reservation = await prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt: new Date(DELIVERED_AT.getTime() - HOUR),
        endAt: new Date(DELIVERED_AT.getTime() + 48 * HOUR),
        status,
        rentalCost: '30.00',
        depositAmount: '20.00',
      },
    });
    if (status === 'EN_CURSO' || status === 'COMPLETADA') {
      await prisma.delivery.create({
        data: {
          reservationId: reservation.id,
          deliveredAt: DELIVERED_AT,
          initialConditionNote: 'Completo',
          registeredById: landlord.userId,
        },
      });
    }
    return reservation;
  };

  const giveBack = (
    reservationId: string,
    who: Session | null = landlord,
    body: Record<string, unknown> = {},
  ) => {
    const req = http().post(`/api/v1/reservas/${reservationId}/devolucion`);
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    return req.send({
      fechaReal: afterDelivery(),
      estadoFinal: 'CON_OBSERVACIONES',
      danos: 'Rayón lateral',
      ...body,
    });
  };

  const consult = (reservationId: string, who: Session) =>
    http()
      .get(`/api/v1/reservas/${reservationId}/devolucion`)
      .set('Authorization', `Bearer ${who.token}`);

  const returnsOf = (reservationId: string) =>
    prisma.return.count({ where: { reservationId } });

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

    landlord = await account('ARRENDADOR');
    otherLandlord = await account('ARRENDADOR');
    tenant = await account('ARRENDATARIO');
    stranger = await account('ARRENDATARIO');
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'EQUIPO',
          name: 'Proyector',
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'DIA',
        },
      })
    ).id;
  });

  afterAll(async () => {
    const mine = { reservation: { tenant: { email: { endsWith: email } } } };
    await prisma.return.deleteMany({ where: mine });
    await prisma.delivery.deleteMany({ where: mine });
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('POST /reservas/{id}/devolucion', () => {
    it('registra la devolución con observaciones (201) y la reserva sigue EN_CURSO', async () => {
      const reservation = await newReservation();
      const fechaReal = afterDelivery();

      const { body } = await giveBack(reservation.id, landlord, {
        fechaReal,
        danos: '  Rayón lateral  ',
      }).expect(201);

      expect(body).toEqual({
        devolucionId: expect.any(String),
        reservaId: reservation.id,
        devolucionRegistrada: true,
      });
      const saved = await prisma.return.findUniqueOrThrow({
        where: { reservationId: reservation.id },
      });
      expect(saved.id).toBe(body.devolucionId);
      expect(saved.returnedAt.toISOString()).toBe(fechaReal);
      expect(saved.finalState).toBe('CON_OBSERVACIONES');
      expect(saved.damages).toBe('Rayón lateral');
      expect(saved.registeredById).toBe(landlord.userId);
      // La reserva se completa al resolver la garantía (BE-09.2).
      const after = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });
      expect(after.status).toBe('EN_CURSO');
    });

    it('registra una devolución SIN_OBSERVACIONES sin daños', async () => {
      const reservation = await newReservation();

      await giveBack(reservation.id, landlord, {
        estadoFinal: 'SIN_OBSERVACIONES',
        danos: undefined,
      }).expect(201);

      const saved = await prisma.return.findUniqueOrThrow({
        where: { reservationId: reservation.id },
      });
      expect(saved.finalState).toBe('SIN_OBSERVACIONES');
      expect(saved.damages).toBeNull();
    });

    it('acepta la fecha con zona horaria y la guarda en UTC', async () => {
      const reservation = await newReservation();
      const local = new Date(Date.now() - 2 * HOUR);
      // La misma hora escrita como -06:00.
      const fechaReal = new Date(local.getTime() - 6 * HOUR)
        .toISOString()
        .replace('Z', '-06:00');

      await giveBack(reservation.id, landlord, { fechaReal }).expect(201);

      const saved = await prisma.return.findUniqueOrThrow({
        where: { reservationId: reservation.id },
      });
      expect(saved.returnedAt.toISOString()).toBe(local.toISOString());
    });

    it('rechaza una segunda devolución con 409 y conserva la primera', async () => {
      const reservation = await newReservation();
      await giveBack(reservation.id).expect(201);

      await giveBack(reservation.id, landlord, {
        estadoFinal: 'SIN_OBSERVACIONES',
        danos: undefined,
      }).expect(409);

      expect(await returnsOf(reservation.id)).toBe(1);
    });

    it('de dos devoluciones simultáneas solo queda una', async () => {
      const reservation = await newReservation();

      const results = await Promise.all([
        giveBack(reservation.id),
        giveBack(reservation.id),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await returnsOf(reservation.id)).toBe(1);
    });

    it.each(['PENDIENTE', 'CONFIRMADA'] as const)(
      'impide registrar la devolución de una reserva %s, sin entrega (409)',
      async (status) => {
        const reservation = await newReservation(status);

        await giveBack(reservation.id).expect(409);

        expect(await returnsOf(reservation.id)).toBe(0);
      },
    );

    it('impide registrar la devolución de una reserva COMPLETADA (409)', async () => {
      const reservation = await newReservation('COMPLETADA');
      await giveBack(reservation.id).expect(409);
    });

    it('rechaza con 400 una fecha real anterior a la entrega', async () => {
      const reservation = await newReservation();

      const { body } = await giveBack(reservation.id, landlord, {
        fechaReal: new Date(DELIVERED_AT.getTime() - 1000).toISOString(),
      }).expect(400);

      expect(body.message).toMatch(/anterior a la entrega/);
      expect(await returnsOf(reservation.id)).toBe(0);
    });

    it.each([
      ['sin fecha real', { fechaReal: undefined }],
      ['con una fecha que no es ISO 8601', { fechaReal: '12/11/2026' }],
      ['sin estado final', { estadoFinal: undefined }],
      ['con un estado final fuera del catálogo', { estadoFinal: 'ROTO' }],
      ['CON_OBSERVACIONES sin daños', { danos: undefined }],
      ['CON_OBSERVACIONES con daños de solo espacios', { danos: '   ' }],
      ['con daños de 501 caracteres', { danos: 'a'.repeat(501) }],
      [
        'SIN_OBSERVACIONES con daños',
        { estadoFinal: 'SIN_OBSERVACIONES', danos: 'Rayón' },
      ],
      ['con un campo de más', { fotos: [] }],
    ])('rechaza con 400 %s', async (_, body) => {
      const reservation = await newReservation();

      await giveBack(reservation.id, landlord, body).expect(400);

      expect(await returnsOf(reservation.id)).toBe(0);
    });

    it('rechaza con 403 a otro arrendador y al arrendatario', async () => {
      const reservation = await newReservation();

      await giveBack(reservation.id, otherLandlord).expect(403);
      await giveBack(reservation.id, tenant).expect(403);

      expect(await returnsOf(reservation.id)).toBe(0);
    });

    it('responde 401 sin sesión y 404 si la reserva no existe', async () => {
      const reservation = await newReservation();

      await giveBack(reservation.id, null).expect(401);
      await giveBack(randomUUID()).expect(404);
    });
  });

  describe('GET /reservas/{id}/devolucion', () => {
    it('el arrendador y el arrendatario consultan las observaciones', async () => {
      const reservation = await newReservation();
      const fechaReal = afterDelivery();
      const created = await giveBack(reservation.id, landlord, {
        fechaReal,
      }).expect(201);

      for (const who of [landlord, tenant]) {
        const { body } = await consult(reservation.id, who).expect(200);
        expect(body).toEqual({
          devolucionId: created.body.devolucionId,
          reservaId: reservation.id,
          fechaReal,
          estadoFinal: 'CON_OBSERVACIONES',
          danos: 'Rayón lateral',
        });
      }
    });

    it('responde 404 a quien no participa y si todavía no hay devolución', async () => {
      const returned = await newReservation();
      await giveBack(returned.id).expect(201);
      await consult(returned.id, stranger).expect(404);
      await consult(returned.id, otherLandlord).expect(404);

      const pending = await newReservation();
      await consult(pending.id, landlord).expect(404);
    });
  });
});
