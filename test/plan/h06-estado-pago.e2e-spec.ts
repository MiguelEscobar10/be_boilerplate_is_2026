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
 * Plan de pruebas, H06. Consultar el estado de un pago: pruebas de componente.
 *
 * Un `it('ACn: ...')` por criterio de aceptación y, al final, los casos
 * negativos. Los pagos se crean con el endpoint real
 * (POST /reservas/:id/pagos/simulados) y se consultan con
 * GET /reservas/:id/pagos/ultimo, con el JWT de un login real. La espera de la
 * pasarela se reemplaza (0 ms).
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
  const sufijo = `plan-h06-${randomUUID()}@test.local`;
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

  it('AC1: con un pago en mi reserva veo monto, fecha, número de reserva, número de transacción y estado', async () => {
    const reservaId = await reserva();
    const pagado = await pagar(reservaId, APRUEBA);

    const res = await ultimo(reservaId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      montoTotal: '25.00',
      reservaId,
      pagoId: pagado.body.pagoId,
      estado: 'APROBADO',
    });
    const fila = await prisma.simulatedPayment.findUniqueOrThrow({
      where: { id: pagado.body.pagoId },
    });
    expect(res.body.fechaRegistro).toBe(fila.createdAt.toISOString());
  });

  it('AC2: si un intento fue RECHAZADO y después hice otro APROBADO, veo el más reciente', async () => {
    const reservaId = await reserva();
    await pagar(reservaId, RECHAZA);
    expect((await ultimo(reservaId)).body.estado).toBe('RECHAZADO');

    const aprobado = await pagar(reservaId, APRUEBA);
    const res = await ultimo(reservaId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pagoId: aprobado.body.pagoId,
      estado: 'APROBADO',
    });
  });

  it('AC3: si mi reserva todavía no tiene pagos, se informa que aún no hay pago registrado', async () => {
    const res = await ultimo(await reserva());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      codigo: 'PAGO_NO_REGISTRADO',
      message: 'Aún no hay un pago registrado para esta reserva.',
    });
  });

  it('AC4: si la reserva es de otro arrendatario no se muestran sus pagos y se responde que la reserva no existe', async () => {
    const reservaId = await reserva();
    await pagar(reservaId, APRUEBA);

    const res = await ultimo(reservaId, user.t2.token);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('La reserva no existe.');
    expect(res.body).not.toHaveProperty('codigo');
    expect(JSON.stringify(res.body)).not.toMatch(/25\.00|APROBADO/);
  });

  describe('casos negativos', () => {
    it('NEG1: una reserva ajena responde igual que una inexistente', async () => {
      const ajena = await reserva();
      await pagar(ajena, APRUEBA);

      const a = await ultimo(ajena, user.t2.token);
      const b = await ultimo(randomUUID(), user.t2.token);

      expect(a.status).toBe(404);
      expect(a.body).toEqual(b.body);
    });

    it('NEG2: sin sesión es 401, un id que no es UUID es 400 y el arrendador no puede consultar (403)', async () => {
      const reservaId = await reserva();

      await ultimo(reservaId, null).expect(401);
      await ultimo('no-es-uuid').expect(400);
      await ultimo(reservaId, user.l.token).expect(403);
    });

    it('NEG3: un pago RECHAZADO muestra el motivo y el aprobado no', async () => {
      const reservaId = await reserva();
      await pagar(reservaId, RECHAZA);
      const rechazado = await ultimo(reservaId);
      await pagar(reservaId, APRUEBA);
      const aprobado = await ultimo(reservaId);

      expect(rechazado.body.motivo).toBe(
        'Tarjeta rechazada por la pasarela de prueba',
      );
      expect(aprobado.body).not.toHaveProperty('motivo');
    });

    it('NEG4: consultar no crea pagos', async () => {
      const reservaId = await reserva();

      await ultimo(reservaId);
      await ultimo(reservaId);

      expect(
        await prisma.simulatedPayment.count({
          where: { reservationId: reservaId },
        }),
      ).toBe(0);
    });
  });
});
