import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { PASARELA_CONFIG, type PasarelaConfig } from '@Payments/services';
import { createTestPrismaClient } from '../helpers/test-database.js';

/**
 * QA-06.1 (MP4-71): consulta de pagos propios, recientes y ausentes (H06).
 *
 * Los ids (C01 a C11) se repiten en docs/qa/QA-06.1-ultimo-pago.md. Los pagos
 * se crean con el endpoint real (POST /reservas/:id/pagos/simulados) y se
 * consultan con GET /reservas/:id/pagos/ultimo, con el JWT de un login real.
 *
 * - La espera de la pasarela se reemplaza (0 ms).
 * - Las reservas, y los pagos de C07, C08 y C10, se crean directo en la base.
 * - El REVISOR solo lo crea el seed: aquí se firma su token con el JwtService.
 *
 * Corre contra la base `_test` (test/helpers/test-database.ts). Los correos
 * llevan un sufijo único por ejecución y en afterAll se borra solo lo creado.
 */
const prisma = createTestPrismaClient();
const pasarela: PasarelaConfig = { retardoMs: 0 };

type Quien = 't1' | 't2' | 'l' | 'inactivo' | 'revisor';
type EstadoReserva =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'EN_CURSO'
  | 'COMPLETADA';

const APRUEBA = '4242424242424242';
const RECHAZA = '4000000000000002';

