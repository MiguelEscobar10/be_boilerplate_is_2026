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
 * Plan de pruebas, nivel componente: H01. Publicar un equipo o espacio.
 *
 * Un `it` por criterio de aceptación (AC1 a AC4), con el texto del criterio,
 * más los casos negativos de AC3 y AC4. La batería detallada de la historia
 * está en test/qa/qa-01.1-publicacion.e2e-spec.ts (P01 a P18).
 */

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const PDF = Buffer.from('%PDF-1.4 no soy una imagen');

type Who = 'landlord' | 'tenant';

describe('H01. Publicar un equipo o espacio', () => {
  const suffix = `plan-h01-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let uploadsDir: string;
  const token: Record<Who, string> = { landlord: '', tenant: '' };
  const userId: Record<Who, string> = { landlord: '', tenant: '' };

  const http = () => request(app.getHttpServer());

  async function account(who: Who, rol: 'ARRENDADOR' | 'ARRENDATARIO') {
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

  /** Petición con datos válidos; cada caso cambia solo lo que prueba. */
  function publish(
    fields: Record<string, string> = {},
    images: { buffer: Buffer; name: string }[] = [
      { buffer: JPG, name: 'foto.jpg' },
    ],
    who: Who = 'landlord',
  ) {
    const req = http()
      .post('/api/v1/publicaciones')
      .set('Authorization', `Bearer ${token[who]}`);
    const data: Record<string, string> = {
      tipo: 'EQUIPO',
      nombre: 'Proyector Full HD',
      ubicacion: 'San Salvador',
      tarifaMonto: '15.00',
      tarifaUnidad: 'DIA',
      ...fields,
    };
    for (const [k, v] of Object.entries(data)) {
      if (v !== '') void req.field(k, v);
    }
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
    uploadsDir = await mkdtemp(join(tmpdir(), 'plan-h01-'));
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

    await account('landlord', 'ARRENDADOR');
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

  it('AC1: como arrendador, al guardar una publicación con datos correctos queda visible en el catálogo', async () => {
    const nombre = `Proyector ${randomUUID().slice(0, 8)}`;
    const { body } = await publish({ nombre }).expect(201);

    const { body: page } = await http()
      .get('/api/v1/publicaciones')
      .query({ buscar: nombre })
      .expect(200);

    expect(page.items.map((i: { id: string }) => i.id)).toContain(body.id);
  });

  it('AC2: al consultar el detalle se ven el nombre, tipo, ubicación, tarifa, condiciones y fotografías registradas', async () => {
    const { body: created } = await publish(
      {
        tipo: 'ESPACIO',
        nombre: 'Sala de reuniones',
        ubicacion: 'Antiguo Cuscatlán',
        tarifaMonto: '20',
        tarifaUnidad: 'HORA',
        condiciones: 'Dejar la sala ordenada',
      },
      [
        { buffer: JPG, name: 'frente.jpg' },
        { buffer: PNG, name: 'lado.png' },
      ],
    ).expect(201);

    const { body } = await http()
      .get(`/api/v1/publicaciones/${created.id}`)
      .expect(200);

    expect(body).toMatchObject({
      tipo: 'ESPACIO',
      nombre: 'Sala de reuniones',
      ubicacion: 'Antiguo Cuscatlán',
      tarifa: { monto: 20, unidad: 'HORA' },
      condiciones: 'Dejar la sala ordenada',
    });
    expect(body.imagenes).toHaveLength(2);
    for (const img of body.imagenes as { url: string }[]) {
      await http().get(img.url).expect(200);
    }
  });

  describe('AC3: con datos inválidos se indica qué corregir y no se crea la publicación', () => {
    const invalid: [string, Record<string, string>][] = [
      ['falta el tipo', { tipo: '' }],
      ['falta el nombre', { nombre: '' }],
      ['falta la ubicación', { ubicacion: '' }],
      ['falta la tarifa', { tarifaMonto: '' }],
      ['falta la unidad de cobro', { tarifaUnidad: '' }],
      ['el nombre supera 100 caracteres', { nombre: 'x'.repeat(101) }],
      ['la tarifa es cero', { tarifaMonto: '0' }],
      ['la tarifa es negativa', { tarifaMonto: '-5' }],
      [
        'la unidad de cobro no es hora, día, noche o semana',
        { tarifaUnidad: 'MES' },
      ],
      ['el depósito es negativo', { depositoMonto: '-1' }],
    ];

    it.each(invalid)(
      'AC3 (negativo): %s responde 400 con el campo a corregir',
      async (_caso, fields) => {
        const listings = await countListings();
        const files = await countFiles();

        const { body } = await publish(fields).expect(400);

        expect(String(body.message).length).toBeGreaterThan(0);
        expect(await countListings()).toBe(listings);
        expect(await countFiles()).toBe(files);
      },
    );

    it('AC3 (negativo): sin fotografías no se publica', async () => {
      const listings = await countListings();
      await publish({}, []).expect(400);
      expect(await countListings()).toBe(listings);
    });

    it('AC3 (negativo): con más de 10 fotografías no se publica', async () => {
      const listings = await countListings();
      const eleven = Array.from({ length: 11 }, (_, i) => ({
        buffer: JPG,
        name: `f${i}.jpg`,
      }));
      await publish({}, eleven).expect(400);
      expect(await countListings()).toBe(listings);
    });

    it('AC3 (negativo): una fotografía que no es JPG ni PNG no se acepta', async () => {
      const listings = await countListings();
      await publish({}, [{ buffer: PDF, name: 'doc.pdf' }]).expect(400);
      expect(await countListings()).toBe(listings);
    });

    it('AC3 (negativo): una fotografía de más de 5 MB no se acepta', async () => {
      const listings = await countListings();
      const big = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024 + 1)]);
      const res = await publish({}, [{ buffer: big, name: 'grande.jpg' }]);
      expect([400, 413]).toContain(res.status);
      expect(await countListings()).toBe(listings);
    });
  });

  it('AC4 (negativo): con una cuenta de arrendatario no se puede registrar una publicación', async () => {
    const listings = await countListings();

    await publish({}, undefined, 'tenant').expect(403);

    expect(await countListings()).toBe(listings);
  });
});
