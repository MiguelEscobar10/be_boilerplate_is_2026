import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-09.1 (MP4-80): devolución, depósito de garantía y cierre (H09).
 *
 * Cada caso tiene un id (C01, C02...) que se repite en la evidencia de
 * docs/qa/QA-09.1-devolucion.md. Se compara la respuesta HTTP con lo que
 * queda en la base (devolución, resolución, estado de la reserva) y, para el
 * aviso, con la bandeja real del arrendatario (GET /notificaciones).
 *
 * Las reservas se crean directo en la base, EN_CURSO y con su entrega: la
 * solicitud de reserva (BE-03.1) todavía no está en main. La devolución y la
 * resolución usan los endpoints reales (BE-09.1 y BE-09.2).
 */
const HOUR = 3_600_000;

type Session = { token: string; userId: string };

describe('QA-09.1: devolución, depósito y cierre', () => {
  const email = `qa-09.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  const BIEN = 'Proyector QA-09.1';
  const DELIVERED_AT = new Date(Date.now() - 24 * HOUR);
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let listingId: string;
  let accounts = 0;

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

  /** Reserva con depósito de $20.00. EN_CURSO lleva su entrega registrada. */
  const newReservation = async (
    status: 'EN_CURSO' | 'CONFIRMADA' = 'EN_CURSO',
  ) => {
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
    if (status === 'EN_CURSO') {
      await prisma.delivery.create({
        data: {
          reservationId: reservation.id,
          deliveredAt: DELIVERED_AT,
          initialConditionNote: 'Completo',
          registeredById: landlord.userId,
        },
      });
    }
    return reservation.id;
  };

  const SIN_DANOS = {
    fechaReal: new Date(Date.now() - HOUR).toISOString(),
    estadoFinal: 'SIN_OBSERVACIONES',
  };
  const CON_DANOS = {
    fechaReal: new Date(Date.now() - HOUR).toISOString(),
    estadoFinal: 'CON_OBSERVACIONES',
    danos: 'Rayón lateral',
  };

  const devolver = (
    id: string,
    body: Record<string, unknown> = CON_DANOS,
    who: Session | null = landlord,
  ) => auth(http().post(`/api/v1/reservas/${id}/devolucion`), who).send(body);

  const resolver = (
    id: string,
    body: Record<string, unknown>,
    who: Session | null = landlord,
  ) =>
    auth(http().post(`/api/v1/reservas/${id}/deposito/resolucion`), who).send(
      body,
    );

  const garantia = (id: string, who: Session = landlord) =>
    auth(http().get(`/api/v1/reservas/${id}/deposito/resolucion`), who);

  /** Reserva EN_CURSO con la devolución ya registrada por la API. */
  const devuelta = async (body: Record<string, unknown> = CON_DANOS) => {
    const id = await newReservation();
    await devolver(id, body).expect(201);
    return id;
  };

  const estado = async (id: string) =>
    (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;
  const resoluciones = (reservationId: string) =>
    prisma.depositResolution.count({ where: { reservationId } });
  const devoluciones = (reservationId: string) =>
    prisma.return.count({ where: { reservationId } });

  /** Avisos de esa reserva en la bandeja de `who`. */
  const avisos = async (id: string, who: Session) => {
    const { body } = await auth(
      http().get('/api/v1/notificaciones?limit=50'),
      who,
    ).expect(200);
    return (
      body.items as {
        titulo: string;
        mensaje: string;
        moduloOrigen: string;
        referencia: { tipo: string; id: string } | null;
        leidaAt: string | null;
      }[]
    ).filter((n) => n.referencia?.id === id);
  };

  /** La resolución no dejó nada: ni fila, ni cierre, ni aviso. */
  const sinResolver = async (id: string) => {
    expect(await resoluciones(id)).toBe(0);
    expect(await estado(id)).toBe('EN_CURSO');
    expect(await avisos(id, tenant)).toHaveLength(0);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();

    // Se importa después de fijar las variables para que ConfigModule las lea.
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
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'EQUIPO',
          name: BIEN,
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

  describe('criterio 1: registrar la devolución de una reserva EN_CURSO', () => {
    it('C01: sin observaciones guarda la fecha y el estado final, y la reserva sigue EN_CURSO', async () => {
      const id = await newReservation();

      const { body } = await devolver(id, SIN_DANOS).expect(201);

      expect(body).toMatchObject({ reservaId: id, devolucionRegistrada: true });
      const saved = await prisma.return.findUniqueOrThrow({
        where: { reservationId: id },
      });
      expect(saved.returnedAt.toISOString()).toBe(SIN_DANOS.fechaReal);
      expect(saved.finalState).toBe('SIN_OBSERVACIONES');
      expect(saved.damages).toBeNull();
      expect(saved.registeredById).toBe(landlord.userId);
      // Registrar la devolución no cierra la reserva.
      expect(await estado(id)).toBe('EN_CURSO');
    });

    it('C02: con observaciones guarda los daños y los dos participantes la consultan', async () => {
      const id = await newReservation();

      await devolver(id, CON_DANOS).expect(201);

      for (const who of [landlord, tenant]) {
        const { body } = await auth(
          http().get(`/api/v1/reservas/${id}/devolucion`),
          who,
        ).expect(200);
        expect(body).toMatchObject({
          reservaId: id,
          fechaReal: CON_DANOS.fechaReal,
          estadoFinal: 'CON_OBSERVACIONES',
          danos: 'Rayón lateral',
        });
      }
    });

    it('C03: observaciones sin daños, o daños sin observaciones, es 400 y no guarda', async () => {
      const id = await newReservation();

      await devolver(id, {
        ...SIN_DANOS,
        estadoFinal: 'CON_OBSERVACIONES',
      }).expect(400);
      await devolver(id, { ...SIN_DANOS, danos: 'Rayón' }).expect(400);

      expect(await devoluciones(id)).toBe(0);
    });

    it('C04: una reserva que no está EN_CURSO (CONFIRMADA, sin entrega) es 409', async () => {
      const id = await newReservation('CONFIRMADA');

      await devolver(id, SIN_DANOS).expect(409);

      expect(await devoluciones(id)).toBe(0);
      expect(await estado(id)).toBe('CONFIRMADA');
    });

    it('C05: una segunda devolución es 409 y conserva la primera', async () => {
      const id = await devuelta(SIN_DANOS);

      await devolver(id, CON_DANOS).expect(409);

      expect(await devoluciones(id)).toBe(1);
      const saved = await prisma.return.findUniqueOrThrow({
        where: { reservationId: id },
      });
      expect(saved.finalState).toBe('SIN_OBSERVACIONES');
    });
  });

  describe('criterio 2: sin daños ni faltantes, la garantía queda LIBERADA completa', () => {
    it('C06: devolución SIN_OBSERVACIONES y retención 0: libera los $20.00', async () => {
      const id = await devuelta(SIN_DANOS);

      const { body } = await resolver(id, { montoRetenido: 0 }).expect(200);

      expect(body).toEqual({
        depositoOriginal: 20,
        montoRetenido: 0,
        montoLiberado: 20,
        estadoGarantia: 'LIBERADA',
        motivo: null,
        estadoReserva: 'COMPLETADA',
        simulado: true,
      });
      const saved = await prisma.depositResolution.findUniqueOrThrow({
        where: { reservationId: id },
      });
      expect(saved.status).toBe('LIBERADA');
      expect(saved.releasedAmount.toFixed(2)).toBe('20.00');
      expect(saved.retainedAmount.toFixed(2)).toBe('0.00');
    });

    it('C07: con una devolución SIN_OBSERVACIONES no se puede retener (422)', async () => {
      const id = await devuelta(SIN_DANOS);

      const { body } = await resolver(id, {
        montoRetenido: 5,
        motivo: 'Daño',
      }).expect(422);

      expect(body.codigo).toBe('RETENCION_SIN_OBSERVACIONES');
      await sinResolver(id);
    });
  });

  describe('criterio 3: con daños, retener pide monto y motivo y queda RETENIDA', () => {
    it('C08: retención 5 de un depósito de 20 produce liberación 15 y queda RETENIDA', async () => {
      const id = await devuelta();

      const { body } = await resolver(id, {
        montoRetenido: 5,
        motivo: 'Daño reportado',
      }).expect(200);

      expect(body).toMatchObject({
        depositoOriginal: 20,
        montoRetenido: 5,
        montoLiberado: 15,
        estadoGarantia: 'RETENIDA',
        motivo: 'Daño reportado',
      });
      const saved = await prisma.depositResolution.findUniqueOrThrow({
        where: { reservationId: id },
      });
      expect(saved.status).toBe('RETENIDA');
      expect(saved.retainedAmount.toFixed(2)).toBe('5.00');
      expect(saved.releasedAmount.toFixed(2)).toBe('15.00');
      expect(saved.reason).toBe('Daño reportado');
    });

    it('C09: retener sin motivo, o con el motivo en blanco, es 400 y no guarda', async () => {
      const id = await devuelta();

      await resolver(id, { montoRetenido: 5 }).expect(400);
      await resolver(id, { montoRetenido: 5, motivo: '   ' }).expect(400);

      await sinResolver(id);
    });

    it('C10: con daños también se puede liberar todo (retención 0, LIBERADA)', async () => {
      const id = await devuelta();

      const { body } = await resolver(id, { montoRetenido: 0 }).expect(200);

      expect(body).toMatchObject({
        montoLiberado: 20,
        estadoGarantia: 'LIBERADA',
      });
    });

    it('C11: retener todo el depósito (20 de 20) libera 0 y queda RETENIDA', async () => {
      const id = await devuelta();

      const { body } = await resolver(id, {
        montoRetenido: 20,
        motivo: 'Pérdida total',
      }).expect(200);

      expect(body).toMatchObject({
        montoRetenido: 20,
        montoLiberado: 0,
        estadoGarantia: 'RETENIDA',
      });
    });
  });

  describe('criterio 4: lo que el sistema no deja resolver', () => {
    it('C12: retención 25 de un depósito de 20 es rechazada con su mensaje', async () => {
      const id = await devuelta();

      const { body } = await resolver(id, {
        montoRetenido: 25,
        motivo: 'Daño',
      }).expect(422);

      expect(body.message).toBe(
        'El monto retenido no puede superar el depósito',
      );
      expect(body.codigo).toBe('RETENCION_SUPERA_DEPOSITO');
      await sinResolver(id);
    });

    it('C13: sin devolución registrada responde «Primero registra la devolución»', async () => {
      const id = await newReservation();

      const { body } = await resolver(id, { montoRetenido: 0 }).expect(422);

      expect(body.message).toBe('Primero registra la devolución');
      expect(body.codigo).toBe('DEVOLUCION_NO_REGISTRADA');
      await sinResolver(id);
    });

    it('C14: un monto negativo o con tres decimales es 400', async () => {
      const id = await devuelta();

      await resolver(id, { montoRetenido: -1, motivo: 'Daño' }).expect(400);
      await resolver(id, { montoRetenido: 1.234, motivo: 'Daño' }).expect(400);

      await sinResolver(id);
    });
  });

  describe('criterio 5: con devolución y garantía, la reserva aparece COMPLETADA', () => {
    it('C15: pasa de EN_CURSO a COMPLETADA solo al resolver, y así la ven los dos', async () => {
      const id = await newReservation();
      expect((await garantia(id).expect(200)).body).toMatchObject({
        estadoGarantia: 'PENDIENTE',
        estadoReserva: 'EN_CURSO',
      });

      await devolver(id, SIN_DANOS).expect(201);
      expect((await garantia(id).expect(200)).body.estadoReserva).toBe(
        'EN_CURSO',
      );

      await resolver(id, { montoRetenido: 0 }).expect(200);

      expect(await estado(id)).toBe('COMPLETADA');
      for (const who of [landlord, tenant]) {
        expect((await garantia(id, who).expect(200)).body).toMatchObject({
          estadoGarantia: 'LIBERADA',
          estadoReserva: 'COMPLETADA',
        });
      }
    });

    it('C16: una segunda resolución es 409 y no cambia los importes', async () => {
      const id = await devuelta();
      await resolver(id, { montoRetenido: 5, motivo: 'Daño' }).expect(200);

      await resolver(id, { montoRetenido: 0 }).expect(409);

      expect(await resoluciones(id)).toBe(1);
      expect((await garantia(id).expect(200)).body).toMatchObject({
        montoRetenido: 5,
        montoLiberado: 15,
        estadoGarantia: 'RETENIDA',
      });
    });

    it('C17: dos resoluciones simultáneas: un 200, un 409 y un solo aviso', async () => {
      const id = await devuelta();

      const [a, b] = await Promise.all([
        resolver(id, { montoRetenido: 5, motivo: 'Daño' }),
        resolver(id, { montoRetenido: 0 }),
      ]);

      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
      expect(await resoluciones(id)).toBe(1);
      expect(await avisos(id, tenant)).toHaveLength(1);
    });
  });

  describe('criterio 6: el arrendatario recibe el aviso', () => {
    it('C18: «Depósito de garantía resuelto» llega a su bandeja con el bien, lo liberado y lo retenido', async () => {
      const id = await devuelta();

      await resolver(id, { montoRetenido: 5, motivo: 'Daño' }).expect(200);

      const [aviso, ...otros] = await avisos(id, tenant);
      expect(otros).toHaveLength(0);
      expect(aviso.titulo).toBe('Depósito de garantía resuelto');
      expect(aviso.moduloOrigen).toBe('PAGOS_GARANTIA');
      expect(aviso.referencia).toEqual({ tipo: 'reserva', id });
      expect(aviso.leidaAt).toBeNull();
      expect(aviso.mensaje).toContain(BIEN);
      expect(aviso.mensaje).toContain('monto liberado $15.00');
      expect(aviso.mensaje).toContain('monto retenido $5.00');
      // Solo para el arrendatario.
      expect(await avisos(id, landlord)).toHaveLength(0);
    });

    it('C19: una resolución rechazada no manda aviso', async () => {
      const id = await devuelta();

      await resolver(id, { montoRetenido: 25, motivo: 'Daño' }).expect(422);

      expect(await avisos(id, tenant)).toHaveLength(0);
    });
  });

  describe('permisos de cada rol', () => {
    it('C20: el arrendatario no registra la devolución ni resuelve la garantía (403)', async () => {
      const id = await newReservation();
      await devolver(id, SIN_DANOS, tenant).expect(403);
      expect(await devoluciones(id)).toBe(0);

      await devolver(id, SIN_DANOS).expect(201);
      await resolver(id, { montoRetenido: 0 }, tenant).expect(403);
      await sinResolver(id);
    });

    it('C21: otro arrendador no registra ni resuelve (403) y al consultar recibe 404', async () => {
      const id = await newReservation();
      await devolver(id, SIN_DANOS, otherLandlord).expect(403);

      await devolver(id, SIN_DANOS).expect(201);
      await resolver(id, { montoRetenido: 0 }, otherLandlord).expect(403);
      // La consulta de una reserva ajena responde igual que si no existiera.
      await garantia(id, otherLandlord).expect(404);
      await sinResolver(id);
    });

    it('C22: sin sesión es 401 y con una reserva que no existe es 404', async () => {
      const id = await newReservation();
      await devolver(id, SIN_DANOS, null).expect(401);
      await resolver(id, { montoRetenido: 0 }, null).expect(401);

      const noExiste = randomUUID();
      await devolver(noExiste, SIN_DANOS).expect(404);
      await resolver(noExiste, { montoRetenido: 0 }).expect(404);
    });
  });
});
