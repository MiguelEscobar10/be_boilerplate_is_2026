import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

/**
 * Registro de la entrega e inicio del alquiler (BE-08.1).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`) y guarda las fotos en una carpeta temporal. Las reservas se crean
 * directo en la base en el estado que cada caso necesita: la aprobación
 * (BE-04.1) todavía no está en main.
 */
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const PDF = Buffer.from('%PDF-1.4 no soy una foto');

const HOUR = 3_600_000;

describe('entregas (BE-08.1)', () => {
  const email = `be-08.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let uploadsDir: string;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let tenant: Session;
  let listingId: string;
  let accounts = 0;

  type Session = { token: string; userId: string };
  type Status = 'PENDIENTE' | 'CONFIRMADA' | 'RECHAZADA' | 'EN_CURSO';

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

  /** Reserva del bien del arrendador, empezada hace una hora por defecto. */
  const newReservation = (
    status: Status = 'CONFIRMADA',
    startAt = new Date(Date.now() - HOUR),
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt,
        endAt: new Date(startAt.getTime() + 48 * HOUR),
        status,
        rentalCost: '30.00',
        depositAmount: '10.00',
      },
    });

  const deliver = (
    reservationId: string,
    who: Session | null = landlord,
    { nota = 'Equipo completo, sin rayones', fotos = [] as Buffer[] } = {},
  ) => {
    const req = http().post(`/api/v1/reservas/${reservationId}/entrega`);
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    if (nota !== null) void req.field('nota', nota);
    fotos.forEach((buffer, i) => void req.attach('fotos', buffer, `f${i}.jpg`));
    return req;
  };

  const statusOf = async (id: string) =>
    (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;

  const storedPhotos = async () =>
    readdir(join(uploadsDir, 'entregas')).catch(() => [] as string[]);

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    uploadsDir = await mkdtemp(join(tmpdir(), 'uploads-'));
    process.env.UPLOADS_DIR = uploadsDir;

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
    tenant = await account('ARRENDATARIO');
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
    await prisma.delivery.deleteMany({
      where: { reservation: { tenant: { email: { endsWith: email } } } },
    });
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  describe('POST /reservas/{id}/entrega', () => {
    it('registra la entrega (201), guarda la nota y las fotos, y la reserva pasa a EN_CURSO', async () => {
      const reservation = await newReservation();

      const { body } = await deliver(reservation.id, landlord, {
        nota: '  Completo, con estuche  ',
        fotos: [JPG, PNG],
      }).expect(201);

      expect(body).toEqual({
        entregaId: expect.any(String),
        reservaId: reservation.id,
        estadoReserva: 'EN_CURSO',
      });
      expect(await statusOf(reservation.id)).toBe('EN_CURSO');
      const saved = await prisma.delivery.findUniqueOrThrow({
        where: { id: body.entregaId },
        include: { photos: { orderBy: { position: 'asc' } } },
      });
      expect(saved.initialConditionNote).toBe('Completo, con estuche');
      expect(saved.registeredById).toBe(landlord.userId);
      expect(saved.deliveredAt).toBeInstanceOf(Date);
      expect(saved.photos.map((p) => p.position)).toEqual([0, 1]);
      expect(saved.photos[1].path).toMatch(/^entregas\/[0-9a-f-]+\.png$/);
    });

    it('acepta la entrega sin fotos (son opcionales)', async () => {
      const reservation = await newReservation();
      await deliver(reservation.id).expect(201);
    });

    it('una segunda entrega responde 409 y no duplica', async () => {
      const reservation = await newReservation();
      await deliver(reservation.id).expect(201);

      await deliver(reservation.id).expect(409);

      expect(
        await prisma.delivery.count({
          where: { reservationId: reservation.id },
        }),
      ).toBe(1);
    });

    it('con dos entregas simultáneas solo una gana y no quedan fotos huérfanas', async () => {
      const reservation = await newReservation();
      const before = (await storedPhotos()).length;

      const results = await Promise.all([
        deliver(reservation.id, landlord, { fotos: [JPG] }),
        deliver(reservation.id, landlord, { fotos: [JPG] }),
      ]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect((await storedPhotos()).length).toBe(before + 1);
    });

    it.each(['PENDIENTE', 'RECHAZADA'] as const)(
      'una reserva %s no se puede iniciar (409) y no cambia',
      async (status) => {
        const reservation = await newReservation(status);

        await deliver(reservation.id).expect(409);

        expect(await statusOf(reservation.id)).toBe(status);
      },
    );

    it('antes de la fecha de inicio responde 422 ENTREGA_NO_HABILITADA con la fecha, y no cambia el estado', async () => {
      const startAt = new Date(Date.now() + 2 * HOUR);
      const reservation = await newReservation('CONFIRMADA', startAt);

      const res = await deliver(reservation.id).expect(422);

      expect(res.body).toMatchObject({
        codigo: 'ENTREGA_NO_HABILITADA',
        disponibleDesde: startAt.toISOString(),
      });
      expect(await statusOf(reservation.id)).toBe('CONFIRMADA');
      expect(
        await prisma.delivery.count({
          where: { reservationId: reservation.id },
        }),
      ).toBe(0);
    });

    it.each([
      ['sin nota', { nota: null as unknown as string }],
      ['con la nota vacía', { nota: '   ' }],
      ['con una nota de 501 caracteres', { nota: 'a'.repeat(501) }],
      ['con más de 5 fotos', { fotos: Array.from({ length: 6 }, () => JPG) }],
      ['con un PDF como foto', { fotos: [PDF] }],
    ])('responde 400 %s y no inicia la reserva', async (_, datos) => {
      const reservation = await newReservation();
      const before = await storedPhotos();

      await deliver(reservation.id, landlord, datos).expect(400);

      expect(await statusOf(reservation.id)).toBe('CONFIRMADA');
      expect(await storedPhotos()).toEqual(before);
    });

    it('acepta una nota de 500 caracteres y 5 fotos', async () => {
      const reservation = await newReservation();
      await deliver(reservation.id, landlord, {
        nota: 'a'.repeat(500),
        fotos: Array.from({ length: 5 }, () => JPG),
      }).expect(201);
    });

    it('responde 400 con una foto de más de 5 MB', async () => {
      const reservation = await newReservation();
      const big = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]);

      const res = await deliver(reservation.id, landlord, {
        fotos: [big],
      }).expect(400);
      expect(res.body.message).toMatch(/5 MB/);
    });

    it('responde 403 a otro arrendador (reserva ajena) y no la inicia', async () => {
      const reservation = await newReservation();
      const other = await account('ARRENDADOR');

      await deliver(reservation.id, other).expect(403);

      expect(await statusOf(reservation.id)).toBe('CONFIRMADA');
    });

    it('responde 403 al arrendatario', async () => {
      const reservation = await newReservation();
      await deliver(reservation.id, tenant).expect(403);
    });

    it('responde 401 sin sesión, 404 si no existe y 400 si el id no es UUID', async () => {
      const reservation = await newReservation();
      await deliver(reservation.id, null).expect(401);
      await deliver(randomUUID()).expect(404);
      await deliver('91').expect(400);
    });
  });

  describe('GET /reservas/{id}/entrega', () => {
    it('el arrendador y el arrendatario ven la entrega con sus fotos', async () => {
      const reservation = await newReservation();
      await deliver(reservation.id, landlord, { fotos: [JPG] }).expect(201);

      for (const who of [landlord, tenant]) {
        const { body } = await http()
          .get(`/api/v1/reservas/${reservation.id}/entrega`)
          .set('Authorization', `Bearer ${who.token}`)
          .expect(200);
        expect(body).toMatchObject({
          reservaId: reservation.id,
          nota: 'Equipo completo, sin rayones',
          fotos: [
            {
              orden: 0,
              url: `/api/v1/reservas/${reservation.id}/entrega/fotos/0`,
            },
          ],
        });
      }

      const photo = await http()
        .get(`/api/v1/reservas/${reservation.id}/entrega/fotos/0`)
        .set('Authorization', `Bearer ${tenant.token}`)
        .expect(200);
      expect(photo.headers['content-type']).toContain('image/jpeg');
    });

    it('responde 404 a quien no participa, a una reserva sin entrega y a una foto que no existe', async () => {
      const delivered = await newReservation();
      await deliver(delivered.id).expect(201);
      const pending = await newReservation();
      const other = await account('ARRENDATARIO');

      await http()
        .get(`/api/v1/reservas/${delivered.id}/entrega`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404);
      await http()
        .get(`/api/v1/reservas/${delivered.id}/entrega/fotos/0`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404);
      await http()
        .get(`/api/v1/reservas/${pending.id}/entrega`)
        .set('Authorization', `Bearer ${landlord.token}`)
        .expect(404);
      await http()
        .get(`/api/v1/reservas/${delivered.id}/entrega/fotos/3`)
        .set('Authorization', `Bearer ${landlord.token}`)
        .expect(404);
    });
  });
});
