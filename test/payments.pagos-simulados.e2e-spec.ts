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
import { AvisosService } from '@Notifications';
import {
  MOTIVO_INTENTO_NO_COMPLETADO,
  MOTIVO_RECHAZO_PASARELA,
  PASARELA_CONFIG,
  PENDIENTE_HUERFANO_MS,
  type PasarelaConfig,
} from '@Payments/services';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Pago simulado (BE-05.1) con la app completa contra la base de pruebas (ver
 * test/helpers/test-database.ts).
 *
 * - La espera de la pasarela se reemplaza: 0 ms, salvo en la prueba de
 *   concurrencia.
 * - Las reservas se crean directo en la base (BE-04.1 todavía no está).
 * - Un logger propio captura todo lo que la app escribe, para comprobar que
 *   nunca aparece el número de tarjeta ni el cvv.
 * - En afterAll borra solo lo que creó: pagos, reservas, publicación y
 *   usuarios (la cascada se lleva sus avisos).
 */
const prisma = createTestPrismaClient();
const pasarela: PasarelaConfig = { retardoMs: 0 };

/** Logger que guarda todo lo que recibe, con stacks incluidos. */
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

/** Tarjetas con un número poco común, para buscarlo en la base y los logs. */
const NUMERO_APRUEBA = '5555666677774242';
const NUMERO_RECHAZA = '5555666677770002';
const CVV = '8613';
const tarjeta = (numeroTarjeta = '4242424242424242') => ({
  numeroTarjeta,
  vencimiento: '12/28',
  cvv: '123',
});

interface Usuario {
  id: string;
  token: string;
}

