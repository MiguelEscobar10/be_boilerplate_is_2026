import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-12.1 (MP4-39): detalle completo de una publicación y publicaciones
 * desactivadas (H12).
 *
 * Cada caso tiene un id (C01, C02...) que se repite en la evidencia de
 * docs/qa/QA-12.1-detalle.md. Se compara lo que responde
 * `GET /publicaciones/{id}` con lo que hay en la base.
 *
 * Las publicaciones, las reservas y las calificaciones se crean directo en la
 * base; la desactivación también, porque todavía no hay un endpoint para eso.
 */
describe('QA-12.1: detalle completo y publicaciones desactivadas', () => {
  const email = `qa-12.1-${randomUUID()}@test.local`;
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
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

  describe('criterio 1: el detalle de una publicación activa', () => {
    it('C01: trae descripción, ubicación, tarifa con su unidad, depósito y condiciones', async () => {
      const { body } = await detail(listingId).expect(200);

      expect(body).toMatchObject({
        id: listingId,
        tipo: 'EQUIPO',
        nombre: 'Taladro',
        descripcion: 'Percutor de 800 W',
        ubicacion: 'San Salvador',
        tarifa: { monto: 15, unidad: 'HORA' },
        deposito: 20,
        condiciones: 'Devolver limpio',
      });
    });

    it('C02: las fotos salen en orden y cada una se puede pedir por su orden', async () => {
      const { body } = await detail(listingId).expect(200);

      expect(body.imagenes).toEqual(
        [0, 1, 2].map((orden) => ({
          orden,
          url: `/api/v1/publicaciones/${listingId}/imagenes/${orden}`,
        })),
      );
    });

    it('C03: la tarifa y el depósito coinciden con lo guardado en la base', async () => {
      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: listingId },
      });
      const { body } = await detail(listingId).expect(200);

      expect(body.tarifa.monto).toBe(saved.rateAmount.toNumber());
      expect(body.tarifa.unidad).toBe(saved.rateUnit);
      expect(body.deposito).toBe(saved.depositAmount.toNumber());
      // Los campos de BE-01.1 dicen lo mismo, como texto.
      expect(body.tarifaMonto).toBe(saved.rateAmount.toFixed(2));
      expect(body.depositoMonto).toBe(saved.depositAmount.toFixed(2));
    });

    it('C04: una publicación sin descripción, condiciones, depósito ni fotos responde igual, con esos campos vacíos', async () => {
      const { body } = await detail(unratedId).expect(200);

      expect(body).toMatchObject({
        descripcion: null,
        condiciones: null,
        deposito: 0,
        imagenes: [],
      });
    });
  });

  describe('criterio 2: condiciones y depósito para el formulario de solicitud', () => {
    it('C05: el detalle da las condiciones y el depósito que el formulario muestra antes de enviar', async () => {
      const { body } = await detail(listingId).expect(200);

      expect(body.condiciones).toBe('Devolver limpio');
      expect(body.depositoMonto).toBe('20.00');
    });
  });

  describe('criterio 3: promedios de calificaciones', () => {
    it('C06: con calificaciones aparece el promedio del bien y el del arrendador, con un decimal', async () => {
      const { body } = await detail(listingId).expect(200);

      // Bien: (5 + 4 + 4) / 3 = 4.33. Arrendador: (5 + 5 + 4 + 3) / 4 = 4.25.
      expect(body).toMatchObject({
        promedioBien: 4.3,
        promedioArrendador: 4.3,
        totalCalificaciones: 3,
      });
    });

    it('C07: el promedio del bien es de esa publicación; el del arrendador junta todas las suyas', async () => {
      const { body } = await detail(otherListingId).expect(200);

      expect(body).toMatchObject({
        promedioBien: 2,
        promedioArrendador: 4.3,
        totalCalificaciones: 1,
      });
    });

    it('C08: sin calificaciones los promedios son null y el total es 0', async () => {
      const { body } = await detail(unratedId).expect(200);

      expect(body).toMatchObject({
        promedioBien: null,
        promedioArrendador: null,
        totalCalificaciones: 0,
      });
    });

    it('C09: una publicación nueva de un arrendador ya calificado no tiene promedio del bien pero sí del arrendador', async () => {
      const id = await newListing(landlordId, 'Generador');

      const { body } = await detail(id).expect(200);

      expect(body).toMatchObject({
        promedioBien: null,
        promedioArrendador: 4.3,
        totalCalificaciones: 0,
      });
    });
  });

  describe('criterio 4: publicaciones desactivadas', () => {
    it('C10: una desactivada responde 404 PUBLICACION_NO_DISPONIBLE', async () => {
      const { body } = await detail(inactiveId).expect(404);

      expect(body.codigo).toBe('PUBLICACION_NO_DISPONIBLE');
    });

    it('C11: la respuesta no distingue una desactivada de una que no existe', async () => {
      const inactive = await detail(inactiveId).expect(404);
      const missing = await detail(randomUUID()).expect(404);

      expect(inactive.body).toEqual(missing.body);
    });

    it('C12: al desactivarla deja de abrirse y desaparece del catálogo', async () => {
      const id = await newListing(landlordId, `Temporal ${email}`);
      await detail(id).expect(200);
      const before = await request(app.getHttpServer())
        .get('/api/v1/publicaciones')
        .query({ buscar: `Temporal ${email}` })
        .expect(200);
      expect(before.body.total).toBe(1);

      await prisma.listing.update({ where: { id }, data: { isActive: false } });

      await detail(id).expect(404);
      const after = await request(app.getHttpServer())
        .get('/api/v1/publicaciones')
        .query({ buscar: `Temporal ${email}` })
        .expect(200);
      expect(after.body.total).toBe(0);
    });

    it('C13: las fotos de una desactivada tampoco se sirven', async () => {
      const id = await newListing(landlordId, 'Con foto', { isActive: false });
      await prisma.listingImage.create({
        data: { listingId: id, path: 'listings/x.jpg', position: 0 },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/publicaciones/${id}/imagenes/0`)
        .expect(404);
    });
  });

  describe('permisos de cada rol y datos privados', () => {
    it('C14: responde lo mismo sin sesión, como arrendatario y como arrendador', async () => {
      const anonymous = await detail(listingId).expect(200);

      for (const rol of ['ARRENDATARIO', 'ARRENDADOR'] as const) {
        const address = `${rol.toLowerCase()}-sesion-${email}`;
        await request(app.getHttpServer())
          .post('/api/v1/users')
          .send({
            email: address,
            password: 'Str0ngPass',
            rol,
            nombre: 'Persona QA',
            telefono: '70001234',
          })
          .expect(201);
        const login = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: address, password: 'Str0ngPass' })
          .expect(200);

        const res = await detail(listingId)
          .set('Authorization', `Bearer ${login.body.accessToken}`)
          .expect(200);
        expect(res.body).toEqual(anonymous.body);
      }
    });

    it('C15: no salen el nombre, el correo ni el teléfono del arrendador, ni la ruta de las fotos', async () => {
      const { text } = await detail(listingId).expect(200);

      expect(text).not.toContain(email);
      expect(text).not.toContain('Nombre Privado');
      expect(text).not.toContain('70009999');
      expect(text).not.toContain('listings/foto-');
    });

    it('C16: un id que no es UUID es 400', async () => {
      await detail('17').expect(400);
    });
  });
});
