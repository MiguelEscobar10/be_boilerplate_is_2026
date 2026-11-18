import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import type { ReservationStatus } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Consulta de disponibilidad (BE-13.1) con la app completa contra la base de
 * pruebas (ver test/helpers/test-database.ts).
 *
 * Crea un arrendador, un arrendatario y sus publicaciones con un email único,
 * y al final borra solo eso. Las reservas se crean directo en la base con el
 * estado que cada caso necesita: BE-03.1 y BE-04.1 todavía no están en main.
 */
const prisma = createTestPrismaClient();

/** Hora local de El Salvador → instante. `local(12, 9)` = 12 de nov, 09:00. */
const local = (day: number, hour = 0, month = 11) =>
  new Date(Date.UTC(2026, month - 1, day, hour + 6));

describe('disponibilidad de una publicación (BE-13.1)', () => {
  const sufijo = `be-13.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let landlordId: string;
  let tenantId: string;

  const ruta = (id: string) => `/api/v1/publicaciones/${id}/disponibilidad`;
  const consultar = (
    id: string,
    query: Record<string, string> = {
      desde: '2026-11-01',
      hasta: '2026-11-30',
    },
  ) => request(app.getHttpServer()).get(ruta(id)).query(query);

  const newListing = async (isActive = true) =>
    (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name: 'Taladro percutor',
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'HORA',
          isActive,
        },
      })
    ).id;

  const reserve = (
    listingId: string,
    startAt: Date,
    endAt: Date,
    status: ReservationStatus = 'CONFIRMADA',
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId,
        startAt,
        endAt,
        status,
        rentalCost: '45.00',
        depositAmount: '0.00',
      },
    });

  const block = (listingId: string, startAt: Date, endAt: Date) =>
    prisma.availabilityBlock.create({
      data: {
        listingId,
        startAt,
        endAt,
        reason: 'Mantenimiento privado',
        createdById: landlordId,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Mismas opciones que main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const landlord = await prisma.user.create({
      data: {
        email: `landlord-${sufijo}`,
        passwordHash: 'no-es-un-hash-real',
        role: 'ARRENDADOR',
      },
    });
    const tenant = await prisma.user.create({
      data: { email: `tenant-${sufijo}`, passwordHash: 'no-es-un-hash-real' },
    });
    landlordId = landlord.id;
    tenantId = tenant.id;
  });

  afterAll(async () => {
    // Primero las reservas (RESTRICT); los bloqueos se van con la publicación.
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: sufijo } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: sufijo } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: sufijo } } });
    await app.close();
    await prisma.$disconnect();
  });

  describe('respuesta', () => {
    it('es pública: responde 200 sin token', async () => {
      const id = await newListing();

      const res = await consultar(id).expect(200);

      expect(res.body).toEqual({
        publicacionId: id,
        desde: '2026-11-01',
        hasta: '2026-11-30',
        ocupados: [],
      });
    });

    it('devuelve las reservas CONFIRMADA y EN_CURSO y los bloqueos, en orden y en hora local', async () => {
      const id = await newListing();
      await block(id, local(20), local(22));
      await reserve(id, local(12, 9), local(12, 12), 'CONFIRMADA');
      await reserve(id, local(5), local(7), 'EN_CURSO');

      const res = await consultar(id).expect(200);

      expect(res.body.ocupados).toEqual([
        {
          inicio: '2026-11-05T00:00:00-06:00',
          fin: '2026-11-07T00:00:00-06:00',
          origen: 'RESERVA',
        },
        {
          inicio: '2026-11-12T09:00:00-06:00',
          fin: '2026-11-12T12:00:00-06:00',
          origen: 'RESERVA',
        },
        {
          inicio: '2026-11-20T00:00:00-06:00',
          fin: '2026-11-22T00:00:00-06:00',
          origen: 'BLOQUEO',
        },
      ]);
    });

    it.each(['PENDIENTE', 'RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
      'una reserva %s no aparece como ocupada',
      async (status) => {
        const id = await newListing();
        await reserve(id, local(10), local(12), status);

        const res = await consultar(id).expect(200);

        expect(res.body.ocupados).toEqual([]);
      },
    );

    it('no devuelve quién reservó ni el motivo del bloqueo', async () => {
      const id = await newListing();
      await reserve(id, local(10), local(12));
      await block(id, local(20), local(22));

      const res = await consultar(id).expect(200);

      expect(res.body.ocupados).toHaveLength(2);
      for (const ocupado of res.body.ocupados) {
        expect(Object.keys(ocupado).sort()).toEqual([
          'fin',
          'inicio',
          'origen',
        ]);
      }
      const texto = JSON.stringify(res.body);
      expect(texto).not.toContain(tenantId);
      expect(texto).not.toContain(landlordId);
      expect(texto).not.toContain('Mantenimiento privado');
    });

    it('no mezcla los períodos de otra publicación', async () => {
      const id = await newListing();
      const otra = await newListing();
      await reserve(otra, local(10), local(12));

      const res = await consultar(id).expect(200);

      expect(res.body.ocupados).toEqual([]);
    });
  });

  describe('bordes del rango (hora de El Salvador)', () => {
    it('hasta va incluido: una reserva del último día por la noche sí entra', async () => {
      const id = await newListing();
      // 30 de nov, de 21:00 a 23:00 local: en UTC ya es 1 de diciembre.
      await reserve(id, local(30, 21), local(30, 23));

      const res = await consultar(id).expect(200);

      expect(res.body.ocupados).toEqual([
        {
          inicio: '2026-11-30T21:00:00-06:00',
          fin: '2026-11-30T23:00:00-06:00',
          origen: 'RESERVA',
        },
      ]);
    });

    it('lo que empieza a la medianoche del día siguiente a hasta no entra', async () => {
      const id = await newListing();
      await reserve(id, local(1, 0, 12), local(2, 0, 12));

      const res = await consultar(id).expect(200);

      expect(res.body.ocupados).toEqual([]);
    });

    it('lo que termina justo a la medianoche de desde no entra', async () => {
      const id = await newListing();
      await reserve(id, local(30, 0, 10), local(1));

      const res = await consultar(id).expect(200);

      expect(res.body.ocupados).toEqual([]);
    });

    it('un período que cruza el borde sale completo, sin recortar', async () => {
      const id = await newListing();
      await block(id, local(29), local(3, 0, 12));

      const res = await consultar(id).expect(200);

      expect(res.body.ocupados).toEqual([
        {
          inicio: '2026-11-29T00:00:00-06:00',
          fin: '2026-12-03T00:00:00-06:00',
          origen: 'BLOQUEO',
        },
      ]);
    });

    it('acepta un rango de un solo día', async () => {
      const id = await newListing();
      await reserve(id, local(12, 9), local(12, 12));
      await reserve(id, local(13, 9), local(13, 12));

      const res = await consultar(id, {
        desde: '2026-11-12',
        hasta: '2026-11-12',
      }).expect(200);

      expect(res.body.ocupados).toHaveLength(1);
      expect(res.body.ocupados[0].inicio).toBe('2026-11-12T09:00:00-06:00');
    });

    it('acepta un rango de 92 días', async () => {
      const id = await newListing();

      await consultar(id, { desde: '2026-10-01', hasta: '2026-12-31' }).expect(
        200,
      );
    });
  });

  describe('400: rango inválido', () => {
    let id: string;
    beforeAll(async () => {
      id = await newListing();
    });

    it.each([
      ['hasta anterior a desde', { desde: '2026-11-10', hasta: '2026-11-09' }],
      ['rango de 93 días', { desde: '2026-10-01', hasta: '2027-01-01' }],
      ['falta desde', { hasta: '2026-11-30' }],
      ['falta hasta', { desde: '2026-11-01' }],
      ['sin fechas', {}],
      ['desde con otro formato', { desde: '01/11/2026', hasta: '2026-11-30' }],
      [
        'hasta con hora',
        { desde: '2026-11-01', hasta: '2026-11-30T00:00:00Z' },
      ],
      ['desde vacío', { desde: '', hasta: '2026-11-30' }],
      ['fecha que no existe', { desde: '2026-02-30', hasta: '2026-03-10' }],
      ['mes 13', { desde: '2026-11-01', hasta: '2026-13-01' }],
      [
        'parámetro que no existe',
        { desde: '2026-11-01', hasta: '2026-11-30', estado: 'PENDIENTE' },
      ],
    ] as [string, Record<string, string>][])('%s', async (_caso, query) => {
      const res = await consultar(id, query).expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('un id que no es UUID', async () => {
      const res = await consultar('17').expect(400);

      expect(res.body.message).toBe(
        'El id de la publicación debe ser un UUID.',
      );
    });

    it('explica qué falló', async () => {
      const res = await consultar(id, {
        desde: '2026-10-01',
        hasta: '2027-01-01',
      }).expect(400);

      expect(res.body.message).toBe(
        'El rango puede tener como máximo 92 días.',
      );
    });
  });

  describe('404: publicación', () => {
    it('que no existe', async () => {
      await consultar(randomUUID()).expect(404);
    });

    it('inactiva, aunque tenga reservas', async () => {
      const id = await newListing(false);
      await reserve(id, local(10), local(12));

      const res = await consultar(id).expect(404);

      expect(JSON.stringify(res.body)).not.toContain('ocupados');
    });

    it('un rango inválido da 400 aunque la publicación no exista', async () => {
      await consultar(randomUUID(), {
        desde: '2026-11-10',
        hasta: '2026-11-09',
      }).expect(400);
    });
  });

  it('la ruta del detalle de la publicación sigue funcionando', async () => {
    const id = await newListing();

    const res = await request(app.getHttpServer())
      .get(`/api/v1/publicaciones/${id}`)
      .expect(200);

    expect(res.body.id).toBe(id);
  });
});
