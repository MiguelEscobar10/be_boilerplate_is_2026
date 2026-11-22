import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * Plan de pruebas, H03. Solicitar una reserva: pruebas de componente.
 *
 * Un `it('ACn: ...')` por criterio de aceptación de la historia y, al final,
 * los casos negativos. Cada prueba llama a la API real con el JWT de un login
 * real y revisa también lo que quedó guardado (reserva, aviso, disponibilidad).
 *
 * Corre contra la base `_test` (test/helpers/test-database.ts). Los correos
 * llevan un sufijo único por ejecución y en afterAll se borra solo lo creado.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Session = { token: string; userId: string };

describe('H03. Solicitar una reserva', () => {
  const email = `plan-h03-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let tenant: Session;
  let other: Session;
  let accounts = 0;
  // Cada caso usa días distintos (a partir de 2031) para que no se crucen.
  let nextDay = 0;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, who: Session | null) =>
    who ? req.set('Authorization', `Bearer ${who.token}`) : req;

  const account = async (
    rol: 'ARRENDATARIO' | 'ARRENDADOR',
    nombre: string,
  ) => {
    const address = `${rol.toLowerCase()}${++accounts}-${email}`;
    await http()
      .post('/api/v1/users')
      .send({ email: address, password, rol, nombre, telefono: '70001234' })
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

  const newListing = async (
    extra: {
      rateAmount?: string;
      rateUnit?: 'HORA' | 'DIA' | 'NOCHE' | 'SEMANA';
      isActive?: boolean;
      requiresVerification?: boolean;
    } = {},
    owner = landlord,
  ) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.userId,
          type: 'EQUIPO',
          name: 'Proyector Epson',
          location: 'Antiguo Cuscatlán',
          rateAmount: extra.rateAmount ?? '15.00',
          rateUnit: extra.rateUnit ?? 'HORA',
          depositAmount: '20.00',
          isActive: extra.isActive ?? true,
          requiresVerification: extra.requiresVerification ?? false,
        },
      })
    ).id;

  /** Un día libre nuevo, a las 00:00 de El Salvador. */
  const freshDay = () =>
    new Date(Date.UTC(2031, 0, 1) + 6 * HOUR + nextDay++ * DAY);
  /** El instante como lo escribe la API, con la zona de El Salvador. */
  const iso = (d: Date) =>
    `${new Date(d.getTime() - 6 * HOUR).toISOString().slice(0, 19)}-06:00`;
  const at = (day: Date, hours: number) =>
    new Date(day.getTime() + hours * HOUR);

  const solicitar = (
    body: Record<string, unknown>,
    who: Session | null = tenant,
  ) => auth(http().post('/api/v1/reservas').send(body), who);
  const pedir = (
    listingId: string,
    start: Date,
    end: Date,
    who: Session | null = tenant,
  ) =>
    solicitar(
      { publicacionId: listingId, inicio: iso(start), fin: iso(end) },
      who,
    );
  const detalle = (id: string, who: Session | null = tenant) =>
    auth(http().get(`/api/v1/reservas/${id}`), who);

  const ocupar = (
    listingId: string,
    startAt: Date,
    endAt: Date,
    status: 'CONFIRMADA' | 'EN_CURSO' | 'PENDIENTE' = 'CONFIRMADA',
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: other.userId,
        startAt,
        endAt,
        status,
        rentalCost: '10.00',
        depositAmount: '0.00',
      },
    });

  const guardadas = (listingId: string) =>
    prisma.reservation.count({ where: { listingId, tenantId: tenant.userId } });
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

    landlord = await account('ARRENDADOR', 'Henry Arrendador');
    tenant = await account('ARRENDATARIO', 'Ana Pérez');
    other = await account('ARRENDATARIO', 'Bruno Díaz');
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  it('AC1: con una publicación activa y fechas libres se crea una reserva PENDIENTE', async () => {
    const id = await newListing();
    const day = freshDay();

    const res = await pedir(id, at(day, 9), at(day, 12)).expect(201);

    expect(res.body).toMatchObject({ estado: 'PENDIENTE' });
    const guardada = await prisma.reservation.findUniqueOrThrow({
      where: { id: res.body.id as string },
    });
    expect(guardada).toMatchObject({
      status: 'PENDIENTE',
      tenantId: tenant.userId,
      startAt: at(day, 9),
      endAt: at(day, 12),
    });
  });

  it('AC2: el detalle muestra fechas, estado y costo con dos decimales; el depósito va aparte', async () => {
    const id = await newListing({ rateAmount: '15.10' });
    const day = freshDay();
    const creada = await pedir(id, at(day, 9), at(day, 12)).expect(201);

    const res = await detalle(creada.body.id as string).expect(200);

    expect(res.body).toMatchObject({
      estado: 'PENDIENTE',
      inicio: iso(at(day, 9)),
      fin: iso(at(day, 12)),
      costoAlquiler: '45.30',
      depositoMonto: '20.00',
    });
  });

  it('AC3: con fin igual o anterior al inicio se rechaza con un mensaje que explica el motivo', async () => {
    const id = await newListing();
    const day = freshDay();

    for (const [inicio, fin] of [
      [at(day, 12), at(day, 9)],
      [at(day, 9), at(day, 9)],
    ]) {
      const res = await pedir(id, inicio, fin).expect(400);
      expect(String(res.body.message)).toMatch(/fin|inicio/i);
    }
    expect(await guardadas(id)).toBe(0);
  });

  it('AC4: con un inicio que ya pasó no se puede reservar y se explica el motivo', async () => {
    const id = await newListing();

    const res = await solicitar({
      publicacionId: id,
      inicio: '2020-01-10T09:00:00-06:00',
      fin: '2020-01-10T12:00:00-06:00',
    }).expect(400);

    expect(res.body).toMatchObject({
      codigo: 'FECHA_PASADA',
      message: 'La fecha de inicio ya pasó. Elige un inicio a partir de ahora.',
    });
    expect(await guardadas(id)).toBe(0);
  });

  it('AC5: con fechas que chocan con una CONFIRMADA, una EN_CURSO o un bloqueo no se envía la solicitud', async () => {
    for (const status of ['CONFIRMADA', 'EN_CURSO'] as const) {
      const id = await newListing();
      const day = freshDay();
      await ocupar(id, at(day, 9), at(day, 12), status);

      const res = await pedir(id, at(day, 10), at(day, 11)).expect(409);

      expect(res.body).toMatchObject({ codigo: 'PERIODO_NO_DISPONIBLE' });
      expect(String(res.body.message)).toMatch(/no está disponible/);
      expect(await guardadas(id), status).toBe(0);
    }

    const id = await newListing();
    const day = freshDay();
    await prisma.availabilityBlock.create({
      data: {
        listingId: id,
        createdById: landlord.userId,
        startAt: at(day, 0),
        endAt: at(day, 24),
        reason: 'Mantenimiento privado',
      },
    });
    const res = await pedir(id, at(day, 9), at(day, 12)).expect(409);
    expect(res.body).toMatchObject({ codigo: 'PERIODO_NO_DISPONIBLE' });
    expect(await guardadas(id)).toBe(0);
  });

  it('AC6: si la publicación pide verificación y la identidad no está verificada, no se envía y se ve el motivo', async () => {
    const id = await newListing({ requiresVerification: true });
    const day = freshDay();

    const res = await pedir(id, at(day, 9), at(day, 12)).expect(422);

    expect(res.body).toMatchObject({ codigo: 'VERIFICACION_REQUERIDA' });
    expect(String(res.body.message).length).toBeGreaterThan(0);
    expect(await guardadas(id)).toBe(0);
  });

  it('AC7: al registrarse la solicitud, el arrendador recibe «Nueva solicitud de reserva» con el bien y las fechas', async () => {
    const id = await newListing();
    const day = freshDay();

    const res = await pedir(id, at(day, 9), at(day, 12)).expect(201);

    const avisos = await prisma.notification.findMany({
      where: { userId: landlord.userId, referenceId: res.body.id as string },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].title).toBe('Nueva solicitud de reserva');
    expect(avisos[0].message).toContain('Proyector Epson');
    const dia = new Date(at(day, 9).getTime() - 6 * HOUR);
    const fecha = `${String(dia.getUTCDate()).padStart(2, '0')}/${String(dia.getUTCMonth() + 1).padStart(2, '0')}/${dia.getUTCFullYear()}`;
    expect(avisos[0].message).toContain(fecha);
  });

  describe('casos negativos', () => {
    it('NEG1: una solicitud rechazada no deja reserva ni avisa al arrendador', async () => {
      const id = await newListing();
      const day = freshDay();
      await ocupar(id, at(day, 9), at(day, 12));
      const antes = await prisma.notification.count({
        where: { userId: landlord.userId },
      });

      await pedir(id, at(day, 10), at(day, 11)).expect(409);

      expect(await guardadas(id)).toBe(0);
      expect(
        await prisma.notification.count({ where: { userId: landlord.userId } }),
      ).toBe(antes);
    });

    it('NEG2: sin sesión es 401 y un arrendador no puede solicitar (403)', async () => {
      const id = await newListing();
      const day = freshDay();

      await pedir(id, at(day, 9), at(day, 12), null).expect(401);
      await pedir(id, at(day, 9), at(day, 12), landlord).expect(403);
    });

    it('NEG3: una publicación inexistente o desactivada da 404', async () => {
      const day = freshDay();
      const apagada = await newListing({ isActive: false });

      await pedir(randomUUID(), at(day, 9), at(day, 12)).expect(404);
      await pedir(apagada, at(day, 9), at(day, 12)).expect(404);
    });

    it('NEG4: la reserva de otra persona no se puede ver (404)', async () => {
      const id = await newListing();
      const day = freshDay();
      const creada = await pedir(id, at(day, 9), at(day, 12)).expect(201);

      await detalle(creada.body.id as string, other).expect(404);
    });
  });
});
