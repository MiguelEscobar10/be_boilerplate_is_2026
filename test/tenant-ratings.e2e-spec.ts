import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '@Prisma/services';
import type { ReservationStatus, UserRole } from '@PrismaClient';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Calificación del arrendatario (BE-18.1) con la app completa contra la base
 * de pruebas (ver test/helpers/test-database.ts).
 *
 * Crea dos arrendadores y un arrendatario con email único, firma sus tokens
 * con el JwtService de la app y al final borra solo lo que creó. Las reservas
 * se crean directo en la base con el estado que cada caso necesita: llegar a
 * COMPLETADA requiere la devolución (BE-09.2), que todavía no está en main.
 */
const prisma = createTestPrismaClient();

interface Cuenta {
  id: string;
  token: string;
}

describe('calificar al arrendatario (BE-18.1)', () => {
  const sufijo = `be-18.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let arrendador: Cuenta;
  let otroArrendador: Cuenta;
  let arrendatario: Cuenta;
  let listingId: string;

  const auth = (req: request.Test, cuenta: Cuenta | null) =>
    cuenta ? req.set('Authorization', `Bearer ${cuenta.token}`) : req;
  const calificar = (
    reservaId: string,
    body: Record<string, unknown> = { puntaje: 5 },
    cuenta: Cuenta | null = arrendador,
  ) =>
    auth(
      request(app.getHttpServer())
        .post(`/api/v1/reservas/${reservaId}/calificacion-arrendatario`)
        .send(body),
      cuenta,
    );

  const reservar = async (
    status: ReservationStatus = 'COMPLETADA',
    listing = listingId,
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId: listing,
          tenantId: arrendatario.id,
          startAt: new Date('2026-10-01T15:00:00Z'),
          endAt: new Date('2026-10-01T18:00:00Z'),
          status,
          rentalCost: '45.00',
          depositAmount: '0.00',
        },
      })
    ).id;
  const calificacionesDe = (reservationId: string) =>
    prisma.tenantRating.findMany({ where: { reservationId } });

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

    const jwt = app.get(JwtService);
    const crear = async (nombre: string, role: UserRole): Promise<Cuenta> => {
      const email = `${nombre}-${sufijo}`;
      const { id } = await prisma.user.create({
        data: {
          email,
          passwordHash: 'no-es-un-hash-real',
          role,
          profile: { create: { name: `Cuenta ${nombre}`, phone: '70000000' } },
        },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    arrendador = await crear('arrendador', 'ARRENDADOR');
    otroArrendador = await crear('otro', 'ARRENDADOR');
    arrendatario = await crear('arrendatario', 'ARRENDATARIO');
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId: arrendador.id,
          type: 'EQUIPO',
          name: 'Generador',
          location: 'Soyapango',
          rateAmount: '15.00',
          rateUnit: 'HORA',
        },
      })
    ).id;
  });

  afterAll(async () => {
    // De abajo hacia arriba: todas las FK son RESTRICT.
    await prisma.tenantRating.deleteMany({
      where: { tenant: { email: { endsWith: sufijo } } },
    });
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

  it('201: guarda la calificación y devuelve su id', async () => {
    const reserva = await reservar();

    const res = await calificar(reserva, {
      puntaje: 4,
      comentario: 'Devolvió el equipo a tiempo',
    }).expect(201);

    expect(res.body).toEqual({ id: expect.any(String) as string });
    const [guardada] = await calificacionesDe(reserva);
    expect(guardada).toMatchObject({
      id: res.body.id as string,
      authorId: arrendador.id,
      tenantId: arrendatario.id,
      score: 4,
      comment: 'Devolvió el equipo a tiempo',
    });
  });

  it.each([1, 5])('acepta el puntaje %i', async (puntaje) => {
    await calificar(await reservar(), { puntaje }).expect(201);
  });

  it('sin comentario, con comentario de solo espacios y con comentario recortado', async () => {
    const sin = await reservar();
    const blanco = await reservar();
    const recortado = await reservar();

    await calificar(sin, { puntaje: 5 }).expect(201);
    await calificar(blanco, { puntaje: 5, comentario: '   ' }).expect(201);
    await calificar(recortado, {
      puntaje: 5,
      comentario: '  Muy puntual  ',
    }).expect(201);

    expect((await calificacionesDe(sin))[0].comment).toBeNull();
    expect((await calificacionesDe(blanco))[0].comment).toBeNull();
    expect((await calificacionesDe(recortado))[0].comment).toBe('Muy puntual');
  });

  it('acepta un comentario de 500 caracteres', async () => {
    const reserva = await reservar();

    await calificar(reserva, {
      puntaje: 5,
      comentario: 'ñ'.repeat(500),
    }).expect(201);

    expect((await calificacionesDe(reserva))[0].comment).toHaveLength(500);
  });

  describe('409: ya calificada', () => {
    it('una segunda calificación da "Esta reserva ya fue calificada." y no cambia la primera', async () => {
      const reserva = await reservar();
      await calificar(reserva, { puntaje: 5 }).expect(201);

      const res = await calificar(reserva, { puntaje: 1 }).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        codigo: 'RESERVA_YA_CALIFICADA',
        message: 'Esta reserva ya fue calificada.',
      });
      const calificaciones = await calificacionesDe(reserva);
      expect(calificaciones).toHaveLength(1);
      expect(calificaciones[0].score).toBe(5);
    });

    it('dos envíos a la vez: uno 201 y otro 409', async () => {
      const reserva = await reservar();

      const respuestas = await Promise.all([
        calificar(reserva, { puntaje: 5 }),
        calificar(reserva, { puntaje: 2 }),
      ]);

      expect(respuestas.map((res) => res.status).sort((a, b) => a - b)).toEqual(
        [201, 409],
      );
      expect(await calificacionesDe(reserva)).toHaveLength(1);
    });
  });

  it.each([
    'PENDIENTE',
    'CONFIRMADA',
    'RECHAZADA',
    'CANCELADA',
    'EN_CURSO',
  ] as const)(
    '422 RESERVA_NO_COMPLETADA si la reserva está %s',
    async (status) => {
      const reserva = await reservar(status);

      const res = await calificar(reserva).expect(422);

      expect(res.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        codigo: 'RESERVA_NO_COMPLETADA',
        message:
          'Solo puedes calificar al arrendatario de una reserva COMPLETADA.',
      });
      expect(await calificacionesDe(reserva)).toEqual([]);
    },
  );

  describe('permisos', () => {
    it('401 sin sesión', async () => {
      const reserva = await reservar();

      await calificar(reserva, { puntaje: 5 }, null).expect(401);
    });

    it('403 para el arrendatario, aunque la reserva sea suya', async () => {
      const reserva = await reservar();

      await calificar(reserva, { puntaje: 5 }, arrendatario).expect(403);
      expect(await calificacionesDe(reserva)).toEqual([]);
    });

    it('404 si la reserva es de un bien de otro arrendador', async () => {
      const reserva = await reservar();

      const res = await calificar(
        reserva,
        { puntaje: 5 },
        otroArrendador,
      ).expect(404);

      expect(res.body.message).toBe('La reserva no existe.');
      expect(await calificacionesDe(reserva)).toEqual([]);
    });

    it('404 si la reserva no existe', async () => {
      await calificar(randomUUID()).expect(404);
    });
  });

  describe('400: datos inválidos', () => {
    it.each([
      ['sin puntaje', {}],
      ['puntaje 0', { puntaje: 0 }],
      ['puntaje 6', { puntaje: 6 }],
      ['puntaje negativo', { puntaje: -1 }],
      ['puntaje con decimales', { puntaje: 4.5 }],
      ['puntaje en texto', { puntaje: '5' }],
      [
        'comentario de 501 caracteres',
        { puntaje: 5, comentario: 'a'.repeat(501) },
      ],
      ['comentario que no es texto', { puntaje: 5, comentario: 10 }],
      ['propiedad de más', { puntaje: 5, arrendatarioId: randomUUID() }],
    ] as [string, Record<string, unknown>][])('%s', async (_caso, body) => {
      const reserva = await reservar();

      await calificar(reserva, body).expect(400);

      expect(await calificacionesDe(reserva)).toEqual([]);
    });

    it('explica qué corregir (H18, criterio 5)', async () => {
      const res = await calificar(await reservar(), { puntaje: 7 }).expect(400);

      expect(res.body.message).toEqual(['puntaje debe estar entre 1 y 5.']);
    });

    it('un id que no es UUID', async () => {
      const res = await calificar('91').expect(400);

      expect(res.body.message).toBe('El id de la reserva debe ser un UUID.');
    });
  });

  it('el panel de solicitudes marca qué reservas ya tienen calificación', async () => {
    const listing = (
      await prisma.listing.create({
        data: {
          landlordId: arrendador.id,
          type: 'EQUIPO',
          name: 'Andamio',
          location: 'Soyapango',
          rateAmount: '15.00',
          rateUnit: 'HORA',
        },
      })
    ).id;
    const calificada = await reservar('COMPLETADA', listing);
    const sinCalificar = await reservar('COMPLETADA', listing);
    await calificar(calificada).expect(201);

    const res = await auth(
      request(app.getHttpServer())
        .get('/api/v1/arrendador/solicitudes')
        .query({ estado: 'COMPLETADA', limit: '50' }),
      arrendador,
    ).expect(200);

    const marca = (id: string) =>
      (
        res.body.items as { id: string; arrendatarioCalificado: boolean }[]
      ).find((item) => item.id === id)?.arrendatarioCalificado;
    expect(marca(calificada)).toBe(true);
    expect(marca(sinCalificar)).toBe(false);
  });
});
