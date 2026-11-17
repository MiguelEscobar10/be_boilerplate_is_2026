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
 * Bloqueo de fechas (BE-14.1) con la app completa contra la base de pruebas
 * (ver test/helpers/test-database.ts).
 *
 * Crea dos arrendadores y un arrendatario con email único, firma sus tokens
 * con el JwtService de la app y al final borra solo lo que creó. Las reservas
 * se crean directo en la base con el estado que cada caso necesita.
 */
const prisma = createTestPrismaClient();

/** Hora local de El Salvador → instante. `local(20)` = 20 de dic, 00:00. */
const local = (day: number, hour = 0) =>
  new Date(Date.UTC(2026, 11, day, hour + 6));
/** El mismo instante como lo escribe la API: `2026-12-20T00:00:00-06:00`. */
const iso = (day: number, hour = 0) =>
  `2026-12-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00-06:00`;

interface Cuenta {
  id: string;
  token: string;
}

describe('bloqueo de fechas (BE-14.1)', () => {
  const sufijo = `be-14.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let arrendador: Cuenta;
  let otroArrendador: Cuenta;
  let arrendatario: Cuenta;

  const auth = (req: request.Test, cuenta: Cuenta | null) =>
    cuenta ? req.set('Authorization', `Bearer ${cuenta.token}`) : req;
  const bloquear = (
    listingId: string,
    body: Record<string, unknown>,
    cuenta: Cuenta | null = arrendador,
  ) =>
    auth(
      request(app.getHttpServer())
        .post(`/api/v1/publicaciones/${listingId}/bloqueos`)
        .send(body),
      cuenta,
    );
  const listar = (listingId: string, cuenta: Cuenta | null = arrendador) =>
    auth(
      request(app.getHttpServer()).get(
        `/api/v1/publicaciones/${listingId}/bloqueos`,
      ),
      cuenta,
    );
  const disponibilidad = (listingId: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/publicaciones/${listingId}/disponibilidad`)
      .query({ desde: '2026-12-01', hasta: '2026-12-31' });

  const newListing = async (owner = arrendador, isActive = true) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.id,
          type: 'ESPACIO',
          name: 'Sala de reuniones',
          location: 'Santa Tecla',
          rateAmount: '25.00',
          rateUnit: 'DIA',
          isActive,
        },
      })
    ).id;

  const reservar = async (
    listingId: string,
    startAt: Date,
    endAt: Date,
    status: ReservationStatus,
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId: arrendatario.id,
          startAt,
          endAt,
          status,
          rentalCost: '50.00',
          depositAmount: '0.00',
        },
      })
    ).id;

  const contarBloqueos = (listingId: string) =>
    prisma.availabilityBlock.count({ where: { listingId } });

  const valido = { inicio: iso(20), fin: iso(22), motivo: 'Mantenimiento' };

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
        data: { email, passwordHash: 'no-es-un-hash-real', role },
      });
      return { id, token: await jwt.signAsync({ sub: id, email }) };
    };
    arrendador = await crear('arrendador', 'ARRENDADOR');
    otroArrendador = await crear('otro', 'ARRENDADOR');
    arrendatario = await crear('arrendatario', 'ARRENDATARIO');
  });

  afterAll(async () => {
    // Primero las reservas (RESTRICT); los bloqueos se van con la publicación
    // y recién entonces se pueden borrar sus autores.
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

  describe('POST /publicaciones/:id/bloqueos', () => {
    it('201: crea el bloqueo, guarda autor y fecha, y lo devuelve en hora local', async () => {
      const id = await newListing();

      const res = await bloquear(id, valido).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String) as string,
        publicacionId: id,
        inicio: '2026-12-20T00:00:00-06:00',
        fin: '2026-12-22T00:00:00-06:00',
        motivo: 'Mantenimiento',
      });
      const guardado = await prisma.availabilityBlock.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });
      expect(guardado).toMatchObject({
        listingId: id,
        startAt: local(20),
        endAt: local(22),
        reason: 'Mantenimiento',
        createdById: arrendador.id,
      });
      expect(guardado.createdAt).toBeInstanceOf(Date);
    });

    it('las fechas bloqueadas salen ocupadas en el calendario (H13), sin el motivo', async () => {
      const id = await newListing();
      await bloquear(id, valido).expect(201);

      const res = await disponibilidad(id).expect(200);

      expect(res.body.ocupados).toEqual([
        {
          inicio: '2026-12-20T00:00:00-06:00',
          fin: '2026-12-22T00:00:00-06:00',
          origen: 'BLOQUEO',
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('Mantenimiento');
    });

    it('sin motivo, con motivo de solo espacios y con motivo recortado', async () => {
      const id = await newListing();

      const sin = await bloquear(id, { inicio: iso(1), fin: iso(2) }).expect(
        201,
      );
      const blanco = await bloquear(id, {
        inicio: iso(3),
        fin: iso(4),
        motivo: '   ',
      }).expect(201);
      const recortado = await bloquear(id, {
        inicio: iso(5),
        fin: iso(6),
        motivo: '  Viaje  ',
      }).expect(201);

      expect(sin.body.motivo).toBeNull();
      expect(blanco.body.motivo).toBeNull();
      expect(recortado.body.motivo).toBe('Viaje');
    });

    it('acepta un motivo de 200 caracteres', async () => {
      const id = await newListing();

      const res = await bloquear(id, {
        ...valido,
        motivo: 'ñ'.repeat(200),
      }).expect(201);

      expect(res.body.motivo).toHaveLength(200);
    });

    it('acepta fechas en UTC y un bloqueo de unas horas', async () => {
      const id = await newListing();

      const res = await bloquear(id, {
        inicio: '2026-12-20T15:00:00Z',
        fin: '2026-12-20T18:00:00Z',
      }).expect(201);

      expect(res.body.inicio).toBe('2026-12-20T09:00:00-06:00');
      expect(res.body.fin).toBe('2026-12-20T12:00:00-06:00');
    });

    it('se puede bloquear una publicación desactivada', async () => {
      const id = await newListing(arrendador, false);

      await bloquear(id, valido).expect(201);
    });

    it('dos bloqueos que se cruzan entre sí se aceptan', async () => {
      const id = await newListing();

      await bloquear(id, valido).expect(201);
      await bloquear(id, { inicio: iso(21), fin: iso(23) }).expect(201);

      expect(await contarBloqueos(id)).toBe(2);
    });

    describe('409: el rango tiene una reserva', () => {
      it.each(['CONFIRMADA', 'EN_CURSO'] as const)(
        'que se cruza con una reserva %s',
        async (status) => {
          const id = await newListing();
          await reservar(id, local(21, 9), local(21, 12), status);

          const res = await bloquear(id, valido).expect(409);

          expect(res.body).toEqual({
            statusCode: 409,
            error: 'Conflict',
            codigo: 'RANGO_CON_RESERVA',
            message: 'El rango tiene una reserva CONFIRMADA o EN_CURSO.',
          });
          expect(await contarBloqueos(id)).toBe(0);
        },
      );

      it.each(['PENDIENTE', 'RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
        'una reserva %s no lo impide',
        async (status) => {
          const id = await newListing();
          await reservar(id, local(21), local(22), status);

          await bloquear(id, valido).expect(201);
        },
      );

      it('tocar el borde de una reserva no es conflicto', async () => {
        const id = await newListing();
        await reservar(id, local(18), local(20), 'CONFIRMADA');
        await reservar(id, local(22), local(24), 'CONFIRMADA');

        await bloquear(id, valido).expect(201);
      });

      it('una reserva de otra publicación no estorba', async () => {
        const id = await newListing();
        const otra = await newListing();
        await reservar(otra, local(20), local(22), 'CONFIRMADA');

        await bloquear(id, valido).expect(201);
      });
    });

    it('no cambia las solicitudes PENDIENTE, pero después ya no se pueden aprobar', async () => {
      const id = await newListing();
      const solicitud = await reservar(id, local(21), local(22), 'PENDIENTE');

      await bloquear(id, valido).expect(201);

      const despues = await prisma.reservation.findUniqueOrThrow({
        where: { id: solicitud },
      });
      expect(despues.status).toBe('PENDIENTE');
      const res = await auth(
        request(app.getHttpServer())
          .patch(`/api/v1/reservas/${solicitud}/decision`)
          .send({ decision: 'APROBAR' }),
        arrendador,
      ).expect(409);
      expect(res.body.codigo).toBe('CONFLICTO_DISPONIBILIDAD');
    });

    describe('permisos', () => {
      it('401 sin sesión', async () => {
        const id = await newListing();

        await bloquear(id, valido, null).expect(401);
        expect(await contarBloqueos(id)).toBe(0);
      });

      it('403 para un arrendatario', async () => {
        const id = await newListing();

        await bloquear(id, valido, arrendatario).expect(403);
        expect(await contarBloqueos(id)).toBe(0);
      });

      it('403 "Publicación no encontrada." si el bien es de otro arrendador', async () => {
        const id = await newListing();

        const res = await bloquear(id, valido, otroArrendador).expect(403);

        expect(res.body.message).toBe('Publicación no encontrada.');
        expect(await contarBloqueos(id)).toBe(0);
      });

      it('404 si la publicación no existe', async () => {
        const res = await bloquear(randomUUID(), valido).expect(404);

        expect(res.body.message).toBe('Publicación no encontrada.');
      });
    });

    describe('400: datos inválidos', () => {
      it.each([
        ['fin igual al inicio', { inicio: iso(20), fin: iso(20) }],
        ['fin anterior al inicio', { inicio: iso(22), fin: iso(20) }],
        ['sin inicio', { fin: iso(22) }],
        ['sin fin', { inicio: iso(20) }],
        ['inicio sin zona', { inicio: '2026-12-20T00:00:00', fin: iso(22) }],
        ['solo la fecha', { inicio: '2026-12-20', fin: '2026-12-22' }],
        ['otro formato', { inicio: '20/12/2026 00:00', fin: iso(22) }],
        [
          'fecha que no existe',
          { inicio: '2026-02-30T00:00:00-06:00', fin: iso(22) },
        ],
        ['inicio que no es texto', { inicio: 20, fin: iso(22) }],
        ['motivo de 201 caracteres', { ...valido, motivo: 'a'.repeat(201) }],
        ['motivo que no es texto', { ...valido, motivo: 5 }],
        ['propiedad de más', { ...valido, creadoPor: 'yo' }],
      ] as [string, Record<string, unknown>][])('%s', async (_caso, body) => {
        const id = await newListing();

        await bloquear(id, body).expect(400);

        expect(await contarBloqueos(id)).toBe(0);
      });

      it('fin anterior al inicio explica por qué (H14, criterio 4)', async () => {
        const id = await newListing();

        const res = await bloquear(id, {
          inicio: iso(22),
          fin: iso(20),
        }).expect(400);

        expect(res.body.message).toBe(
          'La fecha fin debe ser posterior a la de inicio.',
        );
      });

      it('un id que no es UUID', async () => {
        const res = await bloquear('17', valido).expect(400);

        expect(res.body.message).toBe(
          'El id de la publicación debe ser un UUID.',
        );
      });
    });

    describe('concurrencia con la aprobación (BE-04.1)', () => {
      it('aprobar una solicitud y bloquear sus fechas a la vez: gana uno solo', async () => {
        // Es una carrera y no siempre cae igual: se repite con varias
        // publicaciones, de cuatro en cuatro.
        const casos: { listing: string; solicitud: string }[] = [];
        for (let i = 0; i < 12; i++) {
          const listing = await newListing();
          casos.push({
            listing,
            solicitud: await reservar(
              listing,
              local(21),
              local(22),
              'PENDIENTE',
            ),
          });
        }

        for (let i = 0; i < casos.length; i += 4) {
          await Promise.all(
            casos.slice(i, i + 4).map(async ({ listing, solicitud }) => {
              const [aprobar, bloqueo] = await Promise.all([
                auth(
                  request(app.getHttpServer())
                    .patch(`/api/v1/reservas/${solicitud}/decision`)
                    .send({ decision: 'APROBAR' }),
                  arrendador,
                ),
                bloquear(listing, valido),
              ]);

              const estado = (
                await prisma.reservation.findUniqueOrThrow({
                  where: { id: solicitud },
                })
              ).status;
              const bloqueos = await contarBloqueos(listing);

              if (aprobar.status === 200) {
                // Ganó la aprobación: el bloqueo no se creó.
                expect(bloqueo.status).toBe(409);
                expect(estado).toBe('CONFIRMADA');
                expect(bloqueos).toBe(0);
              } else {
                // Ganó el bloqueo: la solicitud sigue PENDIENTE.
                expect(aprobar.status).toBe(409);
                expect(bloqueo.status).toBe(201);
                expect(estado).toBe('PENDIENTE');
                expect(bloqueos).toBe(1);
              }
            }),
          );
        }
      });
    });
  });

  describe('GET /publicaciones/:id/bloqueos', () => {
    it('devuelve los bloqueos de su publicación en orden y con el motivo', async () => {
      const id = await newListing();
      await bloquear(id, { inicio: iso(25), fin: iso(26), motivo: 'Feriado' });
      await bloquear(id, valido);

      const res = await listar(id).expect(200);

      expect(res.body.items.map((b: { inicio: string }) => b.inicio)).toEqual([
        '2026-12-20T00:00:00-06:00',
        '2026-12-25T00:00:00-06:00',
      ]);
      expect(res.body.items[1].motivo).toBe('Feriado');
    });

    it('una publicación sin bloqueos devuelve la lista vacía', async () => {
      const id = await newListing();

      const res = await listar(id).expect(200);

      expect(res.body).toEqual({ items: [] });
    });

    it('401 sin sesión, 403 para un arrendatario y para otro arrendador, 404 si no existe', async () => {
      const id = await newListing();

      await listar(id, null).expect(401);
      await listar(id, arrendatario).expect(403);
      await listar(id, otroArrendador).expect(403);
      await listar(randomUUID()).expect(404);
    });
  });
});
