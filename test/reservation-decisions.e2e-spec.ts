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
 * Aprobación y rechazo de solicitudes (BE-04.1) con la app completa contra la
 * base de pruebas (ver test/helpers/test-database.ts).
 *
 * Crea dos arrendadores y un arrendatario con email único, firma sus tokens
 * con el JwtService de la app y al final borra solo lo que creó. Las
 * solicitudes se crean directo en la base: BE-03.1 todavía no está en main.
 */
const prisma = createTestPrismaClient();
const SOLICITUDES = '/api/v1/arrendador/solicitudes';

/** Hora local de El Salvador → instante. `local(12, 9)` = 12 de dic, 09:00. */
const local = (day: number, hour = 0) =>
  new Date(Date.UTC(2026, 11, day, hour + 6));

interface Cuenta {
  id: string;
  token: string;
}

describe('aprobar o rechazar una reserva (BE-04.1)', () => {
  const sufijo = `be-04.1-${randomUUID()}@test.local`;
  let app: INestApplication;
  let arrendador: Cuenta;
  let otroArrendador: Cuenta;
  let arrendatario: Cuenta;

  const auth = (req: request.Test, cuenta: Cuenta | null) =>
    cuenta ? req.set('Authorization', `Bearer ${cuenta.token}`) : req;
  const listar = (
    query: Record<string, string> = {},
    cuenta: Cuenta | null = arrendador,
  ) => auth(request(app.getHttpServer()).get(SOLICITUDES).query(query), cuenta);
  const decidir = (
    id: string,
    body: Record<string, unknown>,
    cuenta: Cuenta | null = arrendador,
  ) =>
    auth(
      request(app.getHttpServer())
        .patch(`/api/v1/reservas/${id}/decision`)
        .send(body),
      cuenta,
    );

  const newListing = async (owner = arrendador, name = 'Taladro percutor') =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.id,
          type: 'EQUIPO',
          name,
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'HORA',
        },
      })
    ).id;

  const solicitar = async (
    listingId: string,
    startAt = local(12, 9),
    endAt = local(12, 12),
    status: ReservationStatus = 'PENDIENTE',
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId,
          tenantId: arrendatario.id,
          startAt,
          endAt,
          status,
          rentalCost: '45.00',
          depositAmount: '20.00',
        },
      })
    ).id;

  const estadoDe = async (id: string) =>
    (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;
  const avisosDe = (reservationId: string) =>
    prisma.notification.findMany({
      where: { referenceType: 'reserva', referenceId: reservationId },
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
  });

  afterAll(async () => {
    // Primero las reservas: sus FK a publicación y usuarios son RESTRICT. Los
    // avisos y perfiles se van con el usuario (CASCADE).
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

  describe('GET /arrendador/solicitudes', () => {
    it('401 sin sesión', async () => {
      await listar({}, null).expect(401);
    });

    it('403 para un arrendatario', async () => {
      await listar({}, arrendatario).expect(403);
    });

    it('un arrendador sin solicitudes recibe la lista vacía', async () => {
      const res = await listar({}, otroArrendador).expect(200);

      expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 12 });
    });

    describe('con solicitudes', () => {
      let taladro: string;
      let ids: string[];
      let ajena: string;

      beforeAll(async () => {
        taladro = await newListing(arrendador, 'Taladro percutor');
        const sala = await newListing(arrendador, 'Sala de reuniones');
        // Cinco solicitudes del arrendador; la 5 es la más reciente.
        ids = [];
        const estados: ReservationStatus[] = [
          'PENDIENTE',
          'CONFIRMADA',
          'PENDIENTE',
          'RECHAZADA',
          'PENDIENTE',
        ];
        for (const [i, status] of estados.entries()) {
          const id = await solicitar(
            i % 2 === 0 ? taladro : sala,
            local(i + 1, 9),
            local(i + 1, 12),
            status,
          );
          await prisma.reservation.update({
            where: { id },
            data: { createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)) },
          });
          ids.push(id);
        }
        // Una solicitud sobre la publicación de otro arrendador.
        ajena = await solicitar(await newListing(otroArrendador, 'Ajena'));
      });

      it('devuelve solo las de sus publicaciones, de la más reciente a la más antigua', async () => {
        const res = await listar().expect(200);

        expect(res.body.total).toBe(5);
        expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(
          [...ids].reverse(),
        );
        expect(JSON.stringify(res.body)).not.toContain(ajena);
      });

      it('cada solicitud trae quién la hizo, el bien, las fechas, el costo y el estado', async () => {
        const res = await listar().expect(200);

        expect(res.body.items.at(-1)).toEqual({
          id: ids[0],
          estado: 'PENDIENTE',
          publicacion: { id: taladro, nombre: 'Taladro percutor' },
          arrendatario: { id: arrendatario.id, nombre: 'Cuenta arrendatario' },
          inicio: local(1, 9).toISOString(),
          fin: local(1, 12).toISOString(),
          costoEstimado: '45.00',
          depositoMonto: '20.00',
          creadaAt: '2026-11-01T10:00:00.000Z',
          decididaAt: null,
          motivoRechazo: null,
        });
      });

      it('no expone el correo ni el teléfono del arrendatario', async () => {
        const res = await listar().expect(200);

        const texto = JSON.stringify(res.body);
        expect(texto).not.toContain(sufijo);
        expect(texto).not.toContain('70000000');
      });

      it('filtra por estado', async () => {
        const res = await listar({ estado: 'PENDIENTE' }).expect(200);

        expect(res.body.total).toBe(3);
        expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
          ids[4],
          ids[2],
          ids[0],
        ]);
      });

      it('un estado sin solicitudes devuelve la lista vacía', async () => {
        const res = await listar({ estado: 'COMPLETADA' }).expect(200);

        expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 12 });
      });

      it('pagina: el total no depende de la página', async () => {
        const primera = await listar({ limit: '2' }).expect(200);
        const tercera = await listar({ limit: '2', page: '3' }).expect(200);
        const cuarta = await listar({ limit: '2', page: '4' }).expect(200);

        expect(primera.body.items).toHaveLength(2);
        expect(primera.body.total).toBe(5);
        expect(tercera.body.items.map((i: { id: string }) => i.id)).toEqual([
          ids[0],
        ]);
        expect(tercera.body).toMatchObject({ total: 5, page: 3, limit: 2 });
        expect(cuarta.body.items).toEqual([]);
      });

      it('por defecto trae 12 por página', async () => {
        const listing = await newListing(otroArrendador, 'Con muchas');
        for (let i = 0; i < 13; i++) await solicitar(listing);

        const primera = await listar({ estado: 'PENDIENTE' }, otroArrendador);
        const segunda = await listar(
          { estado: 'PENDIENTE', page: '2' },
          otroArrendador,
        );

        // Las 13 de "Con muchas" más la de "Ajena".
        expect(primera.body.total).toBe(14);
        expect(primera.body.items).toHaveLength(12);
        expect(segunda.body.items).toHaveLength(2);
      });

      it.each([
        ['estado que no existe', { estado: 'APROBADA' }],
        ['estado en minúsculas', { estado: 'pendiente' }],
        ['page 0', { page: '0' }],
        ['page no numérica', { page: 'abc' }],
        ['limit 51', { limit: '51' }],
        ['limit 0', { limit: '0' }],
        ['parámetro que no existe', { estdo: 'PENDIENTE' }],
      ] as [string, Record<string, string>][])('400: %s', async (_c, query) => {
        await listar(query).expect(400);
      });
    });
  });

  describe('PATCH /reservas/:id/decision', () => {
    let listingId: string;
    beforeEach(async () => {
      // Cada prueba usa su propia publicación para que no se crucen entre sí.
      listingId = await newListing();
    });

    describe('aprobar', () => {
      it('pasa a CONFIRMADA y registra quién decidió y cuándo', async () => {
        const id = await solicitar(listingId);
        const antes = Date.now();

        const res = await decidir(id, { decision: 'APROBAR' }).expect(200);

        expect(res.body).toEqual({
          id,
          estado: 'CONFIRMADA',
          decididaAt: expect.any(String) as string,
          motivoRechazo: null,
        });
        const guardada = await prisma.reservation.findUniqueOrThrow({
          where: { id },
        });
        expect(guardada.status).toBe('CONFIRMADA');
        expect(guardada.decidedById).toBe(arrendador.id);
        expect(guardada.decidedAt?.toISOString()).toBe(res.body.decididaAt);
        expect(
          Math.abs((guardada.decidedAt?.getTime() ?? 0) - antes),
        ).toBeLessThan(60_000);
        expect(guardada.rejectionReason).toBeNull();
      });

      it('avisa al arrendatario "Reserva CONFIRMADA" con el bien y las fechas', async () => {
        const id = await solicitar(listingId);

        await decidir(id, { decision: 'APROBAR' }).expect(200);

        const avisos = await avisosDe(id);
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toMatchObject({
          userId: arrendatario.id,
          sourceModule: 'RESERVAS',
          title: 'Reserva CONFIRMADA',
          message:
            'Tu reserva de «Taladro percutor» del 12/12/2026 09:00 al 12/12/2026 12:00 fue confirmada.',
          readAt: null,
        });
      });

      it('el aviso le aparece al arrendatario en su bandeja', async () => {
        const id = await solicitar(listingId);
        await decidir(id, { decision: 'APROBAR' }).expect(200);

        const res = await auth(
          request(app.getHttpServer()).get('/api/v1/notificaciones'),
          arrendatario,
        ).expect(200);

        expect(JSON.stringify(res.body)).toContain(id);
      });

      it('409 si ya confirmó otra reserva que se cruza, y la solicitud sigue PENDIENTE', async () => {
        await solicitar(listingId, local(12, 10), local(12, 14), 'CONFIRMADA');
        const id = await solicitar(listingId, local(12, 9), local(12, 12));

        const res = await decidir(id, { decision: 'APROBAR' }).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: 'Conflict',
          codigo: 'CONFLICTO_DISPONIBILIDAD',
          message:
            'Conflicto de disponibilidad: ya confirmaste otra reserva en esas fechas.',
        });
        expect(await estadoDe(id)).toBe('PENDIENTE');
        expect(await avisosDe(id)).toEqual([]);
      });

      it('409 si se cruza con una reserva EN_CURSO', async () => {
        await solicitar(listingId, local(11), local(13), 'EN_CURSO');
        const id = await solicitar(listingId);

        const res = await decidir(id, { decision: 'APROBAR' }).expect(409);

        expect(res.body.codigo).toBe('CONFLICTO_DISPONIBILIDAD');
      });

      it('409 si el arrendador bloqueó esas fechas', async () => {
        await prisma.availabilityBlock.create({
          data: {
            listingId,
            startAt: local(12),
            endAt: local(13),
            createdById: arrendador.id,
          },
        });
        const id = await solicitar(listingId);

        const res = await decidir(id, { decision: 'APROBAR' }).expect(409);

        expect(res.body).toMatchObject({
          codigo: 'CONFLICTO_DISPONIBILIDAD',
          message: 'Conflicto de disponibilidad: bloqueaste esas fechas.',
        });
        expect(await estadoDe(id)).toBe('PENDIENTE');
      });

      it.each(['RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
        'una reserva %s en las mismas fechas no estorba',
        async (status) => {
          await solicitar(listingId, local(12, 9), local(12, 12), status);
          const id = await solicitar(listingId);

          await decidir(id, { decision: 'APROBAR' }).expect(200);
        },
      );

      it('tocar el borde de otra reserva o de un bloqueo no es conflicto', async () => {
        await solicitar(listingId, local(12, 6), local(12, 9), 'CONFIRMADA');
        await prisma.availabilityBlock.create({
          data: { listingId, startAt: local(12, 12), endAt: local(13) },
        });
        const id = await solicitar(listingId, local(12, 9), local(12, 12));

        await decidir(id, { decision: 'APROBAR' }).expect(200);
      });

      it('una reserva confirmada de otra publicación no estorba', async () => {
        const otra = await newListing();
        await solicitar(otra, local(12, 9), local(12, 12), 'CONFIRMADA');
        const id = await solicitar(listingId);

        await decidir(id, { decision: 'APROBAR' }).expect(200);
      });

      it('las otras solicitudes PENDIENTE que se cruzan siguen PENDIENTE: aprobarlas da 409 y rechazarlas se puede', async () => {
        const primera = await solicitar(listingId, local(12, 9), local(12, 12));
        const segunda = await solicitar(
          listingId,
          local(12, 10),
          local(12, 13),
        );
        const tercera = await solicitar(
          listingId,
          local(12, 11),
          local(12, 15),
        );

        await decidir(primera, { decision: 'APROBAR' }).expect(200);

        expect(await estadoDe(segunda)).toBe('PENDIENTE');
        expect(await estadoDe(tercera)).toBe('PENDIENTE');
        expect(await avisosDe(segunda)).toEqual([]);

        const res = await decidir(segunda, { decision: 'APROBAR' }).expect(409);
        expect(res.body.codigo).toBe('CONFLICTO_DISPONIBILIDAD');
        expect(await estadoDe(segunda)).toBe('PENDIENTE');

        await decidir(tercera, { decision: 'RECHAZAR' }).expect(200);
        expect(await estadoDe(tercera)).toBe('RECHAZADA');
      });
    });

    describe('rechazar', () => {
      it('pasa a RECHAZADA sin motivo y las fechas siguen libres', async () => {
        const id = await solicitar(listingId);
        const otra = await solicitar(listingId);

        const res = await decidir(id, { decision: 'RECHAZAR' }).expect(200);

        expect(res.body).toMatchObject({
          id,
          estado: 'RECHAZADA',
          motivoRechazo: null,
        });
        const guardada = await prisma.reservation.findUniqueOrThrow({
          where: { id },
        });
        expect(guardada.decidedById).toBe(arrendador.id);
        expect(guardada.decidedAt).toBeInstanceOf(Date);
        // Las mismas fechas se pueden aprobar para otra solicitud.
        await decidir(otra, { decision: 'APROBAR' }).expect(200);
      });

      it('guarda el motivo recortado y lo pone en el aviso', async () => {
        const id = await solicitar(listingId);

        const res = await decidir(id, {
          decision: 'RECHAZAR',
          motivo: '  Fechas no disponibles  ',
        }).expect(200);

        expect(res.body.motivoRechazo).toBe('Fechas no disponibles');
        const guardada = await prisma.reservation.findUniqueOrThrow({
          where: { id },
        });
        expect(guardada.rejectionReason).toBe('Fechas no disponibles');
        const [aviso] = await avisosDe(id);
        expect(aviso).toMatchObject({
          userId: arrendatario.id,
          title: 'Reserva RECHAZADA',
          message:
            'Tu reserva de «Taladro percutor» del 12/12/2026 09:00 al 12/12/2026 12:00 fue rechazada. Motivo: Fechas no disponibles',
        });
      });

      it('un motivo de solo espacios se guarda como sin motivo', async () => {
        const id = await solicitar(listingId);

        const res = await decidir(id, {
          decision: 'RECHAZAR',
          motivo: '   ',
        }).expect(200);

        expect(res.body.motivoRechazo).toBeNull();
      });

      it('acepta un motivo de 500 caracteres: se guarda entero y el aviso lo recorta', async () => {
        const id = await solicitar(listingId);
        const motivo = 'ñ'.repeat(500);

        const res = await decidir(id, { decision: 'RECHAZAR', motivo }).expect(
          200,
        );

        expect(res.body.motivoRechazo).toBe(motivo);
        const [aviso] = await avisosDe(id);
        expect(Array.from(aviso.message)).toHaveLength(500);
        expect(aviso.message.endsWith('…')).toBe(true);
      });

      it('se puede rechazar una solicitud aunque sus fechas ya estén ocupadas', async () => {
        await solicitar(listingId, local(12, 9), local(12, 12), 'CONFIRMADA');
        const id = await solicitar(listingId);

        await decidir(id, { decision: 'RECHAZAR' }).expect(200);
      });
    });

    describe('permisos', () => {
      it('401 sin sesión', async () => {
        const id = await solicitar(listingId);

        await decidir(id, { decision: 'APROBAR' }, null).expect(401);
        expect(await estadoDe(id)).toBe('PENDIENTE');
      });

      it('403 para el arrendatario, aunque la solicitud sea suya', async () => {
        const id = await solicitar(listingId);

        await decidir(id, { decision: 'APROBAR' }, arrendatario).expect(403);
        expect(await estadoDe(id)).toBe('PENDIENTE');
      });

      it.each(['APROBAR', 'RECHAZAR'])(
        '403 "Esta solicitud no se puede modificar" si la publicación es de otro arrendador (%s)',
        async (decision) => {
          const id = await solicitar(listingId);

          const res = await decidir(id, { decision }, otroArrendador).expect(
            403,
          );

          expect(res.body.message).toBe(
            'Esta solicitud no se puede modificar.',
          );
          expect(await estadoDe(id)).toBe('PENDIENTE');
          expect(await avisosDe(id)).toEqual([]);
        },
      );

      it('404 si la reserva no existe', async () => {
        await decidir(randomUUID(), { decision: 'APROBAR' }).expect(404);
      });
    });

    describe('409: solicitud ya decidida', () => {
      it.each([
        ['APROBAR', 'APROBAR'],
        ['APROBAR', 'RECHAZAR'],
        ['RECHAZAR', 'APROBAR'],
        ['RECHAZAR', 'RECHAZAR'],
      ])('después de %s, %s da 409 y no cambia nada', async (uno, dos) => {
        const id = await solicitar(listingId);
        await decidir(id, { decision: uno }).expect(200);
        const estado = await estadoDe(id);

        const res = await decidir(id, { decision: dos }).expect(409);

        expect(res.body).toEqual({
          statusCode: 409,
          error: 'Conflict',
          codigo: 'SOLICITUD_YA_DECIDIDA',
          message: 'Esta solicitud no se puede modificar.',
        });
        expect(await estadoDe(id)).toBe(estado);
        expect(await avisosDe(id)).toHaveLength(1);
      });
    });

    describe('400: datos inválidos', () => {
      it.each([
        ['sin decision', {}],
        ['decision que no existe', { decision: 'CONFIRMAR' }],
        ['decision en minúsculas', { decision: 'aprobar' }],
        [
          'motivo de 501 caracteres',
          { decision: 'RECHAZAR', motivo: 'a'.repeat(501) },
        ],
        ['motivo que no es texto', { decision: 'RECHAZAR', motivo: 123 }],
        ['motivo al aprobar', { decision: 'APROBAR', motivo: 'No aplica' }],
        ['propiedad de más', { decision: 'APROBAR', estado: 'CONFIRMADA' }],
      ] as [string, Record<string, unknown>][])('%s', async (_caso, body) => {
        const id = await solicitar(listingId);

        await decidir(id, body).expect(400);

        expect(await estadoDe(id)).toBe('PENDIENTE');
      });

      it('un id que no es UUID', async () => {
        const res = await decidir('91', { decision: 'APROBAR' }).expect(400);

        expect(res.body.message).toBe('El id de la reserva debe ser un UUID.');
      });
    });

    describe('concurrencia', () => {
      it('dos solicitudes que se cruzan aprobadas a la vez: solo una queda CONFIRMADA', async () => {
        const a = await solicitar(listingId, local(12, 9), local(12, 12));
        const b = await solicitar(listingId, local(12, 10), local(12, 13));

        const [resA, resB] = await Promise.all([
          decidir(a, { decision: 'APROBAR' }),
          decidir(b, { decision: 'APROBAR' }),
        ]);

        expect([resA.status, resB.status].sort((x, y) => x - y)).toEqual([
          200, 409,
        ]);
        const perdio = resA.status === 409 ? resA : resB;
        expect(perdio.body).toMatchObject({
          codigo: 'CONFLICTO_DISPONIBILIDAD',
          message:
            'Conflicto de disponibilidad: ya confirmaste otra reserva en esas fechas.',
        });
        expect([await estadoDe(a), await estadoDe(b)].sort()).toEqual([
          'CONFIRMADA',
          'PENDIENTE',
        ]);
      });

      it('lo mismo con diez solicitudes que se cruzan todas: una sola CONFIRMADA', async () => {
        const ids = await Promise.all(
          Array.from({ length: 10 }, () => solicitar(listingId)),
        );

        const respuestas = await Promise.all(
          ids.map((id) => decidir(id, { decision: 'APROBAR' })),
        );

        expect(respuestas.filter((res) => res.status === 200)).toHaveLength(1);
        expect(respuestas.filter((res) => res.status === 409)).toHaveLength(9);
        expect(
          await prisma.reservation.count({
            where: { listingId, status: 'CONFIRMADA' },
          }),
        ).toBe(1);
        expect(
          await prisma.reservation.count({
            where: { listingId, status: 'PENDIENTE' },
          }),
        ).toBe(9);
      });

      it('dos solicitudes que no se cruzan aprobadas a la vez: quedan las dos', async () => {
        const a = await solicitar(listingId, local(12, 9), local(12, 12));
        const b = await solicitar(listingId, local(12, 12), local(12, 15));

        const respuestas = await Promise.all([
          decidir(a, { decision: 'APROBAR' }),
          decidir(b, { decision: 'APROBAR' }),
        ]);

        expect(respuestas.map((res) => res.status)).toEqual([200, 200]);
      });

      it('la misma solicitud aprobada dos veces a la vez: una sola decisión y un solo aviso', async () => {
        const id = await solicitar(listingId);

        const respuestas = await Promise.all([
          decidir(id, { decision: 'APROBAR' }),
          decidir(id, { decision: 'APROBAR' }),
        ]);

        expect(
          respuestas.map((res) => res.status).sort((x, y) => x - y),
        ).toEqual([200, 409]);
        expect(respuestas.find((res) => res.status === 409)?.body.codigo).toBe(
          'SOLICITUD_YA_DECIDIDA',
        );
        expect(await avisosDe(id)).toHaveLength(1);
      });

      it('aprobar y rechazar la misma solicitud a la vez: gana una sola', async () => {
        // Es una carrera y no siempre cae igual, así que se repite con varias
        // solicitudes (cada una en su publicación para que no se crucen).
        const ids: string[] = [];
        for (let i = 0; i < 20; i++) {
          ids.push(await solicitar(await newListing()));
        }

        // De cuatro en cuatro: más peticiones a la vez saturan el servidor
        // de prueba y no agregan nada a la carrera de cada par.
        const pares: request.Response[][] = [];
        for (let i = 0; i < ids.length; i += 4) {
          pares.push(
            ...(await Promise.all(
              ids.slice(i, i + 4).map((id) =>
                Promise.all([
                  decidir(id, { decision: 'APROBAR' }),
                  decidir(id, {
                    decision: 'RECHAZAR',
                    motivo: 'Cambio de planes',
                  }),
                ]),
              ),
            )),
          );
        }

        for (const [i, respuestas] of pares.entries()) {
          const id = ids[i];
          expect(
            respuestas.map((res) => res.status).sort((x, y) => x - y),
          ).toEqual([200, 409]);
          const gano = respuestas.find((res) => res.status === 200);
          const perdio = respuestas.find((res) => res.status === 409);
          expect(perdio?.body.codigo).toBe('SOLICITUD_YA_DECIDIDA');
          expect(await estadoDe(id)).toBe(gano?.body.estado);
          const avisos = await avisosDe(id);
          expect(avisos).toHaveLength(1);
          expect(avisos[0].title).toBe(`Reserva ${gano?.body.estado}`);
        }
      });
    });
  });
});
