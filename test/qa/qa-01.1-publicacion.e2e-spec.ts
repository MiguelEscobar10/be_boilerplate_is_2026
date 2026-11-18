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
 * QA-01.1 (MP4-35): plan de pruebas del flujo de publicación (H01).
 *
 * Cada caso tiene un id (P01, P02...) que se repite en la evidencia de
 * docs/qa/QA-01.1-publicacion.md. Además de la respuesta HTTP, cada caso
 * revisa lo que quedó guardado: en la base y en la carpeta de fotos.
 */

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from('%PDF-1.4 no soy una imagen');

describe('QA-01.1: flujo de publicación', () => {
  const suffix = `qa-01.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let uploadsDir: string;
  const token: Record<'owner' | 'other' | 'tenant', string> = {
    owner: '',
    other: '',
    tenant: '',
  };
  const userId: Record<'owner' | 'other' | 'tenant', string> = {
    owner: '',
    other: '',
    tenant: '',
  };

  const http = () => request(app.getHttpServer());

  async function account(
    who: keyof typeof token,
    rol: 'ARRENDADOR' | 'ARRENDATARIO',
  ) {
    const email = `${who}-${suffix}`;
    const { body } = await http()
      .post('/api/v1/users')
      .send({ email, password, rol, nombre: who, telefono: '70001234' })
      .expect(201);
    userId[who] = body.id;
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    token[who] = login.body.accessToken;
  }

  /** Arma la petición con datos válidos; cada caso cambia solo lo que prueba. */
  function publish(
    fields: Record<string, string> = {},
    images: { buffer: Buffer; name: string }[] = [
      { buffer: JPG, name: 'foto.jpg' },
    ],
    who: keyof typeof token = 'owner',
  ) {
    const req = http()
      .post('/api/v1/publicaciones')
      .set('Authorization', `Bearer ${token[who]}`);
    const data = {
      tipo: 'EQUIPO',
      nombre: 'Taladro percutor',
      ubicacion: 'Antiguo Cuscatlán',
      tarifaMonto: '15.00',
      tarifaUnidad: 'DIA',
      ...fields,
    };
    for (const [k, v] of Object.entries(data)) void req.field(k, v);
    for (const img of images) void req.attach('imagenes', img.buffer, img.name);
    return req;
  }

  const countListings = () =>
    prisma.listing.count({
      where: { landlordId: { in: Object.values(userId) } },
    });
  const countFiles = async () =>
    (await readdir(join(uploadsDir, 'listings')).catch(() => [] as string[]))
      .length;

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
    uploadsDir = await mkdtemp(join(tmpdir(), 'qa-01.1-'));
    process.env.UPLOADS_DIR = uploadsDir;

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

    await account('owner', 'ARRENDADOR');
    await account('other', 'ARRENDADOR');
    await account('tenant', 'ARRENDATARIO');
  }, 60_000);

  afterAll(async () => {
    await prisma.listing.deleteMany({
      where: { landlordId: { in: Object.values(userId) } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await app.close();
    await rm(uploadsDir, { recursive: true, force: true });
  });

  describe('casos positivos', () => {
    it('P01: publicación válida de un equipo, con lo guardado igual a lo enviado', async () => {
      const { body } = await publish(
        {
          depositoMonto: '25.5',
          condiciones: 'Devolver limpio',
          descripcion: 'Con 5 brocas',
        },
        [
          { buffer: JPG, name: 'frente.jpg' },
          { buffer: PNG, name: 'lado.png' },
        ],
      ).expect(201);

      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: body.id },
        include: { images: { orderBy: { position: 'asc' } } },
      });
      expect(saved).toMatchObject({
        landlordId: userId.owner,
        type: 'EQUIPO',
        name: 'Taladro percutor',
        rateUnit: 'DIA',
        conditions: 'Devolver limpio',
        description: 'Con 5 brocas',
        isActive: true,
      });
      expect(saved.rateAmount.toFixed(2)).toBe('15.00');
      expect(saved.depositAmount.toFixed(2)).toBe('25.50');
      expect(saved.images.map((i) => i.position)).toEqual([0, 1]);
      expect(
        saved.images.every((i) =>
          /^listings\/[0-9a-f-]{36}\.(jpg|png)$/.test(i.path),
        ),
      ).toBe(true);
    });

    it('P02: publicación válida de un espacio por noche', async () => {
      const { body } = await publish({
        tipo: 'ESPACIO',
        nombre: 'Salón para eventos',
        tarifaMonto: '120',
        tarifaUnidad: 'NOCHE',
      }).expect(201);

      const found = await http()
        .get(`/api/v1/publicaciones/${body.id}`)
        .expect(200);
      expect(found.body).toMatchObject({
        tipo: 'ESPACIO',
        tarifaMonto: '120.00',
        tarifaUnidad: 'NOCHE',
        depositoMonto: '0.00',
      });
    });

    it('P03: acepta exactamente 10 fotos y un nombre de 100 caracteres', async () => {
      const ten = Array.from({ length: 10 }, (_, i) => ({
        buffer: JPG,
        name: `f${i}.jpg`,
      }));
      const { body } = await publish({ nombre: 'n'.repeat(100) }, ten).expect(
        201,
      );

      expect(
        await prisma.listingImage.count({ where: { listingId: body.id } }),
      ).toBe(10);
    });
  });

  describe('casos inválidos: responden 400 y no guardan nada', () => {
    const big = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]);

    it.each([
      ['P04', 'tarifa cero', { tarifaMonto: '0' }, undefined],
      ['P05', 'depósito negativo', { depositoMonto: '-1' }, undefined],
      [
        'P06',
        'unidad de cobro no permitida',
        { tarifaUnidad: 'MES' },
        undefined,
      ],
      ['P07', 'nombre vacío', { nombre: '   ' }, undefined],
      [
        'P08',
        'nombre de 101 caracteres',
        { nombre: 'n'.repeat(101) },
        undefined,
      ],
      ['P09', '0 fotografías', {}, []],
      [
        'P10',
        '11 fotografías',
        {},
        Array.from({ length: 11 }, (_, i) => ({
          buffer: JPG,
          name: `f${i}.jpg`,
        })),
      ],
      [
        'P11',
        'imagen de más de 5 MB',
        {},
        [{ buffer: big, name: 'grande.jpg' }],
      ],
      [
        'P12',
        'archivo que no es JPG ni PNG (PDF renombrado)',
        {},
        [{ buffer: PDF, name: 'x.jpg' }],
      ],
      [
        'P13',
        'una foto buena y otra mala en la misma petición',
        {},
        [
          { buffer: JPG, name: 'bien.jpg' },
          { buffer: PDF, name: 'mal.png' },
        ],
      ],
    ])('%s: %s', async (_id, _case, fields, images) => {
      const listingsBefore = await countListings();
      const filesBefore = await countFiles();

      await publish(fields as Record<string, string>, images).expect(400);

      expect(await countListings()).toBe(listingsBefore);
      expect(await countFiles()).toBe(filesBefore);
    });
  });

  describe('permisos', () => {
    it('P14: un arrendatario no puede publicar (403)', async () => {
      const before = await countListings();
      await publish({}, undefined, 'tenant').expect(403);
      expect(await countListings()).toBe(before);
    });

    it('P15: sin sesión responde 401', async () => {
      await http()
        .post('/api/v1/publicaciones')
        .field('tipo', 'EQUIPO')
        .expect(401);
    });

    it('P16: la publicación queda a nombre de quien la crea, nunca de otro', async () => {
      // El backend ignora cualquier dueño que mande el cliente: no está en el
      // DTO y el ValidationPipe lo rechaza.
      await publish({ arrendadorId: userId.other }).expect(400);

      const { body } = await publish({}, undefined, 'other').expect(201);
      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(saved.landlordId).toBe(userId.other);
      expect(saved.landlordId).not.toBe(userId.owner);
    });

    it('P17: nadie puede modificar una publicación, ni el dueño ni otro arrendador', async () => {
      const { body } = await publish().expect(201);
      for (const who of ['owner', 'other'] as const) {
        for (const method of ['put', 'patch', 'delete'] as const) {
          const res = await http()
            [method](`/api/v1/publicaciones/${body.id}`)
            .set('Authorization', `Bearer ${token[who]}`)
            .send({ nombre: `Cambiado por ${who}` });
          expect(res.status).toBe(404);
        }
      }
      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(saved.name).toBe('Taladro percutor');
    });

    it('P18: una publicación desactivada no se puede consultar (404)', async () => {
      const { body } = await publish().expect(201);
      await prisma.listing.update({
        where: { id: body.id },
        data: { isActive: false },
      });

      await http().get(`/api/v1/publicaciones/${body.id}`).expect(404);
      await http()
        .get(`/api/v1/publicaciones/${body.id}/imagenes/0`)
        .expect(404);
    });
  });
});
