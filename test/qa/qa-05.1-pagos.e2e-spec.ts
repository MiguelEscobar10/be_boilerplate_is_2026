import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type INestApplication,
  type LoggerService,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import { AvisosService } from '@Notifications';
import {
  MOTIVO_RECHAZO_PASARELA,
  PASARELA_CONFIG,
  RETARDO_PASARELA_MS,
  type PasarelaConfig,
} from '@Payments/services';
import { createTestPrismaClient } from '../helpers/test-database.js';

/**
 * QA-05.1 (MP4-67): tarjetas de prueba y validaciones de cobro (H05).
 *
 * Los ids (C01 a C19) se repiten en docs/qa/QA-05.1-pagos.md. Cada caso llama
 * a POST /api/v1/reservas/:id/pagos/simulados con el JWT de un login real y
 * revisa la respuesta, la base y, para los avisos, la bandeja de H10.
 *
 * - La espera de la pasarela se reemplaza (PASARELA_CONFIG) salvo en C05, que
 *   levanta una segunda app sin reemplazarla y mide los 2 s reales.
 * - Las reservas se crean directo en la base: en main no hay endpoint para
 *   crearlas.
 * - El REVISOR solo lo crea el seed: aquí se crea en la base y su token se
 *   firma con el JwtService de la app.
 * - Un logger propio y espías sobre console y process.stdout/stderr guardan
 *   toda la salida durante la suite, para C16 y C18.
 *
 * Corre contra la base `_test` (test/helpers/test-database.ts). Los correos
 * llevan un sufijo único por ejecución y en afterAll se borra solo lo creado.
 */
const prisma = createTestPrismaClient();
const pasarela: PasarelaConfig = { retardoMs: 0 };

/** Todo lo que la app y la consola escriben durante la suite. */
const salida: string[] = [];

