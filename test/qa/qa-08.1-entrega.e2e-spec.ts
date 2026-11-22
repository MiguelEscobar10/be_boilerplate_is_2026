import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-08.1 (MP4-75): plan de pruebas de la entrega y de la prevención de
 * entregas indebidas (H08).
 *
 * Cada caso tiene un id (E01, E02...) que se repite en la evidencia de
 * docs/qa/QA-08.1-entrega.md. Los casos que prueban un criterio de aceptación
 * de H08 empiezan con «ACn:» y conservan su id al final, entre paréntesis.
 * Además de la respuesta HTTP, cada caso revisa lo
 * que quedó guardado: el estado de la reserva, las filas de `deliveries` y
 * `delivery_photos`, y los archivos en la carpeta de fotos.
 *
 * Las reservas se crean directo en la base en el estado que cada caso necesita:
 * la aprobación (BE-04.1) todavía no está en main.
 */

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const PDF = Buffer.from('%PDF-1.4 no soy una foto');
const HOUR = 3_600_000;
const byText = (a: string, b: string) => a.localeCompare(b);
const NOTA = 'Proyector completo, con control y cables';

type Session = { token: string; userId: string };
type Status =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'EN_CURSO'
  | 'COMPLETADA';

describe('H08. Registrar la entrega de un equipo o espacio', () => {
  const email = `qa-08.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let uploadsDir: string;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let otherTenant: Session;
  const listings: Record<'EQUIPO' | 'ESPACIO', string> = {
    EQUIPO: '',
    ESPACIO: '',
  };
  let accounts = 0;

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

  /** Reserva del arrendatario, empezada hace una hora por defecto. */
  const reservation = (
    status: Status = 'CONFIRMADA',
    {
      startAt = new Date(Date.now() - HOUR),
      kind = 'EQUIPO' as 'EQUIPO' | 'ESPACIO',
    } = {},
  ) =>
    prisma.reservation.create({
      data: {
        listingId: listings[kind],
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
    { nota = NOTA as string | null, fotos = [] as Buffer[] } = {},
  ) => {
    const req = http().post(`/api/v1/reservas/${reservationId}/entrega`);
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    if (nota !== null) void req.field('nota', nota);
    fotos.forEach((buffer, i) => void req.attach('fotos', buffer, `f${i}.jpg`));
    return req;
  };

  const consult = (reservationId: string, who: Session | null) => {
    const req = http().get(`/api/v1/reservas/${reservationId}/entrega`);
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    return req;
  };

  const statusOf = async (id: string) =>
    (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;

  const deliveriesOf = (reservationId: string) =>
    prisma.delivery.findMany({
      where: { reservationId },
      include: { photos: true },
    });

  const storedPhotos = async () =>
    readdir(join(uploadsDir, 'entregas')).catch(() => [] as string[]);

  /** Lo guardado no cambió: mismo estado, sin entrega y sin archivos nuevos. */
  const expectUntouched = async (
    reservationId: string,
    status: Status,
    filesBefore: string[],
  ) => {
    expect(await statusOf(reservationId)).toBe(status);
    expect(await deliveriesOf(reservationId)).toHaveLength(0);
    expect((await storedPhotos()).sort(byText)).toEqual(
      [...filesBefore].sort(byText),
    );
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    uploadsDir = await mkdtemp(join(tmpdir(), 'uploads-'));
    process.env.UPLOADS_DIR = uploadsDir;

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
    otherTenant = await account('ARRENDATARIO');
    for (const type of ['EQUIPO', 'ESPACIO'] as const) {
      listings[type] = (
        await prisma.listing.create({
          data: {
            landlordId: landlord.userId,
            type,
            name: type === 'EQUIPO' ? 'Proyector' : 'Sala de reuniones',
            location: 'Antiguo Cuscatlán',
            rateAmount: '15.00',
            rateUnit: 'DIA',
          },
        })
      ).id;
    }
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

  describe('registro permitido', () => {
    it('AC1: equipo CONFIRMADO con el inicio alcanzado: 201, queda la fecha, la nota y las fotos del estado inicial (E01)', async () => {
      const r = await reservation();
      const before = Date.now();

      const { body } = await deliver(r.id, landlord, {
        fotos: [JPG, PNG],
      }).expect(201);

      expect(body).toEqual({
        entregaId: expect.any(String),
        reservaId: r.id,
        estadoReserva: 'EN_CURSO',
      });
      expect(await statusOf(r.id)).toBe('EN_CURSO');
      const [row] = await deliveriesOf(r.id);
      expect(row).toMatchObject({
        id: body.entregaId,
        initialConditionNote: NOTA,
        registeredById: landlord.userId,
      });
      // Fecha y hora reales del registro, no la del inicio de la reserva.
      expect(row.deliveredAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(row.photos.map((p) => p.position).sort((a, b) => a - b)).toEqual([
        0, 1,
      ]);
      const files = await storedPhotos();
      for (const photo of row.photos) {
        expect(files).toContain(photo.path.split('/').pop());
      }
    });

    it('AC2: tras registrar la entrega, el arrendatario y el arrendador consultan la reserva y la ven EN_CURSO (E22)', async () => {
      const r = await reservation();

      await deliver(r.id).expect(201);

      for (const who of [tenant, landlord]) {
        const { body } = await http()
          .get(`/api/v1/reservas/${r.id}`)
          .set('Authorization', `Bearer ${who.token}`)
          .expect(200);
        expect(body).toMatchObject({ id: r.id, estado: 'EN_CURSO' });
      }
    });

    it('E02: espacio CONFIRMADO: el inicio de uso se registra igual y pasa a EN_CURSO', async () => {
      const r = await reservation('CONFIRMADA', { kind: 'ESPACIO' });

      await deliver(r.id, landlord, { nota: 'Sala limpia, 12 sillas' }).expect(
        201,
      );

      expect(await statusOf(r.id)).toBe('EN_CURSO');
      const [row] = await deliveriesOf(r.id);
      expect(row.initialConditionNote).toBe('Sala limpia, 12 sillas');
      expect(row.photos).toHaveLength(0);
    });

    it('E03: justo en la hora de inicio ya se puede registrar', async () => {
      const r = await reservation('CONFIRMADA', {
        startAt: new Date(Date.now() - 1_000),
      });
      await deliver(r.id).expect(201);
      expect(await statusOf(r.id)).toBe('EN_CURSO');
    });

    it('E04: la nota se guarda sin espacios sobrantes; 500 caracteres y 5 fotos se aceptan', async () => {
      const r = await reservation();
      const nota = 'a'.repeat(500);

      await deliver(r.id, landlord, {
        nota: `  ${nota}  `,
        fotos: [JPG, PNG, JPG, PNG, JPG],
      }).expect(201);

      const [row] = await deliveriesOf(r.id);
      expect(row.initialConditionNote).toBe(nota);
      expect(row.photos).toHaveLength(5);
    });
  });

  describe('prevención de entregas indebidas', () => {
    it('AC5: antes del inicio responde 422 ENTREGA_NO_HABILITADA con la fecha desde la que se habilita y no cambia nada (E05)', async () => {
      const startAt = new Date(Date.now() + 24 * HOUR);
      const r = await reservation('CONFIRMADA', { startAt });
      const files = await storedPhotos();

      const { body } = await deliver(r.id, landlord, { fotos: [JPG] }).expect(
        422,
      );

      expect(body).toMatchObject({
        codigo: 'ENTREGA_NO_HABILITADA',
        disponibleDesde: startAt.toISOString(),
      });
      await expectUntouched(r.id, 'CONFIRMADA', files);
    });

    it.each(['PENDIENTE', 'RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
      'AC3: una reserva %s (no CONFIRMADA) responde 409 y no se inicia (E06)',
      async (status) => {
        const r = await reservation(status);
        const files = await storedPhotos();

        const { body } = await deliver(r.id, landlord, {
          fotos: [JPG],
        }).expect(409);

        expect(body.message).toContain(status);
        await expectUntouched(r.id, status, files);
      },
    );

    it('AC4: una segunda entrega responde 409, conserva la primera y no guarda fotos nuevas (E07)', async () => {
      const r = await reservation();
      await deliver(r.id, landlord, { fotos: [JPG] }).expect(201);
      const files = await storedPhotos();

      const { body } = await deliver(r.id, landlord, {
        nota: 'Otra nota',
        fotos: [PNG],
      }).expect(409);

      expect(body.message).toContain('ya se registró');
      const rows = await deliveriesOf(r.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].initialConditionNote).toBe(NOTA);
      expect(rows[0].photos).toHaveLength(1);
      expect((await storedPhotos()).sort(byText)).toEqual(
        [...files].sort(byText),
      );
    });

    it('E08: con cinco envíos simultáneos solo uno gana y no quedan fotos huérfanas', async () => {
      const r = await reservation();
      const files = await storedPhotos();

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          deliver(r.id, landlord, { fotos: [JPG, PNG] }),
        ),
      );

      const codes = results.map((res) => res.status).sort((a, b) => a - b);
      expect(codes).toEqual([201, 409, 409, 409, 409]);
      const rows = await deliveriesOf(r.id);
      expect(rows).toHaveLength(1);
      expect(await statusOf(r.id)).toBe('EN_CURSO');
      // Solo quedan las dos fotos de la entrega ganadora.
      expect((await storedPhotos()).length).toBe(files.length + 2);
    });

    it('AC3: otro arrendador recibe 403 y la reserva ajena no se inicia (E09)', async () => {
      const r = await reservation();
      const files = await storedPhotos();

      const { body } = await deliver(r.id, otherLandlord).expect(403);

      expect(body.message).toContain('Solo el arrendador');
      await expectUntouched(r.id, 'CONFIRMADA', files);
    });

    it('E10: el arrendatario de la reserva no puede registrar la entrega (403)', async () => {
      const r = await reservation();
      const files = await storedPhotos();

      await deliver(r.id, tenant).expect(403);

      await expectUntouched(r.id, 'CONFIRMADA', files);
    });

    it('E11: sin sesión responde 401 y no cambia nada', async () => {
      const r = await reservation();
      const files = await storedPhotos();

      await deliver(r.id, null).expect(401);

      await expectUntouched(r.id, 'CONFIRMADA', files);
    });

    it('E12: una reserva inexistente responde 404 y un id que no es UUID 400', async () => {
      await deliver(randomUUID()).expect(404);
      await deliver('no-es-uuid').expect(400);
    });
  });

  describe('validación de la nota y las fotos', () => {
    it.each([
      ['E13', 'sin nota', null, [], 'obligatoria'],
      ['E14', 'con una nota en blanco', '   ', [], 'obligatoria'],
      ['E15', 'con una nota de 501 caracteres', 'a'.repeat(501), [], '500'],
      ['E16', 'con 6 fotos', NOTA, [JPG, PNG, JPG, PNG, JPG, PNG], '5 fotos'],
      ['E17', 'con un PDF como foto', NOTA, [PDF], 'no es JPG ni PNG'],
    ] as const)(
      '%s: %s responde 400 con un mensaje claro y no guarda nada',
      async (_, __, nota, fotos, message) => {
        const r = await reservation();
        const files = await storedPhotos();

        const { body } = await deliver(r.id, landlord, {
          nota,
          fotos: [...fotos],
        }).expect(400);

        expect(String(body.message)).toContain(message);
        await expectUntouched(r.id, 'CONFIRMADA', files);
      },
    );

    it('E18: una foto de más de 5 MB responde 400 y no guarda nada', async () => {
      const r = await reservation();
      const files = await storedPhotos();
      const big = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]);

      const { body } = await deliver(r.id, landlord, { fotos: [big] }).expect(
        400,
      );

      expect(String(body.message)).toContain('5 MB');
      await expectUntouched(r.id, 'CONFIRMADA', files);
    });
  });

  describe('consulta de la entrega', () => {
    it('E19: el arrendador y el arrendatario ven fecha, nota y fotos; la foto se sirve sin caché compartida', async () => {
      const r = await reservation();
      await deliver(r.id, landlord, { fotos: [PNG] }).expect(201);

      for (const who of [landlord, tenant]) {
        const { body } = await consult(r.id, who).expect(200);
        expect(body).toMatchObject({
          reservaId: r.id,
          entregadaAt: expect.any(String),
          nota: NOTA,
          fotos: [
            { orden: 0, url: `/api/v1/reservas/${r.id}/entrega/fotos/0` },
          ],
        });
        // No expone la ruta interna del archivo.
        const [row] = await deliveriesOf(r.id);
        expect(JSON.stringify(body)).not.toContain(row.photos[0].path);
      }

      const res = await http()
        .get(`/api/v1/reservas/${r.id}/entrega/fotos/0`)
        .set('Authorization', `Bearer ${tenant.token}`)
        .buffer(true)
        .parse((stream, done) => {
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    });

    it('E20: quien no participa recibe 404 en la entrega y en la foto; sin sesión, 401', async () => {
      const r = await reservation();
      await deliver(r.id, landlord, { fotos: [JPG] }).expect(201);

      for (const who of [otherLandlord, otherTenant]) {
        await consult(r.id, who).expect(404);
        await http()
          .get(`/api/v1/reservas/${r.id}/entrega/fotos/0`)
          .set('Authorization', `Bearer ${who.token}`)
          .expect(404);
      }
      await consult(r.id, null).expect(401);
      await http().get(`/api/v1/reservas/${r.id}/entrega/fotos/0`).expect(401);
    });

    it('E21: una reserva sin entrega responde 404 a sus participantes', async () => {
      const r = await reservation();
      await consult(r.id, landlord).expect(404);
      await consult(r.id, tenant).expect(404);
    });
  });
});
