import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Endpoints de verificación de identidad (BE-07.1).
 *
 * Levanta la app completa contra la base de pruebas (misma regla que las
 * demás: local y terminada en `_test`) y guarda los documentos en una carpeta
 * temporal que se borra al final.
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base)
    throw new Error('Definí TEST_DATABASE_URL o DATABASE_URL.');

  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(
      `La base de pruebas debe ser local (host: ${url.hostname}).`,
    );
  }
  if (!url.pathname.slice(1).endsWith('_test')) {
    throw new Error(
      `La base de pruebas debe terminar en _test (es ${url.pathname.slice(1)}).`,
    );
  }
  return url.toString();
}

// Archivos mínimos: solo importa la firma de los primeros bytes.
const PDF = Buffer.from('%PDF-1.4 documento de identidad');
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const TXT = Buffer.from('no soy un documento');

const BASE = '/api/v1/usuarios/me/verificaciones';

describe('verificación de identidad (BE-07.1)', () => {
  const email = `be-07.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let uploadsDir: string;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;

  /** Registra una cuenta con el rol dado y devuelve su token. */
  let accounts = 0;
  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `${rol === 'ARRENDADOR' ? 'dueno' : 'inquilino'}${++accounts}-${email}`;
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        email: address,
        password,
        rol,
        nombre: 'Ricardo Pineda',
        telefono: '70001234',
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: login.body.accessToken as string, userId: user.id };
  };

  const send = (token: string, file = PDF, name = 'dui.pdf') =>
    request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', `Bearer ${token}`)
      .attach('documento', file, name);

  const latest = (token: string) =>
    request(app.getHttpServer())
      .get(`${BASE}/ultima`)
      .set('Authorization', `Bearer ${token}`);

  const storedFiles = async () =>
    readdir(join(uploadsDir, 'verificaciones')).catch(() => [] as string[]);

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
  });

  afterAll(async () => {
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  describe('POST /usuarios/me/verificaciones', () => {
    it('registra la solicitud en PENDIENTE (201) y guarda el archivo en privado', async () => {
      const { token, userId } = await account('ARRENDATARIO');

      const { body } = await send(token).expect(201);

      expect(body).toEqual({ id: expect.any(String), estado: 'PENDIENTE' });
      const saved = await prisma.identityVerification.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(saved.userId).toBe(userId);
      expect(saved.documentKey).toMatch(/^verificaciones\/[0-9a-f-]+\.pdf$/);
      expect(await storedFiles()).toContain(saved.documentKey.split('/').pop());
    });

    it.each([
      ['PNG', PNG, 'dui.png', 'png'],
      ['JPG', JPG, 'dui.jpg', 'jpg'],
    ])('acepta un documento %s', async (_, file, name, ext) => {
      const { token } = await account('ARRENDATARIO');

      const { body } = await send(token, file, name).expect(201);
      const saved = await prisma.identityVerification.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(saved.documentKey.endsWith(`.${ext}`)).toBe(true);
    });

    it('responde 409 si ya tiene una PENDIENTE y no registra otra', async () => {
      const { token, userId } = await account('ARRENDATARIO');
      await send(token).expect(201);
      const before = await storedFiles();

      const res = await send(token).expect(409);

      expect(res.body.message).toMatch(/PENDIENTE/);
      expect(
        await prisma.identityVerification.count({ where: { userId } }),
      ).toBe(1);
      expect(await storedFiles()).toEqual(before);
    });

    it('con dos envíos simultáneos registra solo una PENDIENTE', async () => {
      const { token, userId } = await account('ARRENDATARIO');

      const results = await Promise.all([send(token), send(token)]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(
        await prisma.identityVerification.count({ where: { userId } }),
      ).toBe(1);
    });

    it('acepta una solicitud nueva después de una RECHAZADA', async () => {
      const { token, userId } = await account('ARRENDATARIO');
      const reviewer = await account('ARRENDADOR'); // solo para tener un id distinto
      const { body } = await send(token).expect(201);
      await prisma.identityVerification.update({
        where: { id: body.id },
        data: {
          status: 'RECHAZADA',
          reviewedById: reviewer.userId,
          reviewedAt: new Date(),
        },
      });

      await send(token).expect(201);
      expect(
        await prisma.identityVerification.count({ where: { userId } }),
      ).toBe(2);
    });

    it('rechaza con 400 un archivo que no es JPG, PNG ni PDF, aunque diga .pdf', async () => {
      const { token, userId } = await account('ARRENDATARIO');

      const res = await send(token, TXT, 'trampa.pdf').expect(400);

      expect(res.body.message).toMatch(/no es JPG, PNG ni PDF/);
      expect(
        await prisma.identityVerification.count({ where: { userId } }),
      ).toBe(0);
    });

    it('rechaza con 400 un archivo de más de 5 MB', async () => {
      const { token, userId } = await account('ARRENDATARIO');
      const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);

      const res = await send(token, big, 'grande.pdf').expect(400);

      expect(res.body.message).toMatch(/5 MB/);
      expect(
        await prisma.identityVerification.count({ where: { userId } }),
      ).toBe(0);
    });

    it('rechaza con 400 si no viene el archivo', async () => {
      const { token } = await account('ARRENDATARIO');

      const res = await request(app.getHttpServer())
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .field('otro', 'valor')
        .expect(400);
      expect(res.body.message).toMatch(/documento/);
    });

    it('rechaza con 400 un archivo en otro campo', async () => {
      const { token } = await account('ARRENDATARIO');

      const res = await request(app.getHttpServer())
        .post(BASE)
        .set('Authorization', `Bearer ${token}`)
        .attach('archivo', PDF, 'dui.pdf')
        .expect(400);
      expect(res.body.message).toMatch(/campo documento/);
    });

    it('responde 401 sin sesión', async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .attach('documento', PDF, 'dui.pdf')
        .expect(401);
    });

    it('responde 403 si quien envía es arrendador', async () => {
      const { token, userId } = await account('ARRENDADOR');

      await send(token).expect(403);
      expect(
        await prisma.identityVerification.count({ where: { userId } }),
      ).toBe(0);
    });
  });

  describe('GET /usuarios/me/verificaciones/ultima', () => {
    it('devuelve la última solicitud con su estado y sin el documento', async () => {
      const { token } = await account('ARRENDATARIO');
      const { body: created } = await send(token).expect(201);

      const { body } = await latest(token).expect(200);

      expect(body).toEqual({
        id: created.id,
        estado: 'PENDIENTE',
        motivoRechazo: null,
        enviadaAt: expect.any(String),
        revisadaAt: null,
      });
      expect(JSON.stringify(body)).not.toMatch(/verificaciones\/|document/i);
    });

    it('muestra el motivo de una RECHAZADA y la fecha de revisión', async () => {
      const { token } = await account('ARRENDATARIO');
      const reviewer = await account('ARRENDADOR');
      const { body: created } = await send(token).expect(201);
      await prisma.identityVerification.update({
        where: { id: created.id },
        data: {
          status: 'RECHAZADA',
          rejectionReason: 'Documento ilegible',
          reviewedById: reviewer.userId,
          reviewedAt: new Date(),
        },
      });

      const { body } = await latest(token).expect(200);

      expect(body).toMatchObject({
        estado: 'RECHAZADA',
        motivoRechazo: 'Documento ilegible',
        revisadaAt: expect.any(String),
      });
    });

    it('devuelve la más reciente cuando hay varias', async () => {
      const { token, userId } = await account('ARRENDATARIO');
      const reviewer = await account('ARRENDADOR');
      await prisma.identityVerification.create({
        data: {
          userId,
          documentKey: 'verificaciones/vieja.pdf',
          status: 'RECHAZADA',
          submittedAt: new Date('2026-01-01T00:00:00Z'),
          reviewedById: reviewer.userId,
          reviewedAt: new Date('2026-01-02T00:00:00Z'),
        },
      });
      const { body: created } = await send(token).expect(201);

      const { body } = await latest(token).expect(200);
      expect(body.id).toBe(created.id);
    });

    it('solo ve la propia: otro arrendatario no recibe la solicitud ajena', async () => {
      const owner = await account('ARRENDATARIO');
      const other = await account('ARRENDATARIO');
      await send(owner.token).expect(201);

      await latest(other.token).expect(404);
    });

    it('responde 404 si todavía no envió ninguna', async () => {
      const { token } = await account('ARRENDATARIO');

      const res = await latest(token).expect(404);
      expect(res.body.message).toMatch(/Todavía no enviaste/);
    });

    it('responde 401 sin sesión y 403 para un arrendador', async () => {
      await request(app.getHttpServer()).get(`${BASE}/ultima`).expect(401);

      const { token } = await account('ARRENDADOR');
      await latest(token).expect(403);
    });
  });
});
