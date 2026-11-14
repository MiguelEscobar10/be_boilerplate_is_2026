import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Endpoints de publicaciones (BE-01.1).
 *
 * Levanta la app completa contra la base de pruebas (misma regla que las
 * pruebas de restricciones: local y terminada en `_test`) y guarda las fotos
 * en una carpeta temporal que se borra al final.
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

// Imágenes mínimas: solo importa la firma de los primeros bytes.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from('%PDF-1.4 no soy una imagen');

describe('publicaciones (BE-01.1)', () => {
  const email = `be-01.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let token: string;
  let uploadsDir: string;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;

  const form = (fields: Record<string, string> = {}) => {
    const req = request(app.getHttpServer())
      .post('/api/v1/publicaciones')
      .set('Authorization', `Bearer ${token}`);
    const data = {
      tipo: 'EQUIPO',
      nombre: 'Taladro percutor',
      ubicacion: 'Antiguo Cuscatlán',
      tarifaMonto: '15.00',
      tarifaUnidad: 'DIA',
      ...fields,
    };
    for (const [k, v] of Object.entries(data)) void req.field(k, v);
    return req;
  };

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

    await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({ email, password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { landlord: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('crea la publicación (201) y la devuelve con sus imágenes en orden', async () => {
    const created = await form({
      depositoMonto: '50',
      condiciones: 'Devolver limpio',
    })
      .attach('imagenes', JPG, 'frente.jpg')
      .attach('imagenes', PNG, 'lado.png')
      .expect(201);

    expect(created.body).toMatchObject({
      tipo: 'EQUIPO',
      nombre: 'Taladro percutor',
      activo: true,
    });

    const found = await request(app.getHttpServer())
      .get(`/api/v1/publicaciones/${created.body.id}`)
      .expect(200);
    expect(found.body).toMatchObject({
      tarifaMonto: '15.00',
      tarifaUnidad: 'DIA',
      depositoMonto: '50.00',
      condiciones: 'Devolver limpio',
    });
    expect(found.body.imagenes.map((i: { orden: number }) => i.orden)).toEqual([
      0, 1,
    ]);

    const image = await request(app.getHttpServer())
      .get(found.body.imagenes[1].url)
      .expect(200);
    expect(image.headers['content-type']).toContain('image/png');
  });

  it('acepta el campo como imagenes[]', async () => {
    await form().attach('imagenes[]', JPG, 'a.jpg').expect(201);
  });

  it('pone el depósito en 0.00 si no viene', async () => {
    const { body } = await form().attach('imagenes', JPG, 'a.jpg').expect(201);
    const found = await request(app.getHttpServer()).get(
      `/api/v1/publicaciones/${body.id}`,
    );
    expect(found.body.depositoMonto).toBe('0.00');
  });

  it.each([
    ['nombre de 101 caracteres', { nombre: 'a'.repeat(101) }],
    ['nombre vacío', { nombre: '   ' }],
    ['tarifa en cero', { tarifaMonto: '0' }],
    ['tarifa negativa', { tarifaMonto: '-5' }],
    ['depósito negativo', { depositoMonto: '-1' }],
    ['unidad no permitida', { tarifaUnidad: 'MES' }],
    ['tipo no permitido', { tipo: 'VEHICULO' }],
  ])('rechaza con 400: %s', async (_case, fields) => {
    const before = await prisma.listing.count({
      where: { landlord: { email } },
    });
    await form(fields).attach('imagenes', JPG, 'a.jpg').expect(400);
    expect(await prisma.listing.count({ where: { landlord: { email } } })).toBe(
      before,
    );
  });

  it('rechaza con 400 una publicación sin fotos', async () => {
    await form().expect(400);
  });

  it('rechaza con 400 más de 10 fotos', async () => {
    const req = form();
    for (let i = 0; i < 11; i++) void req.attach('imagenes', JPG, `f${i}.jpg`);
    const res = await req.expect(400);
    expect(res.body.message).toMatch(/10 fotograf/);
  });

  it('rechaza con 400 un archivo que no es JPG ni PNG, aunque diga .jpg', async () => {
    const res = await form().attach('imagenes', PDF, 'trampa.jpg').expect(400);
    expect(res.body.message).toMatch(/no es JPG ni PNG/);
  });

  it('rechaza con 400 una imagen de más de 5 MB', async () => {
    const big = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await form().attach('imagenes', big, 'grande.jpg').expect(400);
    expect(res.body.message).toMatch(/5 MB/);
  });

  it('responde 401 sin sesión', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/publicaciones')
      .field('tipo', 'EQUIPO')
      .attach('imagenes', JPG, 'a.jpg')
      .expect(401);
  });

  it('responde 404 si la publicación no existe', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/publicaciones/${randomUUID()}`)
      .expect(404);
  });

  it('responde 404 si la publicación está desactivada', async () => {
    const { body } = await form().attach('imagenes', JPG, 'a.jpg').expect(201);
    await prisma.listing.update({
      where: { id: body.id },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/publicaciones/${body.id}`)
      .expect(404);
  });

  // Depende del guard de roles del Módulo 0 (MP4-126).
  it.todo('responde 403 si quien publica no es arrendador');
});
