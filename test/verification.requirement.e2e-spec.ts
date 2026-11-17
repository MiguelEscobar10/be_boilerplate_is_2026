import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Opción "requiere verificación" y su regla (BE-19.1).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`, como las demás). La regla `exigeVerificacionYNoCumple` se prueba
 * contra la base real tomando el servicio de la app, igual que lo hará
 * BE-03.1.
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

describe('requiere verificación (BE-19.1)', () => {
  const email = `be-19.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let requirement: import('../src/verification/services/verification-requirement.service.js').VerificationRequirementService;
  let owner: { token: string; userId: string };
  let reviewerId: string;
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

  const newListing = (landlordId = owner.userId) =>
    prisma.listing.create({
      data: {
        landlordId,
        type: 'EQUIPO',
        name: 'Proyector',
        location: 'Antiguo Cuscatlán',
        rateAmount: '20.00',
        rateUnit: 'DIA',
      },
    });

  const patch = (id: string, token: string | null, body: object) => {
    const req = request(app.getHttpServer()).patch(
      `/api/v1/publicaciones/${id}/requiere-verificacion`,
    );
    if (token) void req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  const verification = (
    userId: string,
    status: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA',
  ) =>
    prisma.identityVerification.create({
      data: {
        userId,
        documentKey: `verificaciones/${randomUUID()}.pdf`,
        status,
        submittedAt: new Date('2026-12-01T09:00:00Z'),
        ...(status === 'PENDIENTE'
          ? {}
          : {
              reviewedById: reviewerId,
              reviewedAt: new Date('2026-12-01T10:00:00Z'),
            }),
      },
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();

    // Se importa después de fijar las variables para que ConfigModule las lea.
    const { AppModule } = await import('../src/app.module.js');
    const { PrismaService } =
      await import('../src/prisma/services/prisma.service.js');
    const { VerificationRequirementService } =
      await import('../src/verification/services/verification-requirement.service.js');
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
    requirement = app.get(VerificationRequirementService);

    owner = await account('ARRENDADOR');
    reviewerId = (
      await prisma.user.create({
        data: {
          email: `revisor-${email}`,
          passwordHash: 'x',
          role: 'REVISOR',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('PATCH /publicaciones/{id}/requiere-verificacion', () => {
    it('el dueño la activa (200) y queda guardada', async () => {
      const { id } = await newListing();

      const { body } = await patch(id, owner.token, {
        requiereVerificacion: true,
      }).expect(200);

      expect(body).toEqual({ id, requiereVerificacion: true });
      const saved = await prisma.listing.findUniqueOrThrow({ where: { id } });
      expect(saved.requiresVerification).toBe(true);
    });

    it('el dueño la desactiva después de activarla', async () => {
      const { id } = await newListing();
      await patch(id, owner.token, { requiereVerificacion: true }).expect(200);

      const { body } = await patch(id, owner.token, {
        requiereVerificacion: false,
      }).expect(200);

      expect(body.requiereVerificacion).toBe(false);
    });

    it('repetir el mismo valor responde 200 sin cambiar nada', async () => {
      const { id } = await newListing();
      await patch(id, owner.token, { requiereVerificacion: true }).expect(200);

      const { body } = await patch(id, owner.token, {
        requiereVerificacion: true,
      }).expect(200);
      expect(body.requiereVerificacion).toBe(true);
    });

    it('responde 403 a otro arrendador y no cambia la opción', async () => {
      const { id } = await newListing();
      const other = await account('ARRENDADOR');

      await patch(id, other.token, { requiereVerificacion: true }).expect(403);

      const saved = await prisma.listing.findUniqueOrThrow({ where: { id } });
      expect(saved.requiresVerification).toBe(false);
    });

    it('responde 403 a un arrendatario', async () => {
      const { id } = await newListing();
      const tenant = await account('ARRENDATARIO');

      await patch(id, tenant.token, { requiereVerificacion: true }).expect(403);
    });

    it('responde 401 sin sesión', async () => {
      const { id } = await newListing();
      await patch(id, null, { requiereVerificacion: true }).expect(401);
    });

    it('responde 404 si la publicación no existe', async () => {
      await patch(randomUUID(), owner.token, {
        requiereVerificacion: true,
      }).expect(404);
    });

    it.each([
      ['un texto', { requiereVerificacion: 'true' }],
      ['un número', { requiereVerificacion: 1 }],
      ['null', { requiereVerificacion: null }],
      ['nada', {}],
      ['un campo de más', { requiereVerificacion: true, otro: 1 }],
    ])('responde 400 con %s', async (_, body) => {
      const { id } = await newListing();

      await patch(id, owner.token, body).expect(400);

      const saved = await prisma.listing.findUniqueOrThrow({ where: { id } });
      expect(saved.requiresVerification).toBe(false);
    });

    it('responde 400 si el id no es un UUID', async () => {
      await patch('17', owner.token, { requiereVerificacion: true }).expect(
        400,
      );
    });
  });

  describe('exigeVerificacionYNoCumple (la usa BE-03.1)', () => {
    it.each([
      ['sin verificación', null, true],
      ['con una PENDIENTE', 'PENDIENTE', true],
      ['con una RECHAZADA', 'RECHAZADA', true],
      ['con una APROBADA', 'APROBADA', false],
    ] as const)(
      'publicación que la exige y arrendatario %s → %s',
      async (_, status, expected) => {
        const listing = await newListing();
        await prisma.listing.update({
          where: { id: listing.id },
          data: { requiresVerification: true },
        });
        const tenant = await account('ARRENDATARIO');
        if (status) await verification(tenant.userId, status);

        await expect(
          requirement.exigeVerificacionYNoCumple(listing.id, tenant.userId),
        ).resolves.toBe(expected);
      },
    );

    it('publicación que no la exige: acepta a un arrendatario sin verificar', async () => {
      const listing = await newListing();
      const tenant = await account('ARRENDATARIO');

      await expect(
        requirement.exigeVerificacionYNoCumple(listing.id, tenant.userId),
      ).resolves.toBe(false);
    });

    it('al activar la opción por el endpoint, la regla empieza a rechazar', async () => {
      const listing = await newListing();
      const tenant = await account('ARRENDATARIO');
      expect(
        await requirement.exigeVerificacionYNoCumple(listing.id, tenant.userId),
      ).toBe(false);

      await patch(listing.id, owner.token, {
        requiereVerificacion: true,
      }).expect(200);

      expect(
        await requirement.exigeVerificacionYNoCumple(listing.id, tenant.userId),
      ).toBe(true);
    });
  });
});
