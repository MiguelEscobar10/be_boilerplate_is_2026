import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Registro con rol y /auth/me (BE-00.1).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`) y borra al final solo las cuentas que creó.
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

describe('cuentas: registro con rol (BE-00.1)', () => {
  const suffix = `be-00.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let n = 0;
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;

  const register = (fields: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        email: `${n++}-${suffix}`,
        password,
        rol: 'ARRENDADOR',
        nombre: 'Lee Fuentes',
        telefono: '70001234',
        ...fields,
      });

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
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
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await app.close();
  });

  it.each(['ARRENDADOR', 'ARRENDATARIO'])(
    'registra una cuenta de %s con su perfil',
    async (rol) => {
      const { body } = await register({ rol }).expect(201);

      expect(body).toMatchObject({
        rol,
        nombre: 'Lee Fuentes',
        telefono: '70001234',
      });
      expect(body).not.toHaveProperty('passwordHash');
    },
  );

  it.each([
    ['REVISOR', 'REVISOR'],
    ['ADMIN', 'ADMIN'],
    ['vacío', ''],
  ])('rechaza con 400 ROL_NO_PERMITIDO un rol %s', async (_case, rol) => {
    const before = await prisma.user.count({
      where: { email: { endsWith: suffix } },
    });
    const { body } = await register({ rol }).expect(400);

    expect(JSON.stringify(body.message)).toContain('ROL_NO_PERMITIDO');
    expect(
      await prisma.user.count({ where: { email: { endsWith: suffix } } }),
    ).toBe(before);
  });

  it('rechaza con 400 un registro sin rol', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        email: `sin-rol-${suffix}`,
        password,
        nombre: 'Ana',
        telefono: '70001234',
      })
      .expect(400);
  });

  it.each([
    ['nombre vacío', { nombre: '  ' }],
    ['nombre de 101 caracteres', { nombre: 'a'.repeat(101) }],
    ['teléfono con guion', { telefono: '7000-1234' }],
    ['teléfono de 7 dígitos', { telefono: '7000123' }],
  ])('rechaza con 400: %s', async (_case, fields) => {
    await register(fields).expect(400);
  });

  it('GET /auth/me devuelve el rol leído de la base', async () => {
    const email = `me-${suffix}`;
    await register({ email, rol: 'ARRENDATARIO' }).expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(me.body).toMatchObject({
      email,
      rol: 'ARRENDATARIO',
      nombre: 'Lee Fuentes',
    });
  });

  it('GET /auth/me responde 401 sin sesión', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });
});