describe('H06. Consultar el estado de un pago', () => {
  const sufijo = `qa-06.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let listingId: string;
  const user = {} as Record<Quien, { id: string; token: string }>;

  const http = () => request(app.getHttpServer());

  const ultimo = (reservaId: string, token: string | null = user.t1.token) => {
    const req = http().get(`/api/v1/reservas/${reservaId}/pagos/ultimo`);
    if (token) void req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  const pagar = (reservaId: string, numeroTarjeta: string) =>
    http()
      .post(`/api/v1/reservas/${reservaId}/pagos/simulados`)
      .set('Authorization', `Bearer ${user.t1.token}`)
      .send({ numeroTarjeta, vencimiento: '12/28', cvv: '123' })
      .expect(201);

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
    cambios: { status?: EstadoReserva; tenantId?: string } = {},
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId: cambios.tenantId ?? user.t1.id,
          startAt: new Date('2027-01-10T15:00:00Z'),
          endAt: new Date('2027-01-12T15:00:00Z'),
          status: cambios.status ?? 'CONFIRMADA',
          rentalCost: '18.75',
          depositAmount: '6.25',
        },
        select: { id: true },
      })
    ).id;

  const pagoEnBase = (
    reservationId: string,
    attemptNumber: number,
    createdAt: Date,
    status: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' = 'RECHAZADO',
    id?: string,
  ) =>
    prisma.simulatedPayment.create({
      data: {
        ...(id ? { id } : {}),
        reservationId,
        totalAmount: '25.00',
        rentalCost: '18.75',
        depositAmount: '6.25',
        status,
        cardLast4: '4242',
        rejectionReason: status === 'RECHAZADO' ? 'Sin fondos' : null,
        attemptNumber,
        createdAt,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PASARELA_CONFIG)
      .useValue(pasarela)
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
    await cuenta('l', 'ARRENDADOR');
    await cuenta('inactivo', 'ARRENDATARIO');

    const emailRevisor = `revisor-${sufijo}`;
    const revisor = await prisma.user.create({
      data: {
        email: emailRevisor,
        passwordHash: 'no-es-un-hash-real',
        role: 'REVISOR',
      },
    });
    user.revisor = {
      id: revisor.id,
      token: await app
        .get(JwtService)
        .signAsync({ sub: revisor.id, email: emailRevisor }),
    };

    ({ id: listingId } = await prisma.listing.create({
      data: {
        landlordId: user.l.id,
        type: 'EQUIPO',
        name: 'Mezcladora de concreto',
        location: 'Santa Tecla',
        rateAmount: '18.75',
        rateUnit: 'DIA',
      },
      select: { id: true },
    }));
  }, 60_000);

  afterAll(async () => {
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { listingId } },
    });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: sufijo } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('AC1: pago aprobado propio: 200 con la forma exacta (C01)', async () => {
    const reservaId = await reserva();
    const pagado = await pagar(reservaId, APRUEBA);

    const res = await ultimo(reservaId);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'estado',
        'fechaRegistro',
        'montoTotal',
        'pagoId',
        'reservaId',
        'simulado',
      ].sort(),
    );
    expect(res.body).toMatchObject({
      pagoId: pagado.body.pagoId,
      reservaId,
      montoTotal: '25.00',
      estado: 'APROBADO',
      simulado: true,
    });
    const fila = await prisma.simulatedPayment.findUniqueOrThrow({
      where: { id: pagado.body.pagoId },
    });
    expect(res.body.fechaRegistro).toBe(fila.createdAt.toISOString());
  });

  it('AC2: varios intentos: cada consulta muestra el más reciente (C02)', async () => {
    const reservaId = await reserva();
    const vistos: string[] = [];

    for (const tarjeta of [RECHAZA, RECHAZA, APRUEBA]) {
      const pagado = await pagar(reservaId, tarjeta);
      const res = await ultimo(reservaId);
      expect(res.status).toBe(200);
      expect(res.body.pagoId).toBe(pagado.body.pagoId);
      vistos.push(res.body.estado);
    }

    expect(vistos).toEqual(['RECHAZADO', 'RECHAZADO', 'APROBADO']);
  });

  it('C03 un rechazo trae el motivo y el aprobado no', async () => {
    const reservaId = await reserva();
    await pagar(reservaId, RECHAZA);
    const rechazado = await ultimo(reservaId);
    await pagar(reservaId, APRUEBA);
    const aprobado = await ultimo(reservaId);

    expect(rechazado.body).toMatchObject({
      estado: 'RECHAZADO',
      motivo: 'Tarjeta rechazada por la pasarela de prueba',
    });
    expect(aprobado.body).not.toHaveProperty('motivo');
  });

  it('AC3: reserva propia sin pagos: 404 PAGO_NO_REGISTRADO (C04)', async () => {
    const res = await ultimo(await reserva());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      statusCode: 404,
      message: 'Aún no hay un pago registrado para esta reserva.',
      error: 'Not Found',
      codigo: 'PAGO_NO_REGISTRADO',
    });
  });

  it('AC4: reserva ajena (con y sin pago) igual que una inexistente (C05)', async () => {
    const conPago = await reserva();
    await pagar(conPago, APRUEBA);
    const sinPago = await reserva();

    const respuestas = [
      await ultimo(conPago, user.t2.token),
      await ultimo(sinPago, user.t2.token),
      await ultimo(randomUUID(), user.t2.token),
    ];

    for (const res of respuestas) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(respuestas[2].body);
      expect(res.body).not.toHaveProperty('codigo');
    }
    const texto = JSON.stringify(respuestas.map((r) => r.body));
    expect(texto).not.toMatch(/25\.00|APROBADO|RECHAZADO|PAGO_NO_REGISTRADO/);
  });

  it('C06 accesos: arrendador y revisor 403; sin token, token inválido e inactivo 401; id inválido 400', async () => {
    const reservaId = await reserva();
    await pagar(reservaId, APRUEBA);

    expect((await ultimo(reservaId, user.l.token)).status).toBe(403);
    expect((await ultimo(reservaId, user.revisor.token)).status).toBe(403);
    expect((await ultimo(reservaId, null)).status).toBe(401);
    expect((await ultimo(reservaId, 'token-falso')).status).toBe(401);
    expect((await ultimo('no-es-uuid')).status).toBe(400);

    await prisma.user.update({
      where: { id: user.inactivo.id },
      data: { isActive: false },
    });
    const propia = await reserva({ tenantId: user.inactivo.id });
    expect((await ultimo(propia, user.inactivo.token)).status).toBe(401);
  });

  it.each([
    'PENDIENTE',
    'RECHAZADA',
    'CANCELADA',
    'EN_CURSO',
    'COMPLETADA',
  ] as const)(
    'C07 reserva %s sin pagos: PAGO_NO_REGISTRADO (el estado de la reserva no cambia la respuesta)',
    async (status) => {
      const res = await ultimo(await reserva({ status }));

      expect(res.status).toBe(404);
      expect(res.body.codigo).toBe('PAGO_NO_REGISTRADO');
    },
  );

  it('C08 sin caché: un pago insertado en la base se ve en la consulta siguiente', async () => {
    const reservaId = await reserva();
    expect((await ultimo(reservaId)).status).toBe(404);

    const primero = await pagoEnBase(
      reservaId,
      1,
      new Date('2027-01-01T10:00:00Z'),
    );
    expect((await ultimo(reservaId)).body.pagoId).toBe(primero.id);

    const segundo = await pagoEnBase(
      reservaId,
      2,
      new Date('2027-01-01T10:05:00Z'),
      'APROBADO',
    );
    expect((await ultimo(reservaId)).body).toMatchObject({
      pagoId: segundo.id,
      estado: 'APROBADO',
    });
  });

  it('C09 consultar no crea pagos ni avisos', async () => {
    const reservaId = await reserva();
    await pagar(reservaId, APRUEBA);
    const antes = {
      pagos: await prisma.simulatedPayment.count({
        where: { reservation: { listingId } },
      }),
      avisos: await prisma.notification.count({
        where: { userId: { in: [user.t1.id, user.l.id] } },
      }),
    };

    for (let i = 0; i < 3; i++) await ultimo(reservaId);
    await ultimo(await reserva());

    expect(
      await prisma.simulatedPayment.count({
        where: { reservation: { listingId } },
      }),
    ).toBe(antes.pagos);
    expect(
      await prisma.notification.count({
        where: { userId: { in: [user.t1.id, user.l.id] } },
      }),
    ).toBe(antes.avisos);
  });

  it('C10 empate de created_at: gana el id mayor; un PENDIENTE se muestra como tal', async () => {
    const reservaId = await reserva();
    const mismaHora = new Date('2027-01-01T10:00:00Z');
    await pagoEnBase(
      reservaId,
      1,
      mismaHora,
      'RECHAZADO',
      '00000000-0000-4000-8000-000000000001',
    );
    await pagoEnBase(
      reservaId,
      2,
      mismaHora,
      'PENDIENTE',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    );

    const res = await ultimo(reservaId);

    expect(res.body).toMatchObject({
      pagoId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      estado: 'PENDIENTE',
    });
  });

  it('C11 la respuesta no expone datos de la tarjeta ni del desglose', async () => {
    const reservaId = await reserva();
    await pagar(reservaId, APRUEBA);

    const res = await ultimo(reservaId);

    expect(JSON.stringify(res.body)).not.toMatch(
      /4242|cvv|cardLast4|tarjeta|rentalCost|depositAmount|18\.75|6\.25/i,
    );
  });
});