class LoggerQueCaptura implements LoggerService {
  private guardar(...args: unknown[]) {
    salida.push(
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

// Tarjetas con números poco comunes, para buscarlos después en la base y en
// la salida. Los CVV son de 4 dígitos por la misma razón.
const N13_APRUEBA = '1234567894242';
const N19_RECHAZA = '6011000990139420002';
const N16_APRUEBA = '5105105105104242';
const N16_RECHAZA_1 = '3530111333300002';
const N16_RECHAZA_2 = '6304000000000002';
const N16_RECHAZA_3 = '5019717010100002';
const CVV_A = '7391';
const CVV_B = '6604';
const NUMEROS = [
  N13_APRUEBA,
  N19_RECHAZA,
  N16_APRUEBA,
  N16_RECHAZA_1,
  N16_RECHAZA_2,
  N16_RECHAZA_3,
];
const CVVS = [CVV_A, CVV_B];

const tarjeta = (numeroTarjeta = N16_APRUEBA, cvv = CVV_A) => ({
  numeroTarjeta,
  vencimiento: '07/31',
  cvv,
});

interface ItemBandeja {
  id: string;
  moduloOrigen: string;
  titulo: string;
  mensaje: string;
  referencia: { tipo: string; id: string } | null;
  leidaAt: string | null;
}

type Quien = 't1' | 't2' | 'l' | 'inactivo' | 'revisor';
type EstadoReserva =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'EN_CURSO'
  | 'COMPLETADA';

describe('QA-05.1: tarjetas de prueba y validaciones de cobro', () => {
  const sufijo = `qa-05.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let listingId: string;
  const user = {} as Record<Quien, { id: string; token: string }>;
  /** Cuerpos de todas las respuestas del endpoint de pago. */
  const respuestas: string[] = [];
  const restaurar: (() => void)[] = [];

  const http = () => request(app.getHttpServer());

  const pagar = async (
    reservaId: string,
    body: unknown = tarjeta(),
    token: string | null = user.t1.token,
    extra: { query?: string; headers?: Record<string, string> } = {},
  ) => {
    const req = http().post(
      `/api/v1/reservas/${reservaId}/pagos/simulados${extra.query ?? ''}`,
    );
    if (token) void req.set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(extra.headers ?? {})) {
      void req.set(k, v);
    }
    const res = await req.send(body as object);
    respuestas.push(JSON.stringify(res.body));
    return res;
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
    cambios: {
      status?: EstadoReserva;
      tenantId?: string;
      rentalCost?: string;
      depositAmount?: string;
    } = {},
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId: cambios.tenantId ?? user.t1.id,
          startAt: new Date('2027-01-10T15:00:00Z'),
          endAt: new Date('2027-01-12T15:00:00Z'),
          status: cambios.status ?? 'CONFIRMADA',
          rentalCost: cambios.rentalCost ?? '18.75',
          depositAmount: cambios.depositAmount ?? '6.25',
        },
        select: { id: true },
      })
    ).id;

  const intentos = (reservationId: string) =>
    prisma.simulatedPayment.findMany({
      where: { reservationId },
      orderBy: { attemptNumber: 'asc' },
    });

  const estadoReserva = async (id: string) =>
    (
      await prisma.reservation.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      })
    ).status;

  async function bandeja(quien: Quien): Promise<ItemBandeja[]> {
    const { body } = await http()
      .get('/api/v1/notificaciones?limit=100')
      .set('Authorization', `Bearer ${user[quien].token}`)
      .expect(200);
    return body.items as ItemBandeja[];
  }

  const avisosDe = async (quien: Quien, pagoId: string) =>
    (await bandeja(quien)).filter(
      (i) => i.referencia?.tipo === 'pago' && i.referencia.id === pagoId,
    );

  const contarAvisos = () =>
    prisma.notification.count({
      where: { userId: { in: [user.t1.id, user.l.id, user.t2.id] } },
    });

  beforeAll(async () => {
    // Captura de la consola: se guarda y se deja pasar.
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        salida.push(String(chunk));
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      restaurar.push(() => {
        stream.write = original as typeof stream.write;
      });
    }
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const espia = vi.spyOn(console, m).mockImplementation((...a) => {
        salida.push(a.map((x) => String(x)).join(' '));
      });
      restaurar.push(() => espia.mockRestore());
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PASARELA_CONFIG)
      .useValue(pasarela)
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(new LoggerQueCaptura());
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
    const usuarios = { email: { endsWith: sufijo } };
    await prisma.simulatedPayment.deleteMany({
      where: { reservation: { listingId } },
    });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: usuarios });
    await app.close();
    await prisma.$disconnect();
    restaurar.reverse().forEach((r) => r());
  });

  beforeEach(() => {
    pasarela.retardoMs = 0;
  });

  describe('resultado de la pasarela', () => {
    it('C01: 4242 con número de 13 dígitos aprueba con el monto de la reserva', async () => {
      const reservaId = await reserva({
        rentalCost: '123.45',
        depositAmount: '76.55',
      });
      const res = await pagar(reservaId, tarjeta(N13_APRUEBA));

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        pagoId: expect.any(String),
        reservaId,
        montoTotal: '200.00',
        estado: 'APROBADO',
        simulado: true,
        intento: 1,
      });
      const [fila] = await intentos(reservaId);
      expect(fila).toMatchObject({
        id: res.body.pagoId,
        status: 'APROBADO',
        attemptNumber: 1,
        cardLast4: '4242',
        rejectionReason: null,
      });
      expect(fila.rentalCost.toFixed(2)).toBe('123.45');
      expect(fila.depositAmount.toFixed(2)).toBe('76.55');
      expect(fila.totalAmount.toFixed(2)).toBe('200.00');
    });

    it('C02: 0002 con número de 19 dígitos rechaza con motivo; la reserva sigue CONFIRMADA y 4242 aprueba en el intento 2', async () => {
      const reservaId = await reserva();
      const rechazo = await pagar(reservaId, tarjeta(N19_RECHAZA, CVV_B));
      expect(rechazo.status).toBe(201);
      expect(rechazo.body).toEqual({
        pagoId: expect.any(String),
        reservaId,
        montoTotal: '25.00',
        estado: 'RECHAZADO',
        simulado: true,
        intento: 1,
        motivo: MOTIVO_RECHAZO_PASARELA,
      });
      expect(await estadoReserva(reservaId)).toBe('CONFIRMADA');

      const aprobado = await pagar(reservaId, tarjeta(N16_APRUEBA));
      expect(aprobado.status).toBe(201);
      expect(aprobado.body).toMatchObject({ estado: 'APROBADO', intento: 2 });
      expect(
        (await intentos(reservaId)).map((p) => [
          p.attemptNumber,
          p.status,
          p.cardLast4,
        ]),
      ).toEqual([
        [1, 'RECHAZADO', '0002'],
        [2, 'APROBADO', '4242'],
      ]);
    });

    it('C03: tres rechazos con tarjetas distintas; el cuarto (aunque sea 4242) da 409 INTENTOS_AGOTADOS sin fila ni aviso', async () => {
      const reservaId = await reserva();
      for (const [n, numero] of [
        [1, N16_RECHAZA_1],
        [2, N16_RECHAZA_2],
        [3, N16_RECHAZA_3],
      ] as const) {
        const res = await pagar(reservaId, tarjeta(numero));
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ estado: 'RECHAZADO', intento: n });
      }
      const avisosAntes = await contarAvisos();

      const cuarto = await pagar(reservaId, tarjeta(N16_APRUEBA));
      expect(cuarto.status).toBe(409);
      expect(cuarto.body).toEqual({
        statusCode: 409,
        message: expect.any(String),
        error: 'Conflict',
        codigo: 'INTENTOS_AGOTADOS',
      });
      const filas = await intentos(reservaId);
      expect(filas).toHaveLength(3);
      expect(filas.some((p) => p.status === 'APROBADO')).toBe(false);
      expect(await contarAvisos()).toBe(avisosAntes);
      expect(await estadoReserva(reservaId)).toBe('CONFIRMADA');
    });

    it.each([
      '4000000000004243',
      '4000000000000000',
      '4000000000002424',
      '4000000000000001',
    ])(
      'C04: otra tarjeta (%s) da 400 TARJETA_NO_VALIDA sin fila',
      async (numero) => {
        const reservaId = await reserva();
        const res = await pagar(reservaId, tarjeta(numero));
        expect(res.status).toBe(400);
        expect(res.body).toEqual({
          statusCode: 400,
          message: expect.any(String),
          error: 'Bad Request',
          codigo: 'TARJETA_NO_VALIDA',
        });
        expect(JSON.stringify(res.body)).not.toContain(numero);
        expect(await intentos(reservaId)).toHaveLength(0);
      },
    );

    it('C04: TARJETA_NO_VALIDA va antes que el 404 (ajena) y que el 409 (pagada)', async () => {
      const ajena = await reserva({ tenantId: user.t2.id });
      const resAjena = await pagar(ajena, tarjeta('4000000000009999'));
      expect(resAjena.status).toBe(400);
      expect(resAjena.body.codigo).toBe('TARJETA_NO_VALIDA');

      const pagada = await reserva();
      expect((await pagar(pagada)).status).toBe(201);
      const resPagada = await pagar(pagada, tarjeta('4000000000009999'));
      expect(resPagada.status).toBe(400);
      expect(resPagada.body.codigo).toBe('TARJETA_NO_VALIDA');
      expect(await intentos(pagada)).toHaveLength(1);
    });

    it('C05: con la espera real (sin reemplazar PASARELA_CONFIG) el pago tarda al menos 2 s', async () => {
      expect(RETARDO_PASARELA_MS).toBe(2000);
      const ref = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .compile();
      const real = ref.createNestApplication();
      real.useLogger(new LoggerQueCaptura());
      real.setGlobalPrefix('api/v1');
      real.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await real.init();
      try {
        const reservaId = await reserva();
        const inicio = performance.now();
        const res = await request(real.getHttpServer())
          .post(`/api/v1/reservas/${reservaId}/pagos/simulados`)
          .set('Authorization', `Bearer ${user.t1.token}`)
          .send(tarjeta());
        const ms = performance.now() - inicio;
        respuestas.push(JSON.stringify(res.body));

        expect(res.status).toBe(201);
        expect(res.body.estado).toBe('APROBADO');
        expect(ms).toBeGreaterThanOrEqual(2000);
        expect(ms).toBeLessThan(15000);
      } finally {
        await real.close();
      }
    }, 20_000);
  });

  describe('operaciones prohibidas', () => {
    it('C06: segundo pago de una reserva pagada da 409 PAGO_YA_APROBADO (con 4242 y con 0002) sin fila nueva', async () => {
      const reservaId = await reserva();
      expect((await pagar(reservaId)).status).toBe(201);

      for (const numero of [N16_APRUEBA, N16_RECHAZA_1]) {
        const res = await pagar(reservaId, tarjeta(numero));
        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('PAGO_YA_APROBADO');
      }
      const filas = await intentos(reservaId);
      expect(filas).toHaveLength(1);
      expect(filas.filter((p) => p.status === 'APROBADO')).toHaveLength(1);
    });

    it('C07: dos solicitudes simultáneas, 10 repeticiones: siempre un 201 y un 409 PAGO_EN_PROCESO, una sola fila', async () => {
      pasarela.retardoMs = 200;
      for (let i = 0; i < 10; i++) {
        const reservaId = await reserva();
        const segunda = i % 2 === 0 ? N16_APRUEBA : N16_RECHAZA_1;
        const resultados = await Promise.all([
          pagar(reservaId, tarjeta(N16_APRUEBA)),
          pagar(reservaId, tarjeta(segunda)),
        ]);

        expect(resultados.map((r) => r.status).sort((a, b) => a - b)).toEqual([
          201, 409,
        ]);
        expect(resultados.find((r) => r.status === 409)!.body.codigo).toBe(
          'PAGO_EN_PROCESO',
        );
        const filas = await intentos(reservaId);
        expect(filas).toHaveLength(1);
        expect(
          filas.filter((p) => p.status === 'APROBADO').length,
        ).toBeLessThanOrEqual(1);
      }
    }, 30_000);

    it('C07: ráfaga de 5 solicitudes simultáneas: un 201, cuatro 409 y un solo APROBADO', async () => {
      pasarela.retardoMs = 300;
      const reservaId = await reserva();
      const resultados = await Promise.all(
        Array.from({ length: 5 }, () => pagar(reservaId)),
      );
      expect(resultados.filter((r) => r.status === 201)).toHaveLength(1);
      const conflictos = resultados.filter((r) => r.status === 409);
      expect(conflictos).toHaveLength(4);
      expect(conflictos.every((r) => r.body.codigo === 'PAGO_EN_PROCESO')).toBe(
        true,
      );
      const filas = await intentos(reservaId);
      expect(filas).toHaveLength(1);
      expect(filas[0].status).toBe('APROBADO');
    });

    it.each([
      'PENDIENTE',
      'RECHAZADA',
      'CANCELADA',
      'EN_CURSO',
      'COMPLETADA',
    ] as const)(
      'C08: reserva %s da 409 RESERVA_NO_CONFIRMADA sin crear intento',
      async (status) => {
        const reservaId = await reserva({ status });
        const res = await pagar(reservaId);
        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          statusCode: 409,
          message: expect.any(String),
          error: 'Conflict',
          codigo: 'RESERVA_NO_CONFIRMADA',
        });
        expect(await intentos(reservaId)).toHaveLength(0);
        expect(await estadoReserva(reservaId)).toBe(status);
      },
    );

    it('C09: reserva ajena da 404 con el mismo cuerpo que una inexistente (también con 0002)', async () => {
      const ajena = await reserva({ tenantId: user.t2.id });
      const inexistente = randomUUID();
      for (const numero of [N16_APRUEBA, N16_RECHAZA_1]) {
        const a = await pagar(ajena, tarjeta(numero));
        const b = await pagar(inexistente, tarjeta(numero));
        expect(a.status).toBe(404);
        expect(b.status).toBe(404);
        expect(a.body).toEqual(b.body);
      }
      expect(await intentos(ajena)).toHaveLength(0);
    });

    it('C09: ARRENDADOR y REVISOR reciben 403; sin token, token inválido o cuenta inactiva, 401', async () => {
      const reservaId = await reserva();
      expect((await pagar(reservaId, tarjeta(), user.l.token)).status).toBe(
        403,
      );
      expect(
        (await pagar(reservaId, tarjeta(), user.revisor.token)).status,
      ).toBe(403);
      expect((await pagar(reservaId, tarjeta(), null)).status).toBe(401);
      expect((await pagar(reservaId, tarjeta(), 'no-es-un-jwt')).status).toBe(
        401,
      );

      await prisma.user.update({
        where: { id: user.inactivo.id },
        data: { isActive: false },
      });
      const propia = await reserva({ tenantId: user.inactivo.id });
      expect((await pagar(propia, tarjeta(), user.inactivo.token)).status).toBe(
        401,
      );

      expect(await intentos(reservaId)).toHaveLength(0);
      expect(await intentos(propia)).toHaveLength(0);
    });
  });

  describe('monto y datos de la tarjeta', () => {
    it.each([
      ['monto', { monto: '0.01' }],
      ['montoTotal', { montoTotal: '0.01' }],
      ['total', { total: 0.01 }],
      ['rentalCost', { rentalCost: '0.01' }],
      ['depositAmount', { depositAmount: '0' }],
      ['escenario', { escenario: 'APROBADO' }],
      ['estado', { estado: 'APROBADO' }],
      ['reservaId', { reservaId: randomUUID() }],
      ['tarjeta anidada', { tarjeta: { monto: '0.01' } }],
    ])('C10: campo extra «%s» da 400 sin fila', async (_campo, extra) => {
      const reservaId = await reserva();
      const res = await pagar(reservaId, { ...tarjeta(), ...extra });
      expect(res.status).toBe(400);
      expect(res.body.codigo).toBeUndefined();
      expect(await intentos(reservaId)).toHaveLength(0);
    });

    it('C11: un monto en la query o en un header no cambia el cobro: sale de la reserva', async () => {
      const reservaId = await reserva({
        rentalCost: '999999.99',
        depositAmount: '0.01',
      });
      const res = await pagar(reservaId, tarjeta(), user.t1.token, {
        query: '?monto=0.01&total=0.01',
        headers: { 'X-Monto': '0.01' },
      });
      expect(res.status).toBe(201);
      expect(res.body.montoTotal).toBe('1000000.00');
      const [fila] = await intentos(reservaId);
      expect(fila.totalAmount.toFixed(2)).toBe('1000000.00');
      expect(fila.rentalCost.toFixed(2)).toBe('999999.99');
      expect(fila.depositAmount.toFixed(2)).toBe('0.01');
    });

    it.each([
      ['vencimiento 00/28', { vencimiento: '00/28' }],
      ['vencimiento 1/28', { vencimiento: '1/28' }],
      ['vencimiento 12/2028', { vencimiento: '12/2028' }],
      ['vencimiento 12-28', { vencimiento: '12-28' }],
      ['cvv de 2 dígitos', { cvv: '12' }],
      ['cvv de 5 dígitos', { cvv: '12345' }],
      ['cvv con letra', { cvv: '12a' }],
      ['número con letras', { numeroTarjeta: '4242abcd42424242' }],
      ['número de 20 dígitos', { numeroTarjeta: '12345678901234564242' }],
      ['número como number', { numeroTarjeta: 1234567894242 }],
      ['número vacío', { numeroTarjeta: '' }],
    ])('C12: %s da 400 sin codigo ni fila', async (_caso, cambios) => {
      const reservaId = await reserva();
      const body = { ...tarjeta(), ...cambios };
      const res = await pagar(reservaId, body);
      expect(res.status).toBe(400);
      expect(res.body.codigo).toBeUndefined();
      // El mensaje no repite el valor enviado.
      const texto = JSON.stringify(res.body);
      for (const v of Object.values(cambios)) {
        if (String(v).length >= 4) expect(texto).not.toContain(String(v));
      }
      expect(await intentos(reservaId)).toHaveLength(0);
    });
  });

  describe('avisos', () => {
    it('C13: APROBADO avisa «Pago aprobado» al arrendatario y «Pago confirmado» al arrendador, sin datos de la tarjeta', async () => {
      const reservaId = await reserva({
        rentalCost: '123.45',
        depositAmount: '76.55',
      });
      const res = await pagar(reservaId, tarjeta(N16_APRUEBA, CVV_B));
      const pagoId = res.body.pagoId as string;

      const [aT1, ...otrosT1] = await avisosDe('t1', pagoId);
      expect(otrosT1).toHaveLength(0);
      expect(aT1).toMatchObject({
        moduloOrigen: 'PAGOS_GARANTIA',
        titulo: 'Pago aprobado',
        referencia: { tipo: 'pago', id: pagoId },
        leidaAt: null,
      });
      const [aL, ...otrosL] = await avisosDe('l', pagoId);
      expect(otrosL).toHaveLength(0);
      expect(aL).toMatchObject({
        moduloOrigen: 'PAGOS_GARANTIA',
        titulo: 'Pago confirmado',
        referencia: { tipo: 'pago', id: pagoId },
      });
      for (const a of [aT1, aL]) {
        expect(a.mensaje).toContain('Mezcladora de concreto');
        expect(a.mensaje).toContain('$200.00');
        expect(a.mensaje).not.toContain('4242');
        expect(a.mensaje).not.toContain(N16_APRUEBA);
        expect(a.mensaje).not.toContain(CVV_B);
      }
      expect(await avisosDe('t2', pagoId)).toHaveLength(0);
    });

    it('C14: cada RECHAZADO avisa solo al arrendatario («Pago rechazado»), sin deduplicar los tres intentos', async () => {
      const reservaId = await reserva();
      const ids: string[] = [];
      for (const numero of [N16_RECHAZA_1, N16_RECHAZA_2, N19_RECHAZA]) {
        ids.push((await pagar(reservaId, tarjeta(numero))).body.pagoId);
      }
      for (const pagoId of ids) {
        const avisosT1 = await avisosDe('t1', pagoId);
        expect(avisosT1).toHaveLength(1);
        expect(avisosT1[0]).toMatchObject({
          moduloOrigen: 'PAGOS_GARANTIA',
          titulo: 'Pago rechazado',
        });
        expect(avisosT1[0].mensaje).toContain('Mezcladora de concreto');
        expect(avisosT1[0].mensaje).toContain('$25.00');
        expect(avisosT1[0].mensaje).not.toContain('0002');
        expect(await avisosDe('l', pagoId)).toHaveLength(0);
      }
    });

    it('C15: los 400, 404 y 409 no generan avisos', async () => {
      const antes = await contarAvisos();
      const pagada = await reserva();
      await pagar(pagada);
      const despuesDelPago = await contarAvisos();
      expect(despuesDelPago).toBe(antes + 2);

      await pagar(pagada); // 409 PAGO_YA_APROBADO
      await pagar(await reserva({ status: 'PENDIENTE' })); // 409
      await pagar(await reserva({ tenantId: user.t2.id })); // 404
      await pagar(await reserva(), tarjeta('4000000000001234')); // 400
      await pagar(await reserva(), { ...tarjeta(), monto: '1' }); // 400
      expect(await contarAvisos()).toBe(despuesDelPago);
    });

    it('C16: si todos los avisos fallan, el pago (aprobado o rechazado) queda guardado y la respuesta no cambia', async () => {
      const espia = vi
        .spyOn(app.get(AvisosService), 'notificar')
        .mockRejectedValue(new Error('servicio de avisos caído (QA-05.1)'));
      try {
        const antes = await contarAvisos();
        const r1 = await reserva();
        const rechazo = await pagar(r1, tarjeta(N16_RECHAZA_2));
        const r2 = await reserva();
        const aprobado = await pagar(r2, tarjeta(N16_APRUEBA));

        expect(rechazo.status).toBe(201);
        expect(rechazo.body).toMatchObject({ estado: 'RECHAZADO', intento: 1 });
        expect(aprobado.status).toBe(201);
        expect(aprobado.body).toMatchObject({ estado: 'APROBADO', intento: 1 });
        expect((await intentos(r1))[0].status).toBe('RECHAZADO');
        expect((await intentos(r2))[0].status).toBe('APROBADO');
        expect(await contarAvisos()).toBe(antes);

        for (const pagoId of [rechazo.body.pagoId, aprobado.body.pagoId]) {
          const lineas = salida.filter(
            (l) => l.includes('servicio de avisos caído') && l.includes(pagoId),
          );
          expect(lineas.length).toBeGreaterThan(0);
        }
      } finally {
        espia.mockRestore();
      }
    });
  });

  describe('privacidad y sin cobros reales', () => {
    /** Quita lo que puede contener dígitos por casualidad: UUID, hashes. */
    const limpiar = (t: string) =>
      t
        .replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
          '<uuid>',
        )
        .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '<bcrypt>')
        .replace(/\b[0-9a-f]{32,}\b/gi, '<hex>')
        .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>');

    it('C17: ninguna tabla de la base tiene el número completo ni el CVV; solo los últimos 4', async () => {
      const tablas = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
      expect(tablas.length).toBeGreaterThan(10);

      for (const { tablename } of tablas) {
        const filas = await prisma.$queryRawUnsafe<{ fila: string }[]>(
          `SELECT row_to_json(t)::text AS fila FROM "${tablename}" t`,
        );
        const crudo = filas.map((f) => f.fila).join('\n');
        for (const n of NUMEROS) {
          expect(crudo, `${tablename} contiene ${n}`).not.toContain(n);
        }
        const texto = limpiar(crudo);
        for (const c of CVVS) {
          expect(texto, `${tablename} contiene el cvv`).not.toContain(c);
        }
      }

      const ultimos4 = await prisma.simulatedPayment.findMany({
        where: { reservation: { listingId } },
        select: { cardLast4: true },
        distinct: ['cardLast4'],
      });
      expect(ultimos4.map((p) => p.cardLast4).sort()).toEqual(['0002', '4242']);
    });

    it('C18: ni los logs, ni la consola, ni las respuestas contienen el número, el CVV ni el cuerpo de la solicitud', async () => {
      // La suite generó errores en el log (C16), así que hay salida que revisar.
      expect(salida.length).toBeGreaterThan(0);
      const textoSalida = limpiar(salida.join('\n'));
      const textoRespuestas = limpiar(respuestas.join('\n'));
      for (const texto of [textoSalida, textoRespuestas]) {
        for (const n of NUMEROS) expect(texto).not.toContain(n);
        for (const c of CVVS) expect(texto).not.toContain(c);
        expect(texto).not.toContain('numeroTarjeta');
        expect(texto).not.toContain('"cvv"');
      }
    });

    it('C19: no hay SDK de cobro ni llamadas a hosts externos en el backend', () => {
      const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      const deps = Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.optionalDependencies,
      });
      const SDK =
        /stripe|paypal|braintree|mercadopago|adyen|square|conekta|wompi|razorpay|culqi|payu|authorize|checkout|openpay|epayco|klarna|mollie/i;
      expect(deps.filter((d) => SDK.test(d))).toEqual([]);

      const ts = (dir: string) =>
        readdirSync(dir, { recursive: true, encoding: 'utf8' })
          .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
          .map((f) => join(dir, f));
      const fuentes = ts('src').filter(
        (f) => !f.replace(/\\/g, '/').startsWith('src/generated/'),
      );
      for (const f of fuentes) {
        const codigo = readFileSync(f, 'utf8');
        expect(codigo, f).not.toMatch(
          /from ['"][^'"]*(stripe|paypal|braintree|mercadopago|adyen)/i,
        );
      }
      for (const f of ts('src/payments')) {
        const codigo = readFileSync(f, 'utf8');
        expect(codigo, f).not.toMatch(/\bfetch\s*\(/);
        expect(codigo, f).not.toMatch(/axios|undici|got\(/);
        expect(codigo, f).not.toMatch(/from ['"](node:)?https?['"]/);
        expect(codigo, f).not.toMatch(/https?:\/\//);
      }
    });
  });
});
