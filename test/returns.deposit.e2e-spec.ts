import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

/**
 * Resolución del depósito de garantía y cierre de la reserva (BE-09.2).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`). Las reservas se crean directo en la base, ya entregadas; la
 * devolución se registra por el endpoint de BE-09.1.
 */
const HOUR = 3_600_000;

describe('resolución de la garantía (BE-09.2)', () => {
  const email = `be-09.2-${randomUUID()}@test.local`;
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
  type FinalState = 'SIN_OBSERVACIONES' | 'CON_OBSERVACIONES' | null;

  const DELIVERED_AT = new Date(Date.now() - 24 * HOUR);

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

  /**
   * Reserva EN_CURSO y entregada, con depósito de $20.00 por defecto. Si
   * `finalState` no es null, registra también la devolución por la API.
   */
  const newReservation = async (
    finalState: FinalState = 'CON_OBSERVACIONES',
    depositAmount = '20.00',
  ) => {
    const reservation = await prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt: new Date(DELIVERED_AT.getTime() - HOUR),
        endAt: new Date(DELIVERED_AT.getTime() + 48 * HOUR),
        status: 'EN_CURSO',
        rentalCost: '30.00',
        depositAmount,
      },
    });
    await prisma.delivery.create({
      data: {
        reservationId: reservation.id,
        deliveredAt: DELIVERED_AT,
        initialConditionNote: 'Completo',
        registeredById: landlord.userId,
      },
    });
    if (finalState) {
      await http()
        .post(`/api/v1/reservas/${reservation.id}/devolucion`)
        .set('Authorization', `Bearer ${landlord.token}`)
        .send({
          fechaReal: new Date(Date.now() - HOUR).toISOString(),
          estadoFinal: finalState,
          ...(finalState === 'CON_OBSERVACIONES'
            ? { danos: 'Rayón lateral' }
            : {}),
        })
        .expect(201);
    }
    return reservation;
  };

  const resolve = (
    reservationId: string,
    body: Record<string, unknown> = {
      montoRetenido: 5.0,
      motivo: 'Daño reportado',
    },
    who: Session | null = landlord,
  ) => {
    const req = http().post(
      `/api/v1/reservas/${reservationId}/deposito/resolucion`,
    );
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    return req.send(body);
  };

  const consult = (reservationId: string, who: Session) =>
    http()
      .get(`/api/v1/reservas/${reservationId}/deposito/resolucion`)
      .set('Authorization', `Bearer ${who.token}`);

  const statusOf = async (id: string) =>
    (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;

  const resolutionsOf = (reservationId: string) =>
    prisma.depositResolution.count({ where: { reservationId } });

  const noticesOf = (reservationId: string) =>
    prisma.notification.findMany({
      where: { referenceType: 'reserva', referenceId: reservationId },
    });

  /** Nada guardado: ni resolución, ni cambio de estado, ni aviso. */
  const expectUntouched = async (reservationId: string) => {
    expect(await resolutionsOf(reservationId)).toBe(0);
    expect(await statusOf(reservationId)).toBe('EN_CURSO');
    expect(await noticesOf(reservationId)).toHaveLength(0);
  };

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
    await prisma.depositResolution.deleteMany({ where: mine });
    await prisma.return.deleteMany({ where: mine });
    await prisma.delivery.deleteMany({ where: mine });
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    // Los avisos se borran en cascada con el usuario.
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('POST /reservas/{id}/deposito/resolucion', () => {
    it('retiene una parte (200): calcula lo liberado, queda RETENIDA y la reserva COMPLETADA', async () => {
      const reservation = await newReservation();

      const { body } = await resolve(reservation.id, {
        montoRetenido: 5.0,
        motivo: '  Daño reportado  ',
      }).expect(200);

      expect(body).toEqual({
        depositoOriginal: 20,
        montoRetenido: 5,
        montoLiberado: 15,
        estadoGarantia: 'RETENIDA',
        motivo: 'Daño reportado',
        estadoReserva: 'COMPLETADA',
        simulado: true,
      });
      expect(await statusOf(reservation.id)).toBe('COMPLETADA');
      const saved = await prisma.depositResolution.findUniqueOrThrow({
        where: { reservationId: reservation.id },
      });
      expect(saved.originalDeposit.toFixed(2)).toBe('20.00');
      expect(saved.retainedAmount.toFixed(2)).toBe('5.00');
      expect(saved.releasedAmount.toFixed(2)).toBe('15.00');
      expect(saved.status).toBe('RETENIDA');
      expect(saved.reason).toBe('Daño reportado');
    });

    it('con una devolución SIN_OBSERVACIONES y retenido 0, la garantía queda LIBERADA completa', async () => {
      const reservation = await newReservation('SIN_OBSERVACIONES');

      const { body } = await resolve(reservation.id, {
        montoRetenido: 0,
      }).expect(200);

      expect(body).toMatchObject({
        depositoOriginal: 20,
        montoRetenido: 0,
        montoLiberado: 20,
        estadoGarantia: 'LIBERADA',
        motivo: null,
        estadoReserva: 'COMPLETADA',
      });
      expect(await statusOf(reservation.id)).toBe('COMPLETADA');
    });

    it('con observaciones también se puede liberar todo (retenido 0)', async () => {
      const reservation = await newReservation('CON_OBSERVACIONES');

      const { body } = await resolve(reservation.id, {
        montoRetenido: 0,
      }).expect(200);

      expect(body.estadoGarantia).toBe('LIBERADA');
    });

    it('calcula a dos decimales exactos y acepta retener el depósito completo', async () => {
      const centavos = await newReservation('CON_OBSERVACIONES', '0.21');
      const a = await resolve(centavos.id, {
        montoRetenido: 0.07,
        motivo: 'Faltante',
      }).expect(200);
      expect(a.body).toMatchObject({
        montoRetenido: 0.07,
        montoLiberado: 0.14,
      });

      const completo = await newReservation();
      const b = await resolve(completo.id, {
        montoRetenido: 20,
        motivo: 'Equipo destruido',
      }).expect(200);
      expect(b.body).toMatchObject({
        montoRetenido: 20,
        montoLiberado: 0,
        estadoGarantia: 'RETENIDA',
      });
    });

    it('sin garantía permite el cierre con ambos importes en 0', async () => {
      const reservation = await newReservation('CON_OBSERVACIONES', '0.00');

      const { body } = await resolve(reservation.id, {
        montoRetenido: 0,
      }).expect(200);

      expect(body).toMatchObject({
        depositoOriginal: 0,
        montoRetenido: 0,
        montoLiberado: 0,
        estadoGarantia: 'LIBERADA',
        estadoReserva: 'COMPLETADA',
      });
    });

    it('avisa al arrendatario con el bien, el monto liberado y el retenido', async () => {
      const reservation = await newReservation();
      await resolve(reservation.id).expect(200);

      const notices = await noticesOf(reservation.id);

      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        userId: tenant.userId,
        sourceModule: 'PAGOS_GARANTIA',
        title: 'Depósito de garantía resuelto',
        message:
          'El depósito de garantía de «Proyector» fue resuelto: monto liberado $15.00, monto retenido $5.00.',
        readAt: null,
      });
      // Y le llega a su bandeja.
      const bandeja = await http()
        .get('/api/v1/notificaciones')
        .set('Authorization', `Bearer ${tenant.token}`)
        .expect(200);
      expect(JSON.stringify(bandeja.body)).toContain(notices[0].id);
    });

    it('rechaza una segunda resolución con 409 y conserva la primera', async () => {
      const reservation = await newReservation();
      await resolve(reservation.id).expect(200);

      await resolve(reservation.id, { montoRetenido: 0 }).expect(409);

      expect(await resolutionsOf(reservation.id)).toBe(1);
      expect(await noticesOf(reservation.id)).toHaveLength(1);
    });

    it('de dos resoluciones simultáneas solo queda una', async () => {
      const reservation = await newReservation();

      const results = await Promise.all([
        resolve(reservation.id),
        resolve(reservation.id),
      ]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      expect(await resolutionsOf(reservation.id)).toBe(1);
    });

    it('responde 422 "Primero registra la devolución" si no hay devolución', async () => {
      const reservation = await newReservation(null);

      const { body } = await resolve(reservation.id).expect(422);

      expect(body).toMatchObject({
        codigo: 'DEVOLUCION_NO_REGISTRADA',
        message: 'Primero registra la devolución',
      });
      await expectUntouched(reservation.id);
    });

    it('responde 422 "El monto retenido no puede superar el depósito"', async () => {
      const reservation = await newReservation();

      const { body } = await resolve(reservation.id, {
        montoRetenido: 20.01,
        motivo: 'Daño',
      }).expect(422);

      expect(body).toMatchObject({
        codigo: 'RETENCION_SUPERA_DEPOSITO',
        message: 'El monto retenido no puede superar el depósito',
      });
      await expectUntouched(reservation.id);
    });

    it('responde 422 al retener con una devolución SIN_OBSERVACIONES', async () => {
      const reservation = await newReservation('SIN_OBSERVACIONES');

      const { body } = await resolve(reservation.id).expect(422);

      expect(body.codigo).toBe('RETENCION_SIN_OBSERVACIONES');
      await expectUntouched(reservation.id);
    });

    it.each([
      ['un importe negativo', { montoRetenido: -1, motivo: 'Daño' }],
      ['un importe con tres decimales', { montoRetenido: 1.005, motivo: 'x' }],
      ['un importe que no es un número', { montoRetenido: '5.00' }],
      ['sin importe', { motivo: 'Daño' }],
      ['una retención sin motivo', { montoRetenido: 5 }],
      ['una retención con motivo vacío', { montoRetenido: 5, motivo: '  ' }],
      [
        'un motivo de 501 caracteres',
        { montoRetenido: 5, motivo: 'a'.repeat(501) },
      ],
      ['un campo de más', { montoRetenido: 0, montoLiberado: 20 }],
    ])('rechaza con 400 %s', async (_, body) => {
      const reservation = await newReservation();

      await resolve(reservation.id, body).expect(400);

      await expectUntouched(reservation.id);
    });

    it('rechaza con 403 a otro arrendador y al arrendatario', async () => {
      const reservation = await newReservation();

      await resolve(reservation.id, undefined, otherLandlord).expect(403);
      await resolve(reservation.id, undefined, tenant).expect(403);

      await expectUntouched(reservation.id);
    });

    it('responde 401 sin sesión y 404 si la reserva no existe', async () => {
      const reservation = await newReservation();

      await resolve(reservation.id, undefined, null).expect(401);
      await resolve(randomUUID()).expect(404);
    });
  });

  describe('GET /reservas/{id}/deposito/resolucion', () => {
    it('antes de resolver, la garantía está PENDIENTE', async () => {
      const reservation = await newReservation();

      const { body } = await consult(reservation.id, tenant).expect(200);

      expect(body).toEqual({
        depositoOriginal: 20,
        montoRetenido: null,
        montoLiberado: null,
        estadoGarantia: 'PENDIENTE',
        motivo: null,
        estadoReserva: 'EN_CURSO',
        simulado: true,
      });
    });

    it('el arrendador y el arrendatario ven la resolución y la reserva COMPLETADA', async () => {
      const reservation = await newReservation();
      const resolved = await resolve(reservation.id).expect(200);

      for (const who of [landlord, tenant]) {
        const { body } = await consult(reservation.id, who).expect(200);
        expect(body).toEqual(resolved.body);
      }
    });

    it('responde 404 a quien no participa', async () => {
      const reservation = await newReservation();

      await consult(reservation.id, stranger).expect(404);
      await consult(reservation.id, otherLandlord).expect(404);
    });
  });
});
