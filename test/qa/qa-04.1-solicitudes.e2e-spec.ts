import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-04.1 (MP4-55): pruebas de autorización y concurrencia de H04 (aprobar o
 * rechazar una reserva).
 *
 * Cada caso tiene un id (A01, A02...) que se repite en la evidencia de
 * docs/qa/QA-04.1-solicitudes.md. Las cuentas se crean con el registro real y
 * las sesiones con el login real. Además de la respuesta HTTP, cada caso revisa
 * lo que quedó guardado: el estado de la reserva, la decisión y los avisos.
 *
 * Las solicitudes se crean directo en la base: solicitar una reserva (BE-03.1)
 * todavía no está en main.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Session = { token: string; userId: string };

describe('QA-04.1: aprobar o rechazar una reserva', () => {
  const email = `qa-04.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let accounts = 0;
  // Cada caso usa días distintos (a partir de un mes en el futuro) para que
  // no se crucen entre sí.
  let nextDay = 30;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, who: Session | null) =>
    who ? req.set('Authorization', `Bearer ${who.token}`) : req;

  const account = async (
    rol: 'ARRENDATARIO' | 'ARRENDADOR',
    nombre: string,
  ) => {
    const address = `${rol.toLowerCase()}${++accounts}-${email}`;
    await http()
      .post('/api/v1/users')
      .send({ email: address, password, rol, nombre, telefono: '70001234' })
      .expect(201);
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken as string, userId: user.id };
  };

  const newListing = async (owner = landlord, name = 'Proyector Epson') =>
    (
      await prisma.listing.create({
        data: {
          landlordId: owner.userId,
          type: 'EQUIPO',
          name,
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'HORA',
        },
      })
    ).id;

  /** Un día libre nuevo, a las 00:00 de El Salvador. */
  const freshDay = () =>
    new Date(Date.UTC(2026, 11, 1) + 6 * HOUR + nextDay++ * DAY);

  const request_ = (
    listingId: string,
    startAt: Date,
    hours = 3,
    status: 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'RECHAZADA' = 'PENDIENTE',
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt,
        endAt: new Date(startAt.getTime() + hours * HOUR),
        status,
        rentalCost: '45.00',
        depositAmount: '20.00',
      },
    });

  const decide = (
    id: string,
    body: Record<string, unknown>,
    who: Session | null = landlord,
  ) => auth(http().patch(`/api/v1/reservas/${id}/decision`).send(body), who);

  const list = (
    query: Record<string, string> = {},
    who: Session | null = landlord,
  ) => auth(http().get('/api/v1/arrendador/solicitudes').query(query), who);

  const reservationOf = (id: string) =>
    prisma.reservation.findUniqueOrThrow({ where: { id } });

  const noticesOf = (reservationId: string) =>
    prisma.notification.findMany({
      where: { referenceType: 'reserva', referenceId: reservationId },
    });

  const busyDays = async (listingId: string, start: Date) => {
    const day = start.toISOString().slice(0, 10);
    const res = await http()
      .get(`/api/v1/publicaciones/${listingId}/disponibilidad`)
      .query({ desde: day, hasta: day })
      .expect(200);
    return res.body.ocupados as { origen: string }[];
  };

  /** La reserva quedó como estaba: mismo estado, sin decisión y sin avisos. */
  const expectUntouched = async (id: string, status = 'PENDIENTE') => {
    const r = await reservationOf(id);
    expect(r.status).toBe(status);
    if (status === 'PENDIENTE') {
      expect(r.decidedAt).toBeNull();
      expect(r.decidedById).toBeNull();
    }
    expect(await noticesOf(id)).toHaveLength(0);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
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

    landlord = await account('ARRENDADOR', 'Henry Arrendador');
    otherLandlord = await account('ARRENDADOR', 'Otro Arrendador');
    tenant = await account('ARRENDATARIO', 'Ana Pérez');
  });

  afterAll(async () => {
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await app.close();
  });

  describe('criterio 1: Mis solicitudes', () => {
    it('A01: ve solo las de sus bienes, de la más reciente a la más antigua, con quién, bien, fechas, costo y estado', async () => {
      const mine = await newListing(landlord, 'Taladro A01');
      const foreign = await newListing(otherLandlord, 'Ajena A01');
      const older = await request_(mine, freshDay());
      const newer = await request_(mine, freshDay());
      await prisma.reservation.update({
        where: { id: older.id },
        data: { createdAt: new Date(Date.now() - 2 * HOUR) },
      });
      const theirs = await request_(foreign, freshDay());

      const res = await list({ limit: '50' }).expect(200);
      const ids = (res.body.items as { id: string }[]).map((i) => i.id);

      expect(ids).toContain(older.id);
      expect(ids).not.toContain(theirs.id);
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
      const item = res.body.items.find(
        (i: { id: string }) => i.id === newer.id,
      );
      expect(item).toMatchObject({
        estado: 'PENDIENTE',
        publicacion: { id: mine, nombre: 'Taladro A01' },
        arrendatario: { id: tenant.userId, nombre: 'Ana Pérez' },
        inicio: newer.startAt.toISOString(),
        fin: newer.endAt.toISOString(),
        costoEstimado: '45.00',
      });
    });

    it('A02: de 12 en 12 por página, con filtro por estado; sin solicitudes, lista vacía', async () => {
      const listing = await newListing(landlord, 'Paginación A02');
      for (let i = 0; i < 13; i++) await request_(listing, freshDay());

      const first = await list({ estado: 'PENDIENTE' }).expect(200);
      expect(first.body.limit).toBe(12);
      expect(first.body.items).toHaveLength(12);
      expect(first.body.total).toBeGreaterThanOrEqual(13);
      expect(
        first.body.items.every(
          (i: { estado: string }) => i.estado === 'PENDIENTE',
        ),
      ).toBe(true);

      const empty = await list({}, otherLandlord).expect(200);
      expect(empty.body).toMatchObject({ total: 1 });
      const none = await list({ estado: 'COMPLETADA' }, otherLandlord).expect(
        200,
      );
      expect(none.body).toEqual({ items: [], total: 0, page: 1, limit: 12 });
    });
  });

  describe('criterios 2, 3 y 4: aprobar y rechazar', () => {
    it('A03: aprobar una PENDIENTE sin choques la deja CONFIRMADA, registra quién y cuándo, y ocupa las fechas', async () => {
      const listing = await newListing();
      const day = freshDay();
      const r = await request_(listing, day);
      expect(await busyDays(listing, day)).toHaveLength(0);

      const res = await decide(r.id, { decision: 'APROBAR' }).expect(200);

      expect(res.body).toMatchObject({ id: r.id, estado: 'CONFIRMADA' });
      const saved = await reservationOf(r.id);
      expect(saved.status).toBe('CONFIRMADA');
      expect(saved.decidedById).toBe(landlord.userId);
      expect(saved.decidedAt?.toISOString()).toBe(res.body.decididaAt);
      expect(await busyDays(listing, day)).toEqual([
        expect.objectContaining({ origen: 'RESERVA' }),
      ]);
    });

    it('A04: rechazar una PENDIENTE la deja RECHAZADA y las fechas siguen libres', async () => {
      const listing = await newListing();
      const day = freshDay();
      const r = await request_(listing, day);

      await decide(r.id, { decision: 'RECHAZAR' }).expect(200);

      expect((await reservationOf(r.id)).status).toBe('RECHAZADA');
      expect(await busyDays(listing, day)).toHaveLength(0);
    });

    it('A05: el motivo es opcional, se guarda (500 caracteres) y 501 se rechaza sin cambiar nada', async () => {
      const listing = await newListing();
      const sin = await request_(listing, freshDay());
      const con = await request_(listing, freshDay());
      const largo = await request_(listing, freshDay());

      await decide(sin.id, { decision: 'RECHAZAR' }).expect(200);
      expect((await reservationOf(sin.id)).rejectionReason).toBeNull();

      const motivo = 'ñ'.repeat(500);
      const res = await decide(con.id, { decision: 'RECHAZAR', motivo }).expect(
        200,
      );
      expect(res.body.motivoRechazo).toBe(motivo);
      expect((await reservationOf(con.id)).rejectionReason).toBe(motivo);

      await decide(largo.id, {
        decision: 'RECHAZAR',
        motivo: 'a'.repeat(501),
      }).expect(400);
      await expectUntouched(largo.id);
    });
  });

  describe('criterio 5: solicitudes que no se pueden modificar', () => {
    it('A06: otro arrendador recibe 403 «Esta solicitud no se puede modificar.» al aprobar y al rechazar', async () => {
      const r = await request_(await newListing(), freshDay());

      for (const decision of ['APROBAR', 'RECHAZAR']) {
        const res = await decide(r.id, { decision }, otherLandlord).expect(403);
        expect(res.body.message).toBe('Esta solicitud no se puede modificar.');
      }
      await expectUntouched(r.id);
    });

    it('A07: una solicitud ya decidida responde 409 con el mismo texto y no cambia', async () => {
      const r = await request_(await newListing(), freshDay());
      await decide(r.id, { decision: 'RECHAZAR' }).expect(200);

      const res = await decide(r.id, { decision: 'APROBAR' }).expect(409);

      expect(res.body).toMatchObject({
        codigo: 'SOLICITUD_YA_DECIDIDA',
        message: 'Esta solicitud no se puede modificar.',
      });
      expect((await reservationOf(r.id)).status).toBe('RECHAZADA');
      expect(await noticesOf(r.id)).toHaveLength(1);
    });

    it('A08: el arrendatario no puede decidir (403) y sin sesión es 401', async () => {
      const r = await request_(await newListing(), freshDay());

      await decide(r.id, { decision: 'APROBAR' }, tenant).expect(403);
      await decide(r.id, { decision: 'APROBAR' }, null).expect(401);
      await list({}, tenant).expect(403);
      await list({}, null).expect(401);
      await expectUntouched(r.id);
    });
  });

  describe('criterios 6 y 7: conflictos de disponibilidad', () => {
    it('A09: aprobar choca con una CONFIRMADA o EN_CURSO que se cruza: 409 de conflicto', async () => {
      for (const ocupada of ['CONFIRMADA', 'EN_CURSO'] as const) {
        const listing = await newListing();
        const day = freshDay();
        await request_(listing, day, 3, ocupada);
        const r = await request_(listing, new Date(day.getTime() + HOUR), 3);

        const res = await decide(r.id, { decision: 'APROBAR' }).expect(409);

        expect(res.body).toMatchObject({
          codigo: 'CONFLICTO_DISPONIBILIDAD',
          message:
            'Conflicto de disponibilidad: ya confirmaste otra reserva en esas fechas.',
        });
        await expectUntouched(r.id);
      }
    });

    it('A10: tras confirmar una, las otras PENDIENTE que se cruzan siguen PENDIENTE: aprobarlas da 409 y rechazarlas se puede', async () => {
      const listing = await newListing();
      const day = freshDay();
      const a = await request_(listing, day, 4);
      const b = await request_(listing, new Date(day.getTime() + HOUR), 4);
      const c = await request_(listing, new Date(day.getTime() + 2 * HOUR), 4);

      await decide(a.id, { decision: 'APROBAR' }).expect(200);

      expect((await reservationOf(b.id)).status).toBe('PENDIENTE');
      expect((await reservationOf(c.id)).status).toBe('PENDIENTE');
      await decide(b.id, { decision: 'APROBAR' }).expect(409);
      await expectUntouched(b.id);
      await decide(c.id, { decision: 'RECHAZAR' }).expect(200);
      expect((await reservationOf(c.id)).status).toBe('RECHAZADA');
    });

    it('A11: tampoco se puede aprobar sobre fechas que el arrendador bloqueó (H14)', async () => {
      const listing = await newListing();
      const day = freshDay();
      await auth(
        http()
          .post(`/api/v1/publicaciones/${listing}/bloqueos`)
          .send({
            inicio: day.toISOString(),
            fin: new Date(day.getTime() + DAY).toISOString(),
          }),
        landlord,
      ).expect(201);
      const r = await request_(listing, new Date(day.getTime() + 9 * HOUR));

      const res = await decide(r.id, { decision: 'APROBAR' }).expect(409);

      expect(res.body.message).toBe(
        'Conflicto de disponibilidad: bloqueaste esas fechas.',
      );
      await expectUntouched(r.id);
    });
  });

  describe('criterio 8: aviso al arrendatario', () => {
    it('A12: «Reserva CONFIRMADA» con el bien y las fechas, en la bandeja del arrendatario', async () => {
      const listing = await newListing(landlord, 'Cámara A12');
      const r = await request_(listing, new Date(Date.UTC(2027, 2, 10, 15)));

      await decide(r.id, { decision: 'APROBAR' }).expect(200);

      const bandeja = await auth(
        http().get('/api/v1/notificaciones'),
        tenant,
      ).expect(200);
      const aviso = bandeja.body.items.find(
        (n: { referencia: { id: string } | null }) => n.referencia?.id === r.id,
      );
      expect(aviso).toMatchObject({
        moduloOrigen: 'RESERVAS',
        titulo: 'Reserva CONFIRMADA',
        mensaje:
          'Tu reserva de «Cámara A12» del 10/03/2027 09:00 al 10/03/2027 12:00 fue confirmada.',
        leidaAt: null,
      });
    });

    it('A13: «Reserva RECHAZADA» con el motivo si lo hay', async () => {
      const r = await request_(
        await newListing(landlord, 'Cámara A13'),
        new Date(Date.UTC(2027, 2, 11, 15)),
      );

      await decide(r.id, {
        decision: 'RECHAZAR',
        motivo: 'Está en reparación',
      }).expect(200);

      const [aviso] = await noticesOf(r.id);
      expect(aviso).toMatchObject({
        userId: tenant.userId,
        title: 'Reserva RECHAZADA',
        message:
          'Tu reserva de «Cámara A13» del 11/03/2027 09:00 al 11/03/2027 12:00 fue rechazada. Motivo: Está en reparación',
      });
    });
  });

  describe('criterio 9: concurrencia', () => {
    it('A14: dos solicitudes que se cruzan aprobadas a la vez (dos pestañas): solo una queda CONFIRMADA', async () => {
      // Se repite para no depender de una sola carrera.
      for (let vuelta = 0; vuelta < 5; vuelta++) {
        const listing = await newListing();
        const day = freshDay();
        const a = await request_(listing, day, 3);
        const b = await request_(listing, new Date(day.getTime() + HOUR), 3);

        const [ra, rb] = await Promise.all([
          decide(a.id, { decision: 'APROBAR' }),
          decide(b.id, { decision: 'APROBAR' }),
        ]);

        expect([ra.status, rb.status].sort((x, y) => x - y)).toEqual([
          200, 409,
        ]);
        const perdio = ra.status === 409 ? ra : rb;
        expect(perdio.body.message).toBe(
          'Conflicto de disponibilidad: ya confirmaste otra reserva en esas fechas.',
        );
        const estados = [
          (await reservationOf(a.id)).status,
          (await reservationOf(b.id)).status,
        ];
        expect(estados.sort()).toEqual(['CONFIRMADA', 'PENDIENTE']);
      }
    });

    it('A15: la misma solicitud aprobada y rechazada a la vez: una sola decisión y un solo aviso', async () => {
      for (let vuelta = 0; vuelta < 5; vuelta++) {
        const r = await request_(await newListing(), freshDay());

        const respuestas = await Promise.all([
          decide(r.id, { decision: 'APROBAR' }),
          decide(r.id, { decision: 'RECHAZAR' }),
        ]);

        expect(respuestas.map((x) => x.status).sort((x, y) => x - y)).toEqual([
          200, 409,
        ]);
        const gano = respuestas.find((x) => x.status === 200);
        expect((await reservationOf(r.id)).status).toBe(gano?.body.estado);
        expect(await noticesOf(r.id)).toHaveLength(1);
      }
    });
  });
});
