import { randomUUID } from 'node:crypto';
import {
  type INestApplication,
  type LoggerService,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { PASARELA_CONFIG, type PasarelaConfig } from '@Payments/services';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Consulta del último pago (BE-06.1) con la app completa contra la base de
 * pruebas (ver test/helpers/test-database.ts).
 *
 * - Los pagos y las reservas se crean directo en la base.
 * - En afterAll borra solo lo que creó: pagos, reservas, publicación y
 *   usuarios.
 */
const prisma = createTestPrismaClient();
const pasarela: PasarelaConfig = { retardoMs: 0 };

/** Silencia los logs de la app durante la prueba. */
class LoggerQueCaptura implements LoggerService {
  readonly lineas: string[] = [];
  private guardar(...args: unknown[]) {
    this.lineas.push(
      args
        .map((a) =>
          a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a),
        )
        .join(' '),
    );
  }
  log = (...a: unknown[]) => this.guardar(...a);
  error = (...a: unknown[]) => this.guardar(...a);
  warn = (...a: unknown[]) => this.guardar(...a);
  debug = (...a: unknown[]) => this.guardar(...a);
  verbose = (...a: unknown[]) => this.guardar(...a);
  fatal = (...a: unknown[]) => this.guardar(...a);
}

interface Usuario {
  id: string;
  token: string;
}

describe('último pago de una reserva (BE-06.1)', () => {
  const sufijo = `be-06.1-${randomUUID()}@test.local`;
  const logger = new LoggerQueCaptura();
  let app: INestApplication;
  let arrendatario: Usuario;
  let otroArrendatario: Usuario;
  let arrendador: Usuario;
  let listingId: string;
  const ultimo = (
    reservaId: string,
    token: string | null = arrendatario.token,
  ) => {
    const req = request(app.getHttpServer()).get(
      `/api/v1/reservas/${reservaId}/pagos/ultimo`,
    );
    if (token) void req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  const nuevaReserva = async (
    cambios: {
      status?: 'PENDIENTE' | 'CONFIRMADA' | 'RECHAZADA' | 'COMPLETADA';
      tenantId?: string;
      rentalCost?: string;
      depositAmount?: string;
    } = {},
  ) => {
    const { id } = await prisma.reservation.create({
      data: {
        listingId,
        tenantId: cambios.tenantId ?? arrendatario.id,
        startAt: new Date('2026-12-01T15:00:00Z'),
        endAt: new Date('2026-12-03T15:00:00Z'),
        status: cambios.status ?? 'CONFIRMADA',
        rentalCost: cambios.rentalCost ?? '40.10',
        depositAmount: cambios.depositAmount ?? '9.95',
      },
      select: { id: true },
    });
    return id;
  };

  const nuevoPago = (
    reservationId: string,
    attemptNumber: number,
    status: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO',
    createdAt: Date,
  ) =>
    prisma.simulatedPayment.create({
      data: {
        reservationId,
        totalAmount: '50.05',
        rentalCost: '40.10',
        depositAmount: '9.95',
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
    app.useLogger(logger);
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

    const jwt = app.get(JwtService);
    const crear = async (
      nombre: string,
      role: 'ARRENDADOR' | 'ARRENDATARIO',
    ): Promise<Usuario> => {
      const email = `${nombre}-${sufijo}`;
      const { id } = await prisma.user.create({
        data: { email, passwordHash: 'no-es-un-hash-real', role },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    arrendatario = await crear('arrendatario', 'ARRENDATARIO');
    otroArrendatario = await crear('otro', 'ARRENDATARIO');
    arrendador = await crear('arrendador', 'ARRENDADOR');

    ({ id: listingId } = await prisma.listing.create({
      data: {
        landlordId: arrendador.id,
        type: 'EQUIPO',
        name: 'Taladro percutor',
        location: 'Antiguo Cuscatlán',
        rateAmount: '20.05',
        rateUnit: 'DIA',
      },
      select: { id: true },
    }));
  });

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

  it('con un pago aprobado devuelve los campos completos', async () => {
    const reservaId = await nuevaReserva();
    const pago = await nuevoPago(
      reservaId,
      1,
      'APROBADO',
      new Date('2026-11-12T16:00:00Z'),
    );

    const res = await ultimo(reservaId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pagoId: pago.id,
      reservaId,
      montoTotal: '50.05',
      fechaRegistro: '2026-11-12T16:00:00.000Z',
      estado: 'APROBADO',
      simulado: true,
    });
  });

  it('con varios intentos devuelve el más reciente', async () => {
    const reservaId = await nuevaReserva();
    await nuevoPago(
      reservaId,
      1,
      'RECHAZADO',
      new Date('2026-11-12T16:00:00Z'),
    );
    await nuevoPago(
      reservaId,
      2,
      'RECHAZADO',
      new Date('2026-11-12T16:05:00Z'),
    );
    const ultimoPago = await nuevoPago(
      reservaId,
      3,
      'APROBADO',
      new Date('2026-11-12T16:10:00Z'),
    );

    const res = await ultimo(reservaId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      pagoId: ultimoPago.id,
      estado: 'APROBADO',
    });
    expect(res.body).not.toHaveProperty('motivo');
  });

  it('un rechazo trae el motivo', async () => {
    const reservaId = await nuevaReserva();
    await nuevoPago(reservaId, 1, 'RECHAZADO', new Date());

    const res = await ultimo(reservaId);

    expect(res.body).toMatchObject({
      estado: 'RECHAZADO',
      motivo: 'Sin fondos',
    });
  });

  it('refleja un intento nuevo en la consulta siguiente (sin caché)', async () => {
    const reservaId = await nuevaReserva();
    await nuevoPago(
      reservaId,
      1,
      'RECHAZADO',
      new Date('2026-11-12T16:00:00Z'),
    );
    expect((await ultimo(reservaId)).body).toMatchObject({
      estado: 'RECHAZADO',
    });

    await nuevoPago(reservaId, 2, 'APROBADO', new Date('2026-11-12T16:30:00Z'));

    expect((await ultimo(reservaId)).body).toMatchObject({
      estado: 'APROBADO',
    });
  });

  it('reserva propia sin pagos: 404 con PAGO_NO_REGISTRADO', async () => {
    const res = await ultimo(await nuevaReserva());

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ codigo: 'PAGO_NO_REGISTRADO' });
  });

  it('reserva ajena (con o sin pagos): 404 igual que una inexistente', async () => {
    const ajena = await nuevaReserva({ tenantId: otroArrendatario.id });
    await nuevoPago(ajena, 1, 'APROBADO', new Date());
    const ajenaSinPago = await nuevaReserva({ tenantId: otroArrendatario.id });

    const conPago = await ultimo(ajena);
    const sinPago = await ultimo(ajenaSinPago);
    const inexistente = await ultimo(randomUUID());

    for (const res of [conPago, sinPago, inexistente]) {
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty('codigo');
      expect(res.body).toEqual(inexistente.body);
    }
    expect(JSON.stringify(conPago.body)).not.toContain('50.05');
  });

  it('el arrendador no consulta pagos: 403', async () => {
    const reservaId = await nuevaReserva();
    await nuevoPago(reservaId, 1, 'APROBADO', new Date());

    expect((await ultimo(reservaId, arrendador.token)).status).toBe(403);
  });

  it('sin sesión: 401; id que no es UUID: 400', async () => {
    expect((await ultimo(randomUUID(), null)).status).toBe(401);
    expect((await ultimo('no-es-uuid')).status).toBe(400);
  });
});
