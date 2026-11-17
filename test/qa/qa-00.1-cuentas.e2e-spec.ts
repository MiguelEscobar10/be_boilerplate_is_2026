import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-00.1 (MP4-128): plan de pruebas del registro por rol y los permisos
 * (Módulo 0). Los ids (C01, C02...) se repiten en docs/qa/QA-00.1-cuentas.md.
 */
describe('QA-00.1: registro por rol y permisos', () => {
  const suffix = `qa-00.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let n = 0;
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;

  const http = () => request(app.getHttpServer());
  const register = (fields: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/users')
      .send({
        email: `${n++}-${suffix}`,
        password,
        rol: 'ARRENDADOR',
        nombre: 'Lee Fuentes',
        telefono: '70001234',
        ...fields,
      });
  const countUsers = () =>
    prisma.user.count({ where: { email: { endsWith: suffix } } });
  const login = async (email: string) =>
    (
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.accessToken as string;

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
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await app.close();
  });

  describe('registro', () => {
    it.each([
      ['C01', 'ARRENDADOR'],
      ['C02', 'ARRENDATARIO'],
    ])(
      '%s: registra una cuenta de %s con su perfil guardado',
      async (_id, rol) => {
        const { body } = await register({ rol }).expect(201);

        const saved = await prisma.user.findUniqueOrThrow({
          where: { id: body.id },
          include: { profile: true },
        });
        expect(saved.role).toBe(rol);
        expect(saved.profile).toMatchObject({
          name: 'Lee Fuentes',
          phone: '70001234',
        });
        expect(body).not.toHaveProperty('passwordHash');
      },
    );

    it.each([
      ['C03', 'REVISOR por petición pública', 'REVISOR'],
      ['C04', 'ADMIN', 'ADMIN'],
      ['C05', 'rol vacío', ''],
      ['C06', 'rol en minúsculas', 'arrendador'],
    ])(
      '%s: rechaza %s con ROL_NO_PERMITIDO y no crea la cuenta',
      async (_id, _case, rol) => {
        const before = await countUsers();
        const { body } = await register({ rol }).expect(400);

        expect(JSON.stringify(body.message)).toContain('ROL_NO_PERMITIDO');
        expect(await countUsers()).toBe(before);
      },
    );

    it.each([
      ['C07', 'sin teléfono', { telefono: undefined }],
      ['C08', 'con teléfono con letras', { telefono: '7000abcd' }],
      ['C09', 'con nombre vacío', { nombre: '' }],
    ])(
      '%s: rechaza un registro %s sin crear la cuenta',
      async (_id, _case, fields) => {
        const before = await countUsers();
        await register(fields).expect(400);
        expect(await countUsers()).toBe(before);
      },
    );

    it('C16: un correo ya registrado responde 409 y no crea otra cuenta', async () => {
      const email = `duplicado-${suffix}`;
      await register({ email }).expect(201);
      const before = await countUsers();

      // Mismo correo con otras mayúsculas: el backend lo normaliza.
      await register({
        email: email.toUpperCase(),
        rol: 'ARRENDATARIO',
      }).expect(409);
      expect(await countUsers()).toBe(before);
    });

    it.each([
      ['C17', 'de menos de 8 caracteres', 'Ab1'],
      ['C18', 'sin mayúsculas', 'sinmayus123'],
      ['C19', 'sin números', 'SinNumeros'],
    ])(
      '%s: rechaza una contraseña %s sin crear la cuenta',
      async (_id, _case, weak) => {
        const before = await countUsers();
        await register({ password: weak }).expect(400);
        expect(await countUsers()).toBe(before);
      },
    );

    it('C10: no acepta un campo extra para colarse otro rol (role)', async () => {
      const before = await countUsers();
      await register({ role: 'REVISOR' }).expect(400);
      expect(await countUsers()).toBe(before);
    });
  });

  describe('sesión y permisos', () => {
    it('C11: /auth/me devuelve el rol guardado en la base', async () => {
      const email = `me-${suffix}`;
      await register({ email, rol: 'ARRENDATARIO' }).expect(201);
      const token = await login(email);

      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(me.body.rol).toBe('ARRENDATARIO');
    });

    it('C12: el rol se lee de la base en cada petición, no del token', async () => {
      const email = `cambio-${suffix}`;
      await register({ email, rol: 'ARRENDATARIO' }).expect(201);
      const token = await login(email);
      // Con el mismo token, un cambio de rol en la base se nota de inmediato.
      await prisma.user.update({
        where: { email },
        data: { role: 'ARRENDADOR' },
      });

      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(me.body.rol).toBe('ARRENDADOR');
    });

    it('C13: sin sesión, una ruta protegida responde 401', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      await http().post('/api/v1/publicaciones').expect(401);
    });

    it('C14: con un token inválido responde 401', async () => {
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer no-es-un-token')
        .expect(401);
    });

    it('C15: con sesión pero con otro rol, una ruta con @Roles responde 403', async () => {
      const email = `inquilino-${suffix}`;
      await register({ email, rol: 'ARRENDATARIO' }).expect(201);
      const token = await login(email);

      await http()
        .post('/api/v1/publicaciones')
        .set('Authorization', `Bearer ${token}`)
        .field('tipo', 'EQUIPO')
        .expect(403);
    });
  });
});
