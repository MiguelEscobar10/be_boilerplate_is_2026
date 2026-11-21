import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

/**
 * Detalle completo de una publicación (BE-12.1).
 *
 * Levanta la app completa contra la base de pruebas (local y terminada en
 * `_test`). Las publicaciones, las reservas y las calificaciones se crean
 * directo en la base.
 */
describe('detalle completo de la publicación (BE-12.1)', () => {
  const email = `be-12.1-${randomUUID()}@test.local`;
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;
  let otherListingId: string;
  let unratedId: string;
  let inactiveId: string;

  const detail = (id: string) =>
    request(app.getHttpServer()).get(`/api/v1/publicaciones/${id}`);

  const newListing = async (ownerId: string, name: string, extra = {}) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: ownerId,
          type: 'EQUIPO',
          name,
          location: 'San Salvador',
          rateAmount: '15.00',
          rateUnit: 'HORA',
          ...extra,
        },
      })
    ).id;

  /** Una calificación necesita su propia reserva (una por reserva). */
  const rate = async (
    listing: string,
    owner: string,
    listingScore: number,
    landlordScore: number,
  ) => {
    const reservation = await prisma.reservation.create({
      data: {
        listingId: listing,
        tenantId,
        startAt: new Date('2026-10-01T15:00:00Z'),
        endAt: new Date('2026-10-02T15:00:00Z'),
        status: 'COMPLETADA',
        rentalCost: '30.00',
        depositAmount: '0.00',
      },
    });
    await prisma.listingLandlordRating.create({
      data: {
        reservationId: reservation.id,
        authorId: tenantId,
        listingId: listing,
        landlordId: owner,
        listingScore,
        landlordScore,
      },
    });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();

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

    const user = (kind: string) =>
      prisma.user.create({
        data: {
          email: `${kind}-${email}`,
          passwordHash: 'no-es-un-hash-real',
          profile: {
            create: { name: 'Nombre Privado', phone: '70009999' },
          },
        },
      });
    landlordId = (await user('landlord')).id;
    tenantId = (await user('tenant')).id;
    const otherLandlordId = (await user('other-landlord')).id;

    listingId = await newListing(landlordId, 'Taladro', {
      description: 'Percutor de 800 W',
      depositAmount: '20.00',
      conditions: 'Devolver limpio',
      requiresVerification: true,
    });
    otherListingId = await newListing(landlordId, 'Escalera');
    unratedId = await newListing(otherLandlordId, 'Andamio');
    inactiveId = await newListing(landlordId, 'Desactivada', {
      isActive: false,
    });

    // Las fotos se guardan desordenadas a propósito.
    await prisma.listingImage.createMany({
      data: [2, 0, 1].map((position) => ({
        listingId,
        path: `listings/foto-${position}.jpg`,
        position,
      })),
    });

    // Taladro: bien 5, 4, 4 → 4.3. Arrendador: 5, 5, 4 y el 3 de la Escalera → 4.3.
    await rate(listingId, landlordId, 5, 5);
    await rate(listingId, landlordId, 4, 5);
    await rate(listingId, landlordId, 4, 4);
    await rate(otherListingId, landlordId, 2, 3);
  });

  afterAll(async () => {
    // De abajo hacia arriba: las FK son RESTRICT.
    await prisma.listingLandlordRating.deleteMany({
      where: { author: { email: { endsWith: email } } },
    });
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  it('una publicación activa devuelve todo el detalle, sin sesión', async () => {
    const { body } = await detail(listingId).expect(200);

    expect(body).toEqual({
      id: listingId,
      tipo: 'EQUIPO',
      nombre: 'Taladro',
      descripcion: 'Percutor de 800 W',
      ubicacion: 'San Salvador',
      tarifa: { monto: 15, unidad: 'HORA' },
      deposito: 20,
      condiciones: 'Devolver limpio',
      imagenes: [0, 1, 2].map((orden) => ({
        orden,
        url: `/api/v1/publicaciones/${listingId}/imagenes/${orden}`,
      })),
      promedioBien: 4.3,
      promedioArrendador: 4.3,
      totalCalificaciones: 3,
      requiereVerificacion: true,
      // Campos de BE-01.1 que se conservan.
      activo: true,
      arrendadorId: landlordId,
      tarifaMonto: '15.00',
      tarifaUnidad: 'HORA',
      depositoMonto: '20.00',
      createdAt: expect.any(String),
    });
  });

  it('las fotos salen en orden aunque se guardaron desordenadas', async () => {
    const { body } = await detail(listingId).expect(200);

    expect(body.imagenes.map((i: { orden: number }) => i.orden)).toEqual([
      0, 1, 2,
    ]);
  });

  it('el promedio del bien es de la publicación y el del arrendador junta todas las suyas', async () => {
    const { body } = await detail(otherListingId).expect(200);

    expect(body).toMatchObject({
      promedioBien: 2,
      promedioArrendador: 4.3,
      totalCalificaciones: 1,
    });
  });

  it('sin calificaciones devuelve promedios null y totalCalificaciones 0', async () => {
    const { body } = await detail(unratedId).expect(200);

    expect(body).toMatchObject({
      promedioBien: null,
      promedioArrendador: null,
      totalCalificaciones: 0,
      requiereVerificacion: false,
      deposito: 0,
      descripcion: null,
      condiciones: null,
      imagenes: [],
    });
  });

  it('una calificación nueva se refleja en el detalle', async () => {
    const id = await newListing(landlordId, 'Proyector');
    expect((await detail(id).expect(200)).body.totalCalificaciones).toBe(0);

    await rate(id, landlordId, 5, 5);

    expect((await detail(id).expect(200)).body).toMatchObject({
      promedioBien: 5,
      totalCalificaciones: 1,
    });
  });

  it('no expone datos privados del arrendador', async () => {
    const { text } = await detail(listingId).expect(200);

    expect(text).not.toContain(email);
    expect(text).not.toContain('Nombre Privado');
    expect(text).not.toContain('70009999');
    expect(text).not.toContain('passwordHash');
    // Ni la ruta de las fotos en el servidor.
    expect(text).not.toContain('listings/foto-');
  });

  it.each([
    ['desactivada', () => inactiveId],
    ['inexistente', () => randomUUID()],
  ])(
    'una publicación %s devuelve 404 PUBLICACION_NO_DISPONIBLE',
    async (_caso, id) => {
      const { body } = await detail(id()).expect(404);

      expect(body).toEqual({
        statusCode: 404,
        codigo: 'PUBLICACION_NO_DISPONIBLE',
        message: 'La publicación no existe o no está disponible.',
        error: 'Not Found',
      });
    },
  );

  it('el 404 es idéntico para la desactivada y la inexistente', async () => {
    const inactive = await detail(inactiveId).expect(404);
    const missing = await detail(randomUUID()).expect(404);

    expect(inactive.body).toEqual(missing.body);
  });

  it('un id que no es UUID es 400', async () => {
    await detail('17').expect(400);
  });

  it('al desactivar la publicación su detalle deja de estar disponible', async () => {
    const id = await newListing(landlordId, 'Temporal');
    await detail(id).expect(200);

    await prisma.listing.update({ where: { id }, data: { isActive: false } });

    expect((await detail(id).expect(404)).body.codigo).toBe(
      'PUBLICACION_NO_DISPONIBLE',
    );
  });
});
