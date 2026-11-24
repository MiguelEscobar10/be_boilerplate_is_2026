import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-07.1 (MP4-101): plan de pruebas de la carga, la revisión y los permisos
 * documentales (H07).
 *
 * Cada caso tiene un id (V01, V02...) que se repite en la evidencia de
 * docs/qa/QA-07.1-verificacion.md. Los casos que prueban un criterio de
 * aceptación de H07 empiezan con «ACn:» y conservan su id al final, entre
 * paréntesis. Además de la respuesta HTTP, cada caso
 * revisa lo que quedó guardado: filas en `identity_verifications` y archivos
 * en la carpeta de documentos.
 */

const PDF = Buffer.from('%PDF-1.4 documento de identidad');
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const TXT = Buffer.from('no soy un documento');
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0]);

describe('H07. Solicitar verificación de identidad', () => {
  const email = `qa-07.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let uploadsDir: string;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let reviewer: Session;
  let accounts = 0;

  type Session = { token: string; userId: string };

  const http = () => request(app.getHttpServer());

  const login = async (address: string): Promise<Session> => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken, userId: user.id };
  };

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
    return login(address);
  };

  const send = (who: Session, file = PDF, name = 'dui.pdf') =>
    http()
      .post('/api/v1/usuarios/me/verificaciones')
      .set('Authorization', `Bearer ${who.token}`)
      .attach('documento', file, name);

  const latest = (who: Session) =>
    http()
      .get('/api/v1/usuarios/me/verificaciones/ultima')
      .set('Authorization', `Bearer ${who.token}`);

  const decide = (id: string, who: Session, body: object) =>
    http()
      .patch(`/api/v1/verificaciones/${id}/decision`)
      .set('Authorization', `Bearer ${who.token}`)
      .send(body);

  const documentOf = (id: string, who?: Session) => {
    const req = http().get(`/api/v1/verificaciones/${id}/documento`);
    if (who) void req.set('Authorization', `Bearer ${who.token}`);
    return req;
  };

  const rowsOf = (who: Session) =>
    prisma.identityVerification.findMany({ where: { userId: who.userId } });

  const storedFiles = async () =>
    readdir(join(uploadsDir, 'verificaciones')).catch(() => [] as string[]);

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

    // El REVISOR no se registra por la API: se crea como lo hace el seed.
    const address = `revisor-${email}`;
    await prisma.user.create({
      data: {
        email: address,
        passwordHash: await bcrypt.hash(password, 4),
        role: 'REVISOR',
      },
    });
    reviewer = await login(address);
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
    await rm(uploadsDir, { recursive: true, force: true });
  });

  describe('carga del documento', () => {
    it.each([
      ['PDF', 'V01', PDF, 'dui.pdf', '.pdf'],
      ['PNG', 'V02', PNG, 'dui.png', '.png'],
      ['JPG', 'V03', JPG, 'dui.jpg', '.jpg'],
    ])(
      'AC1: un documento %s válido queda PENDIENTE con su archivo guardado en privado (%s)',
      async (_, __, file, name, ext) => {
        const tenant = await account('ARRENDATARIO');

        const { body } = await send(tenant, file, name).expect(201);

        expect(body).toEqual({ id: expect.any(String), estado: 'PENDIENTE' });
        const [row] = await rowsOf(tenant);
        expect(row).toMatchObject({
          id: body.id,
          status: 'PENDIENTE',
          reviewedById: null,
          reviewedAt: null,
        });
        expect(row.documentKey.endsWith(ext)).toBe(true);
        // Nombre generado por el servidor, nunca el que manda el cliente.
        expect(row.documentKey).not.toContain(name);
        expect(await storedFiles()).toContain(row.documentKey.split('/').pop());
      },
    );

    it.each([
      ['un .txt renombrado a .pdf', 'V04', TXT, 'trampa.pdf'],
      ['un .docx', 'V05', DOCX, 'dui.docx'],
    ])(
      'AC6: %s responde 400 con un mensaje claro y no guarda nada (%s)',
      async (_, __, file, name) => {
        const tenant = await account('ARRENDATARIO');
        const before = await storedFiles();

        const res = await send(tenant, file, name).expect(400);

        expect(res.body.message).toMatch(/no es JPG, PNG ni PDF/);
        expect(await rowsOf(tenant)).toHaveLength(0);
        expect(await storedFiles()).toEqual(before);
      },
    );

    it('AC6: un archivo de más de 5 MB responde 400 con lo que hay que corregir y no guarda nada (V06)', async () => {
      const tenant = await account('ARRENDATARIO');
      const before = await storedFiles();
      const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);

      const res = await send(tenant, big, 'grande.pdf').expect(400);

      expect(res.body.message).toMatch(/5 MB/);
      expect(await rowsOf(tenant)).toHaveLength(0);
      expect(await storedFiles()).toEqual(before);
    });

    it('AC5: con otra solicitud PENDIENTE, la nueva responde 409, avisa que hay que esperar y no se registra (V07)', async () => {
      const tenant = await account('ARRENDATARIO');
      await send(tenant).expect(201);
      const before = await storedFiles();

      const res = await send(tenant).expect(409);

      expect(res.body.message).toMatch(/PENDIENTE/);
      expect(await rowsOf(tenant)).toHaveLength(1);
      expect(await storedFiles()).toEqual(before);
    });

    it('V08: el arrendatario consulta su estado y nunca recibe el documento ni su ruta', async () => {
      const tenant = await account('ARRENDATARIO');
      const { body: created } = await send(tenant).expect(201);

      const { body } = await latest(tenant).expect(200);

      expect(body).toMatchObject({ id: created.id, estado: 'PENDIENTE' });
      expect(JSON.stringify(body)).not.toMatch(/verificaciones\/|document/i);
    });
  });

  describe('revisión', () => {
    it('AC2: el REVISOR decide y el arrendatario conoce si quedó APROBADA (V09)', async () => {
      const tenant = await account('ARRENDATARIO');
      const { body: created } = await send(tenant).expect(201);

      await decide(created.id, reviewer, { decision: 'APROBAR' }).expect(200);

      const [row] = await rowsOf(tenant);
      expect(row).toMatchObject({
        status: 'APROBADA',
        reviewedById: reviewer.userId,
        rejectionReason: null,
      });
      expect(row.reviewedAt).toBeInstanceOf(Date);
      const { body } = await latest(tenant).expect(200);
      expect(body.estado).toBe('APROBADA');
    });

    it('AC3: una solicitud RECHAZADA muestra al arrendatario el motivo registrado (V10)', async () => {
      const tenant = await account('ARRENDATARIO');
      const { body: created } = await send(tenant).expect(201);

      await decide(created.id, reviewer, {
        decision: 'RECHAZAR',
        motivo: 'Documento ilegible',
      }).expect(200);

      const [row] = await rowsOf(tenant);
      expect(row).toMatchObject({
        status: 'RECHAZADA',
        rejectionReason: 'Documento ilegible',
        reviewedById: reviewer.userId,
      });
      const { body } = await latest(tenant).expect(200);
      expect(body).toMatchObject({
        estado: 'RECHAZADA',
        motivoRechazo: 'Documento ilegible',
      });
    });

    it('V11: tras un rechazo, el arrendatario puede enviar una solicitud nueva', async () => {
      const tenant = await account('ARRENDATARIO');
      const { body: first } = await send(tenant).expect(201);
      await decide(first.id, reviewer, { decision: 'RECHAZAR' }).expect(200);

      const { body: second } = await send(tenant).expect(201);

      expect(second.id).not.toBe(first.id);
      expect((await rowsOf(tenant)).map((r) => r.status).sort()).toEqual([
        'PENDIENTE',
        'RECHAZADA',
      ]);
    });

    it('V12: una solicitud ya resuelta no se decide dos veces (409) y no cambia', async () => {
      const tenant = await account('ARRENDATARIO');
      const { body: created } = await send(tenant).expect(201);
      await decide(created.id, reviewer, { decision: 'APROBAR' }).expect(200);
      const [before] = await rowsOf(tenant);

      await decide(created.id, reviewer, {
        decision: 'RECHAZAR',
        motivo: 'Cambio de opinión',
      }).expect(409);

      const [after] = await rowsOf(tenant);
      expect(after).toEqual(before);
    });

    it('V13: una decisión inválida responde 400 con un mensaje claro y no decide', async () => {
      const tenant = await account('ARRENDATARIO');
      const { body: created } = await send(tenant).expect(201);

      const res = await decide(created.id, reviewer, {
        decision: 'TAL_VEZ',
      }).expect(400);

      expect(JSON.stringify(res.body.message)).toMatch(/APROBAR o RECHAZAR/);
      const [row] = await rowsOf(tenant);
      expect(row.status).toBe('PENDIENTE');
    });
  });

  describe('permisos documentales', () => {
    it('V14: revisión sin el rol REVISOR: arrendatario (aunque sea el dueño) y arrendador reciben 403 en la cola, el documento y la decisión', async () => {
      const owner = await account('ARRENDATARIO');
      const landlord = await account('ARRENDADOR');
      const { body: created } = await send(owner).expect(201);

      for (const who of [owner, landlord]) {
        await http()
          .get('/api/v1/verificaciones')
          .set('Authorization', `Bearer ${who.token}`)
          .expect(403);
        await documentOf(created.id, who).expect(403);
        await decide(created.id, who, { decision: 'APROBAR' }).expect(403);
      }
      const [row] = await rowsOf(owner);
      expect(row.status).toBe('PENDIENTE');
    });

    it('AC4: una persona sin permiso no accede al documento ni a la solicitud ajena (V15)', async () => {
      const owner = await account('ARRENDATARIO');
      const other = await account('ARRENDATARIO');
      const { body: created } = await send(owner).expect(201);

      await documentOf(created.id, other).expect(403);
      // Su propia consulta no devuelve la del otro.
      await latest(other).expect(404);
    });

    it('V16: sin sesión, ninguna ruta del módulo responde (401)', async () => {
      const owner = await account('ARRENDATARIO');
      const { body: created } = await send(owner).expect(201);

      await http().get('/api/v1/verificaciones').expect(401);
      await documentOf(created.id).expect(401);
      await http()
        .patch(`/api/v1/verificaciones/${created.id}/decision`)
        .send({ decision: 'APROBAR' })
        .expect(401);
      await http().get('/api/v1/usuarios/me/verificaciones/ultima').expect(401);
      await http()
        .post('/api/v1/usuarios/me/verificaciones')
        .attach('documento', PDF, 'dui.pdf')
        .expect(401);
    });

    it('V17: la ruta del archivo no está expuesta sin autenticación (ni como estática ni adivinándola)', async () => {
      const owner = await account('ARRENDATARIO');
      const { body: created } = await send(owner).expect(201);
      const [row] = await rowsOf(owner);
      const file = row.documentKey.split('/').pop()!;

      for (const path of [
        `/${row.documentKey}`,
        `/uploads/${row.documentKey}`,
        `/api/v1/${row.documentKey}`,
        `/api/v1/uploads/${row.documentKey}`,
        `/verificaciones/${file}`,
      ]) {
        const res = await http().get(path);
        expect(res.status).not.toBe(200);
        expect(res.text).not.toContain('%PDF');
      }
      // La cola solo expone la ruta protegida, no la privada.
      const { body } = await http()
        .get('/api/v1/verificaciones')
        .set('Authorization', `Bearer ${reviewer.token}`)
        .expect(200);
      const item = body.find((v: { id: string }) => v.id === created.id);
      expect(item.documentoUrl).toBe(
        `/api/v1/verificaciones/${created.id}/documento`,
      );
      expect(JSON.stringify(body)).not.toContain(row.documentKey);
    });

    it('V18: el REVISOR sí abre el documento, con su tipo y sin caché compartida', async () => {
      const owner = await account('ARRENDATARIO');
      const { body: created } = await send(owner).expect(201);

      const res = await documentOf(created.id, reviewer)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    });
  });

  describe('alcance de la verificación', () => {
    it('AC7: el arrendador publica y decide solicitudes sin verificación de identidad (V19)', async () => {
      const landlord = await account('ARRENDADOR');
      const tenant = await account('ARRENDATARIO');

      const publicacion = http()
        .post('/api/v1/publicaciones')
        .set('Authorization', `Bearer ${landlord.token}`);
      for (const [k, v] of Object.entries({
        tipo: 'EQUIPO',
        nombre: 'Proyector V19',
        ubicacion: 'Antiguo Cuscatlán',
        tarifaMonto: '15.00',
        tarifaUnidad: 'DIA',
      }))
        void publicacion.field(k, v);
      const { body: listing } = await publicacion
        .attach('imagenes', JPG, 'foto.jpg')
        .expect(201);

      const startAt = new Date(Date.UTC(2027, 0, 10, 15));
      const reservation = await prisma.reservation.create({
        data: {
          listingId: listing.id,
          tenantId: tenant.userId,
          startAt,
          endAt: new Date(startAt.getTime() + 3 * 3_600_000),
          status: 'PENDIENTE',
          rentalCost: '45.00',
          depositAmount: '0.00',
        },
      });

      await http()
        .patch(`/api/v1/reservas/${reservation.id}/decision`)
        .set('Authorization', `Bearer ${landlord.token}`)
        .send({ decision: 'APROBAR' })
        .expect(200);

      expect(
        (
          await prisma.reservation.findUniqueOrThrow({
            where: { id: reservation.id },
          })
        ).status,
      ).toBe('CONFIRMADA');
      // Nunca tuvo una verificación y no se le pidió.
      expect(await rowsOf(landlord)).toHaveLength(0);
    });
  });
});