describe('pago simulado (BE-05.1)', () => {
  const sufijo = `be-05.1-${randomUUID()}@test.local`;
  const logger = new LoggerQueCaptura();
  let app: INestApplication;
  let arrendatario: Usuario;
  let otroArrendatario: Usuario;
  let arrendador: Usuario;
  let listingId: string;
  /** Cuerpos de todas las respuestas, para revisar que no repiten la tarjeta. */
  const respuestas: string[] = [];

  const pagar = async (
    reservaId: string,
    body: Record<string, unknown> = tarjeta(),
    token: string | null = arrendatario.token,
  ) => {
    const req = request(app.getHttpServer()).post(
      `/api/v1/reservas/${reservaId}/pagos/simulados`,
    );
    if (token) void req.set('Authorization', `Bearer ${token}`);
    const res = await req.send(body);
    respuestas.push(JSON.stringify(res.body));
    return res;
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

  const avisosDe = (userId: string, pagoId: string) =>
    prisma.notification.findMany({
      where: { userId, referenceType: 'pago', referenceId: pagoId },
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

  beforeEach(() => {
    pasarela.retardoMs = 0;
  });

  describe('resultado de la pasarela', () => {
    it('4242 aprueba: 201, intento 1 guardado con los importes de la reserva y avisos a los dos', async () => {
      const reservaId = await nuevaReserva();
      const res = await pagar(reservaId);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        pagoId: expect.any(String),
        reservaId,
        montoTotal: '50.05',
        estado: 'APROBADO',
        simulado: true,
        intento: 1,
      });

      const [pago] = await intentos(reservaId);
      expect(pago).toMatchObject({
        id: res.body.pagoId,
        status: 'APROBADO',
        attemptNumber: 1,
        cardLast4: '4242',
        rejectionReason: null,
      });
      expect(pago.rentalCost.toFixed(2)).toBe('40.10');
      expect(pago.depositAmount.toFixed(2)).toBe('9.95');
      expect(pago.totalAmount.toFixed(2)).toBe('50.05');
      expect(await estadoReserva(reservaId)).toBe('CONFIRMADA');

      const [paraArrendatario] = await avisosDe(arrendatario.id, pago.id);
      expect(paraArrendatario).toMatchObject({
        sourceModule: 'PAGOS_GARANTIA',
        title: 'Pago aprobado',
        message: 'Tu pago de $50.05 por «Taladro percutor» fue aprobado.',
        readAt: null,
      });
      const [paraArrendador] = await avisosDe(arrendador.id, pago.id);
      expect(paraArrendador).toMatchObject({
        sourceModule: 'PAGOS_GARANTIA',
        title: 'Pago confirmado',
        message:
          'Se confirmó el pago de $50.05 de la reserva de «Taladro percutor».',
      });
    });

    it('el monto sale de la reserva, no del request', async () => {
      const reservaId = await nuevaReserva({
        rentalCost: '0.10',
        depositAmount: '0.20',
      });
      const res = await pagar(reservaId);
      // 0.1 + 0.2 con floats daría 0.30000000000000004.
      expect(res.body.montoTotal).toBe('0.30');

      const conMonto = await pagar(await nuevaReserva(), {
        ...tarjeta(),
        monto: '1.00',
      });
      expect(conMonto.status).toBe(400);
    });

    it('0002 rechaza 3 veces (intentos 1 a 3), la reserva sigue CONFIRMADA y el cuarto da 409 INTENTOS_AGOTADOS', async () => {
      const reservaId = await nuevaReserva();
      for (const n of [1, 2, 3]) {
        const res = await pagar(reservaId, tarjeta('4000000000000002'));
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          estado: 'RECHAZADO',
          intento: n,
          motivo: MOTIVO_RECHAZO_PASARELA,
          montoTotal: '50.05',
          simulado: true,
        });
        expect(await estadoReserva(reservaId)).toBe('CONFIRMADA');
      }

      const guardados = await intentos(reservaId);
      expect(guardados.map((p) => [p.attemptNumber, p.status])).toEqual([
        [1, 'RECHAZADO'],
        [2, 'RECHAZADO'],
        [3, 'RECHAZADO'],
      ]);
      expect(
        guardados.every(
          (p) =>
            p.rejectionReason === MOTIVO_RECHAZO_PASARELA &&
            p.cardLast4 === '0002',
        ),
      ).toBe(true);
      const [aviso] = await avisosDe(arrendatario.id, guardados[0].id);
      expect(aviso).toMatchObject({
        title: 'Pago rechazado',
        message:
          'Tu pago de $50.05 por «Taladro percutor» fue rechazado. La reserva sigue confirmada y puedes intentar el pago de nuevo.',
      });
      expect(await avisosDe(arrendador.id, guardados[0].id)).toHaveLength(0);

      const cuarto = await pagar(reservaId);
      expect(cuarto.status).toBe(409);
      expect(cuarto.body).toEqual({
        statusCode: 409,
        message: expect.any(String),
        error: 'Conflict',
        codigo: 'INTENTOS_AGOTADOS',
      });
      expect(await intentos(reservaId)).toHaveLength(3);
      expect(await estadoReserva(reservaId)).toBe('CONFIRMADA');
    });

    it('rechazos y luego aprobado en el intento 3; después 409 PAGO_YA_APROBADO', async () => {
      const reservaId = await nuevaReserva();
      await pagar(reservaId, tarjeta('4000000000000002')).then((r) =>
        expect(r.status).toBe(201),
      );
      await pagar(reservaId, tarjeta('4000000000000002')).then((r) =>
        expect(r.status).toBe(201),
      );
      const tercero = await pagar(reservaId);
      expect(tercero.body).toMatchObject({ estado: 'APROBADO', intento: 3 });

      const otro = await pagar(reservaId);
      expect(otro.status).toBe(409);
      expect(otro.body.codigo).toBe('PAGO_YA_APROBADO');
      expect(await intentos(reservaId)).toHaveLength(3);
    });
  });

  describe('errores', () => {
    it('otra tarjeta da 400 TARJETA_NO_VALIDA sin crear filas', async () => {
      const reservaId = await nuevaReserva();
      const res = await pagar(reservaId, tarjeta('4000000000001111'));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message: expect.any(String),
        error: 'Bad Request',
        codigo: 'TARJETA_NO_VALIDA',
      });
      expect(await intentos(reservaId)).toHaveLength(0);
    });

    it.each([
      ['número de 12 dígitos', { numeroTarjeta: '424242424242' }],
      ['número con espacios', { numeroTarjeta: '4242 4242 4242 4242' }],
      ['vencimiento 13/28', { vencimiento: '13/28' }],
      ['vencimiento sin barra', { vencimiento: '1228' }],
      ['cvv de 2 dígitos', { cvv: '12' }],
      ['sin cvv', { cvv: undefined }],
      ['campo extra monto', { monto: '1.00' }],
      ['campo extra escenario', { escenario: 'APROBADO' }],
    ])('400 por %s, sin crear filas', async (_caso, cambios) => {
      const reservaId = await nuevaReserva();
      const res = await pagar(reservaId, { ...tarjeta(), ...cambios });
      expect(res.status).toBe(400);
      expect(await intentos(reservaId)).toHaveLength(0);
    });

    it('una tarjeta vencida no se rechaza: la pasarela decide por los últimos 4', async () => {
      const res = await pagar(await nuevaReserva(), {
        ...tarjeta(),
        vencimiento: '01/20',
      });
      expect(res.status).toBe(201);
      expect(res.body.estado).toBe('APROBADO');
    });

    it('id que no es UUID da 400', async () => {
      const res = await pagar('no-es-uuid');
      expect(res.status).toBe(400);
    });

    it.each(['PENDIENTE', 'RECHAZADA'] as const)(
      'reserva %s da 409 RESERVA_NO_CONFIRMADA',
      async (status) => {
        const reservaId = await nuevaReserva({ status });
        const res = await pagar(reservaId);
        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('RESERVA_NO_CONFIRMADA');
        expect(await intentos(reservaId)).toHaveLength(0);
      },
    );

    it('PAGO_YA_APROBADO tiene prioridad sobre RESERVA_NO_CONFIRMADA', async () => {
      const reservaId = await nuevaReserva();
      expect((await pagar(reservaId)).status).toBe(201);
      await prisma.reservation.update({
        where: { id: reservaId },
        data: { status: 'COMPLETADA' },
      });

      const res = await pagar(reservaId);
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('PAGO_YA_APROBADO');
    });

    it('reserva ajena e inexistente dan 404 con el mismo cuerpo', async () => {
      const ajena = await nuevaReserva({ tenantId: otroArrendatario.id });
      const resAjena = await pagar(ajena);
      const resInexistente = await pagar(randomUUID());

      expect(resAjena.status).toBe(404);
      expect(resInexistente.status).toBe(404);
      expect(resAjena.body).toEqual(resInexistente.body);
      expect(await intentos(ajena)).toHaveLength(0);
    });

    it('un ARRENDADOR recibe 403', async () => {
      const reservaId = await nuevaReserva();
      const res = await pagar(reservaId, tarjeta(), arrendador.token);
      expect(res.status).toBe(403);
      expect(await intentos(reservaId)).toHaveLength(0);
    });

    it('sin token responde 401', async () => {
      const reservaId = await nuevaReserva();
      const res = await pagar(reservaId, tarjeta(), null);
      expect(res.status).toBe(401);
      expect(await intentos(reservaId)).toHaveLength(0);
    });
  });

  describe('concurrencia', () => {
    it.each([
      ['4242', '4242424242424242'],
      ['0002', '4000000000000002'],
    ])(
      'dos peticiones simultáneas con %s: una se procesa y la otra recibe 409 PAGO_EN_PROCESO',
      async (_ultimos4, numero) => {
        pasarela.retardoMs = 300;
        const reservaId = await nuevaReserva();

        const resultados = await Promise.all([
          pagar(reservaId, tarjeta(numero)),
          pagar(reservaId, tarjeta(numero)),
        ]);

        expect(resultados.map((r) => r.status).sort((a, b) => a - b)).toEqual([
          201, 409,
        ]);
        const conflicto = resultados.find((r) => r.status === 409)!;
        expect(conflicto.body.codigo).toBe('PAGO_EN_PROCESO');
        const guardados = await intentos(reservaId);
        expect(guardados).toHaveLength(1);
        expect(guardados[0].attemptNumber).toBe(1);
      },
    );
  });

  describe(`intento PENDIENTE huérfano (más de ${PENDIENTE_HUERFANO_MS / 1000} s)`, () => {
    const pendiente = (reservationId: string, haceMs: number) =>
      prisma.simulatedPayment.create({
        data: {
          reservationId,
          attemptNumber: 1,
          rentalCost: '40.10',
          depositAmount: '9.95',
          totalAmount: '50.05',
          cardLast4: '4242',
          status: 'PENDIENTE',
          createdAt: new Date(Date.now() - haceMs),
        },
      });

    it('se cierra como RECHAZADO, cuenta como intento y el pago sigue con el intento 2', async () => {
      const reservaId = await nuevaReserva();
      const viejo = await pendiente(reservaId, PENDIENTE_HUERFANO_MS + 1000);

      const res = await pagar(reservaId);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ estado: 'APROBADO', intento: 2 });

      const cerrado = await prisma.simulatedPayment.findUniqueOrThrow({
        where: { id: viejo.id },
      });
      expect(cerrado).toMatchObject({
        status: 'RECHAZADO',
        rejectionReason: MOTIVO_INTENTO_NO_COMPLETADO,
      });
    });

    it('uno reciente no se cierra: da 409 PAGO_EN_PROCESO', async () => {
      const reservaId = await nuevaReserva();
      const reciente = await pendiente(reservaId, 1000);

      const res = await pagar(reservaId);
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('PAGO_EN_PROCESO');
      expect(
        (
          await prisma.simulatedPayment.findUniqueOrThrow({
            where: { id: reciente.id },
          })
        ).status,
      ).toBe('PENDIENTE');
    });
  });

  it('si el aviso falla, el pago queda guardado, la respuesta no cambia y se registra el error', async () => {
    const avisos = app.get(AvisosService);
    const espia = vi
      .spyOn(avisos, 'notificar')
      .mockRejectedValueOnce(new Error('falla simulada del aviso'));
    try {
      const reservaId = await nuevaReserva();
      const res = await pagar(reservaId);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ estado: 'APROBADO', intento: 1 });
      expect((await intentos(reservaId))[0].status).toBe('APROBADO');
      expect(
        logger.lineas.some(
          (l) =>
            l.includes('falla simulada del aviso') &&
            l.includes(res.body.pagoId as string),
        ),
      ).toBe(true);
    } finally {
      espia.mockRestore();
    }
  });

  it('ni la base, ni los logs, ni las respuestas contienen el número completo ni el cvv', async () => {
    const reservaId = await nuevaReserva();
    // Aprobado, rechazado, un aviso que falla y una validación fallida.
    const espia = vi
      .spyOn(app.get(AvisosService), 'notificar')
      .mockRejectedValueOnce(new Error('falla simulada'));
    try {
      await pagar(reservaId, {
        numeroTarjeta: NUMERO_RECHAZA,
        vencimiento: '12/28',
        cvv: CVV,
      });
    } finally {
      espia.mockRestore();
    }
    await pagar(reservaId, {
      numeroTarjeta: NUMERO_APRUEBA,
      vencimiento: '12/28',
      cvv: CVV,
    });
    await pagar(reservaId, {
      numeroTarjeta: `${NUMERO_APRUEBA}9`,
      vencimiento: '12/28',
      cvv: `${CVV}9`,
      extra: NUMERO_APRUEBA,
    });

    const guardados = await intentos(reservaId);
    expect(guardados.map((p) => p.cardLast4)).toEqual(['0002', '4242']);

    // Todas las columnas de texto (sin los UUID, que podrían contener los
    // dígitos del cvv por casualidad).
    const textoPagos = guardados
      .map((p) =>
        [
          p.cardLast4,
          p.rejectionReason,
          p.totalAmount.toFixed(2),
          p.rentalCost.toFixed(2),
          p.depositAmount.toFixed(2),
        ].join('|'),
      )
      .join('\n');
    const avisos = await prisma.notification.findMany({
      where: { userId: { in: [arrendatario.id, arrendador.id] } },
      select: { title: true, message: true, referenceType: true },
    });
    const textoAvisos = avisos
      .map((a) => [a.title, a.message, a.referenceType].join('|'))
      .join('\n');
    // Los UUID se quitan antes de buscar: podrían contener los dígitos del
    // cvv por casualidad.
    const sinUuids = (t: string) =>
      t.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<uuid>',
      );
    const textoLogs = sinUuids(logger.lineas.join('\n'));
    const textoRespuestas = sinUuids(respuestas.join('\n'));

    for (const texto of [textoPagos, textoAvisos, textoLogs, textoRespuestas]) {
      expect(texto).not.toContain(NUMERO_APRUEBA);
      expect(texto).not.toContain(NUMERO_RECHAZA);
      expect(texto).not.toContain(CVV);
    }
    // Y en la base, ninguna columna del pago (ni siquiera vía JSON) tiene el número.
    const filas = await prisma.$queryRaw<{ fila: string }[]>`
      SELECT row_to_json(p)::text AS fila FROM simulated_payments p
      WHERE reservation_id = ${reservaId}::uuid`;
    for (const { fila } of filas) {
      expect(fila).not.toContain(NUMERO_APRUEBA);
      expect(fila).not.toContain(NUMERO_RECHAZA);
    }
  });
});
