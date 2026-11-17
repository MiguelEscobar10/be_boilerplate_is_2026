import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';

/**
 * Revisión manual de verificaciones (BE-07.2).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`) y guarda los documentos en una carpeta temporal. El REVISOR se crea
 * directo en la base, como lo hace el seed: no se puede registrar por la API.
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

const PDF = Buffer.from('%PDF-1.4 documento de identidad');
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

describe('revisión de verificaciones (BE-07.2)', () => {
  const email = `be-07.2-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let uploadsDir: string;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let reviewer: { token: string; userId: string };
  let accounts = 0;

  const login = async (address: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken as string, userId: user.id };
  };

  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `${rol === 'ARRENDADOR' ? 'dueno' : 'inquilino'}${++accounts}-${email}`;
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({
        email: address,
        password,
        rol,
        nombre: `Persona ${accounts}`,
        telefono: '70001234',
      })
      .expect(201);
    return login(address);
  };

  const newReviewer = async () => {
    const address = `revisor${++accounts}-${email}`;
    await prisma.user.create({
      data: {
        email: address,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'REVISOR',
      },
    });
    return login(address);
  };

  /** Un arrendatario que envió su documento por la API (BE-07.1). */
  const submitted = async (file = PDF, name = 'dui.pdf') => {
    const tenant = await account('ARRENDATARIO');
    const { body } = await request(app.getHttpServer())
      .post('/api/v1/usuarios/me/verificaciones')
      .set('Authorization', `Bearer ${tenant.token}`)
      .attach('documento', file, name)
      .expect(201);
    return { tenant, id: body.id as string };
  };

  const decide = (id: string, token: string | null, body: object) => {
    const req = request(app.getHttpServer()).patch(
      `/api/v1/verificaciones/${id}/decision`,
    );
    if (token) void req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  const get = (path: string, token: string | null) => {
    const req = request(app.getHttpServer()).get(`/api/v1${path}`);
    if (token) void req.set('Authorization', `Bearer ${token}`);
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
    reviewer = await newReviewer();
  });

  afterAll(async () => {
    await prisma.identityVerification.deleteMany({
      where: { user: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  describe('GET /verificaciones', () => {
    it('lista las PENDIENTE en orden de llegada con el solicitante y sin la ruta del documento', async () => {
      const first = await submitted();
      const second = await submitted();

      const { body } = await get('/verificaciones', reviewer.token).expect(200);

      const ids = body.map((v: { id: string }) => v.id);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
      const item = body.find((v: { id: string }) => v.id === first.id);
      expect(item).toMatchObject({
        estado: 'PENDIENTE',
        usuario: { id: first.tenant.userId, nombre: expect.any(String) },
        documentoUrl: `/api/v1/verificaciones/${first.id}/documento`,
      });
      expect(JSON.stringify(body)).not.toMatch(
        /verificaciones\/[0-9a-f-]+\.pdf/,
      );
      expect(
        body.every((v: { estado: string }) => v.estado === 'PENDIENTE'),
      ).toBe(true);
    });

    it('filtra por ?estado=APROBADA', async () => {
      const { id } = await submitted();
      await decide(id, reviewer.token, { decision: 'APROBAR' }).expect(200);

      const { body } = await get(
        '/verificaciones?estado=APROBADA',
        reviewer.token,
      ).expect(200);
      expect(body.map((v: { id: string }) => v.id)).toContain(id);
      expect(
        body.every((v: { estado: string }) => v.estado === 'APROBADA'),
      ).toBe(true);
    });

    it('responde 400 con un estado inválido', async () => {
      await get('/verificaciones?estado=VENCIDA', reviewer.token).expect(400);
    });

    it('responde 401 sin sesión y 403 a un arrendatario o arrendador', async () => {
      await get('/verificaciones', null).expect(401);
      for (const rol of ['ARRENDATARIO', 'ARRENDADOR'] as const) {
        const { token } = await account(rol);
        await get('/verificaciones', token).expect(403);
      }
    });
  });

  describe('GET /verificaciones/{id}/documento', () => {
    it('el REVISOR abre el documento con su tipo y sin caché', async () => {
      const { id } = await submitted();

      const res = await get(`/verificaciones/${id}/documento`, reviewer.token)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    });

    it('si el archivo falta en disco responde un 404 genérico, sin la ruta del servidor', async () => {
      const { id } = await submitted();
      const { documentKey } =
        await prisma.identityVerification.findUniqueOrThrow({ where: { id } });
      await unlink(join(uploadsDir, documentKey));

      const res = await get(
        `/verificaciones/${id}/documento`,
        reviewer.token,
      ).expect(404);

      expect(res.body).toEqual({
        statusCode: 404,
        message: 'El documento no está disponible.',
        error: 'Not Found',
      });
      expect(JSON.stringify(res.body)).not.toContain(uploadsDir);
      expect(JSON.stringify(res.body)).not.toContain(documentKey);
    });

    it('sirve un PNG como image/png', async () => {
      const { id } = await submitted(PNG, 'dui.png');

      const res = await get(
        `/verificaciones/${id}/documento`,
        reviewer.token,
      ).expect(200);
      expect(res.headers['content-type']).toContain('image/png');
    });

    it('nadie más obtiene el documento: ni el dueño, ni otro arrendatario, ni un arrendador', async () => {
      const { id, tenant } = await submitted();
      const other = await account('ARRENDATARIO');
      const landlord = await account('ARRENDADOR');

      for (const token of [tenant.token, other.token, landlord.token]) {
        await get(`/verificaciones/${id}/documento`, token).expect(403);
      }
      await get(`/verificaciones/${id}/documento`, null).expect(401);
    });

    it('la carpeta de documentos no se sirve como archivo estático', async () => {
      const { id } = await submitted();
      const { documentKey } =
        await prisma.identityVerification.findUniqueOrThrow({ where: { id } });

      for (const path of [`/${documentKey}`, `/uploads/${documentKey}`]) {
        const res = await request(app.getHttpServer()).get(path);
        expect(res.status).not.toBe(200);
      }
    });

    it('responde 404 si la solicitud no existe y 400 si el id no es UUID', async () => {
      await get(
        `/verificaciones/${randomUUID()}/documento`,
        reviewer.token,
      ).expect(404);
      await get('/verificaciones/12/documento', reviewer.token).expect(400);
    });
  });

  describe('PATCH /verificaciones/{id}/decision', () => {
    it('APROBAR deja la solicitud APROBADA con el revisor y la fecha, y el arrendatario lo ve', async () => {
      const { id, tenant } = await submitted();

      const { body } = await decide(id, reviewer.token, {
        decision: 'APROBAR',
      }).expect(200);

      expect(body).toEqual({ id, estado: 'APROBADA' });
      const saved = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });
      expect(saved.reviewedById).toBe(reviewer.userId);
      expect(saved.reviewedAt).toBeInstanceOf(Date);
      expect(saved.rejectionReason).toBeNull();

      const { body: latest } = await get(
        '/usuarios/me/verificaciones/ultima',
        tenant.token,
      ).expect(200);
      expect(latest).toMatchObject({ estado: 'APROBADA', motivoRechazo: null });
    });

    it('RECHAZAR registra el motivo y el arrendatario lo ve', async () => {
      const { id, tenant } = await submitted();

      const { body } = await decide(id, reviewer.token, {
        decision: 'RECHAZAR',
        motivo: '  Documento ilegible  ',
      }).expect(200);

      expect(body).toEqual({ id, estado: 'RECHAZADA' });
      const { body: latest } = await get(
        '/usuarios/me/verificaciones/ultima',
        tenant.token,
      ).expect(200);
      expect(latest).toMatchObject({
        estado: 'RECHAZADA',
        motivoRechazo: 'Documento ilegible',
      });
    });

    it('RECHAZAR sin motivo también se registra', async () => {
      const { id } = await submitted();

      await decide(id, reviewer.token, { decision: 'RECHAZAR' }).expect(200);
      const saved = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });
      expect(saved.rejectionReason).toBeNull();
    });

    it('después de un rechazo, el arrendatario puede enviar otra', async () => {
      const { id, tenant } = await submitted();
      await decide(id, reviewer.token, { decision: 'RECHAZAR' }).expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/usuarios/me/verificaciones')
        .set('Authorization', `Bearer ${tenant.token}`)
        .attach('documento', PDF, 'dui.pdf')
        .expect(201);
    });

    it.each([
      ['APROBADA', { decision: 'APROBAR' }],
      ['RECHAZADA', { decision: 'RECHAZAR', motivo: 'Borroso' }],
    ])(
      'responde 409 al decidir otra vez una %s y no cambia nada',
      async (_, first) => {
        const { id } = await submitted();
        await decide(id, reviewer.token, first).expect(200);
        const before = await prisma.identityVerification.findUniqueOrThrow({
          where: { id },
        });

        await decide(id, reviewer.token, { decision: 'RECHAZAR' }).expect(409);
        await decide(id, reviewer.token, { decision: 'APROBAR' }).expect(409);

        const after = await prisma.identityVerification.findUniqueOrThrow({
          where: { id },
        });
        expect(after).toEqual(before);
      },
    );

    it('con dos decisiones simultáneas solo una gana', async () => {
      const { id } = await submitted();
      const other = await newReviewer();

      const results = await Promise.all([
        decide(id, reviewer.token, { decision: 'APROBAR' }),
        decide(id, other.token, { decision: 'RECHAZAR' }),
      ]);

      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
    });

    it.each([
      ['una decisión inválida', { decision: 'APROBADA' }],
      ['sin decisión', {}],
      ['un motivo al aprobar', { decision: 'APROBAR', motivo: 'No aplica' }],
      ['un motivo vacío', { decision: 'RECHAZAR', motivo: '   ' }],
      [
        'un motivo de 501 caracteres',
        { decision: 'RECHAZAR', motivo: 'a'.repeat(501) },
      ],
      ['un campo de más', { decision: 'APROBAR', otro: 1 }],
    ])('responde 400 con %s y no decide', async (_, body) => {
      const { id } = await submitted();

      await decide(id, reviewer.token, body).expect(400);

      const saved = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });
      expect(saved.status).toBe('PENDIENTE');
    });

    it('acepta un motivo de 500 caracteres', async () => {
      const { id } = await submitted();
      await decide(id, reviewer.token, {
        decision: 'RECHAZAR',
        motivo: 'a'.repeat(500),
      }).expect(200);
    });

    it('responde 403 a un arrendatario (ni siquiera el dueño) y a un arrendador', async () => {
      const { id, tenant } = await submitted();
      const landlord = await account('ARRENDADOR');

      for (const token of [tenant.token, landlord.token]) {
        await decide(id, token, { decision: 'APROBAR' }).expect(403);
      }
      const saved = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });
      expect(saved.status).toBe('PENDIENTE');
    });

    it('responde 401 sin sesión, 404 si no existe y 400 si el id no es UUID', async () => {
      const { id } = await submitted();
      await decide(id, null, { decision: 'APROBAR' }).expect(401);
      await decide(randomUUID(), reviewer.token, {
        decision: 'APROBAR',
      }).expect(404);
      await decide('12', reviewer.token, { decision: 'APROBAR' }).expect(400);
    });
  });

  describe('IdentityVerificationRepository.decide', () => {
    const repository = () =>
      import('../src/verification/repositories/index.js').then((m) =>
        app.get(m.IdentityVerificationRepository),
      );

    afterEach(() => {
      vi.useRealTimers();
    });

    it('la segunda decisión sobre la misma solicitud devuelve null y no cambia la primera', async () => {
      const { id } = await submitted();
      const other = await newReviewer();
      const repo = await repository();
      const pending = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });

      const first = await repo.decide(pending, {
        status: 'APROBADA',
        reviewedById: reviewer.userId,
        rejectionReason: null,
      });
      // Se llama con la misma copia PENDIENTE, como haría una decisión
      // simultánea que leyó la solicitud antes de la primera.
      const second = await repo.decide(pending, {
        status: 'RECHAZADA',
        reviewedById: other.userId,
        rejectionReason: 'Llegó tarde',
      });

      expect(first?.status).toBe('APROBADA');
      expect(second).toBeNull();
      const stored = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });
      expect(stored).toMatchObject({
        status: 'APROBADA',
        reviewedById: reviewer.userId,
        rejectionReason: null,
      });
    });

    it('con el reloj de la aplicación atrasado, reviewed_at queda igual a submitted_at', async () => {
      const { id } = await submitted();
      const repo = await repository();
      const pending = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });
      // La aplicación cree que es una hora antes del envío.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(pending.submittedAt.getTime() - 3_600_000));

      const decided = await repo.decide(pending, {
        status: 'APROBADA',
        reviewedById: reviewer.userId,
        rejectionReason: null,
      });

      expect(decided?.reviewedAt).toEqual(pending.submittedAt);
    });

    it('con el reloj al día, reviewed_at es la hora de la decisión', async () => {
      const { id } = await submitted();
      const repo = await repository();
      const pending = await prisma.identityVerification.findUniqueOrThrow({
        where: { id },
      });
      const later = new Date(pending.submittedAt.getTime() + 3_600_000);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(later);

      const decided = await repo.decide(pending, {
        status: 'APROBADA',
        reviewedById: reviewer.userId,
        rejectionReason: null,
      });

      expect(decided?.reviewedAt).toEqual(later);
    });
  });
});
