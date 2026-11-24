import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-13.1 (MP4-59): pruebas de la disponibilidad real de un bien (H13).
 *
 * Cada caso tiene un id (C01, C02...) que se repite en la evidencia de
 * docs/qa/QA-13.1-disponibilidad.md. Se compara lo que responde
 * `GET /publicaciones/:id/disponibilidad` con lo que hay en la base: reservas
 * en cada estado y bloqueos.
 *
 * Las reservas se crean directo en la base en el estado que pide cada caso:
 * solicitar una reserva (BE-03.1) todavía no está en main. Los bloqueos y las
 * decisiones usan los endpoints reales (BE-14.1 y BE-04.1).
 */

type Session = { token: string; userId: string };
type Status =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'EN_CURSO'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'COMPLETADA';

describe('H13. Ver la disponibilidad real de un bien', () => {
  const email = `qa-13.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let tenant: Session;
  let accounts = 0;

  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, who: Session | null) =>
    who ? req.set('Authorization', `Bearer ${who.token}`) : req;

  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `${rol.toLowerCase()}${++accounts}-${email}`;
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
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: address, password })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    return { token: res.body.accessToken as string, userId: user.id };
  };

  const newListing = async (isActive = true) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'EQUIPO',
          name: 'Proyector',
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'HORA',
          isActive,
        },
      })
    ).id;

  /** Fechas en hora de El Salvador (-06:00), como las devuelve la API. */
  const reservation = (
    listingId: string,
    inicio: string,
    fin: string,
    status: Status,
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt: new Date(inicio),
        endAt: new Date(fin),
        status,
        rentalCost: '45.00',
        depositAmount: '20.00',
      },
    });

  const block = (
    listingId: string,
    inicio: string,
    fin: string,
    motivo?: string,
  ) =>
    auth(
      http()
        .post(`/api/v1/publicaciones/${listingId}/bloqueos`)
        .send({ inicio, fin, motivo }),
      landlord,
    ).expect(201);

  const availability = (listingId: string, query: Record<string, string>) =>
    http()
      .get(`/api/v1/publicaciones/${listingId}/disponibilidad`)
      .query(query);

  const busy = async (listingId: string, desde: string, hasta: string) =>
    (await availability(listingId, { desde, hasta }).expect(200)).body
      .ocupados as Record<string, string>[];

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

    landlord = await account('ARRENDADOR');
    tenant = await account('ARRENDATARIO');
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

  describe('días libres y ocupados (AC1)', () => {
    it('AC1: ocupan días las reservas CONFIRMADA y EN_CURSO y los bloqueos, en orden por inicio (C01)', async () => {
      const listing = await newListing();
      await reservation(
        listing,
        '2027-03-12T09:00:00-06:00',
        '2027-03-12T12:00:00-06:00',
        'CONFIRMADA',
      );
      await reservation(
        listing,
        '2027-03-05T08:00:00-06:00',
        '2027-03-06T08:00:00-06:00',
        'EN_CURSO',
      );
      await block(
        listing,
        '2027-03-20T00:00:00-06:00',
        '2027-03-22T00:00:00-06:00',
        'Pintura',
      );

      expect(await busy(listing, '2027-03-01', '2027-03-31')).toEqual([
        {
          inicio: '2027-03-05T08:00:00-06:00',
          fin: '2027-03-06T08:00:00-06:00',
          origen: 'RESERVA',
        },
        {
          inicio: '2027-03-12T09:00:00-06:00',
          fin: '2027-03-12T12:00:00-06:00',
          origen: 'RESERVA',
        },
        {
          inicio: '2027-03-20T00:00:00-06:00',
          fin: '2027-03-22T00:00:00-06:00',
          origen: 'BLOQUEO',
        },
      ]);
    });

    it('AC1: un bien sin nada ocupado responde 200 con la lista vacía (C02)', async () => {
      const listing = await newListing();
      const res = await availability(listing, {
        desde: '2027-03-01',
        hasta: '2027-03-31',
      }).expect(200);
      expect(res.body).toEqual({
        publicacionId: listing,
        desde: '2027-03-01',
        hasta: '2027-03-31',
        ocupados: [],
      });
    });

    it('AC1: es pública y no expone quién reservó ni el motivo del bloqueo (C03)', async () => {
      const listing = await newListing();
      await reservation(
        listing,
        '2027-03-12T09:00:00-06:00',
        '2027-03-12T12:00:00-06:00',
        'CONFIRMADA',
      );
      await block(
        listing,
        '2027-03-20T00:00:00-06:00',
        '2027-03-21T00:00:00-06:00',
        'Viaje familiar',
      );

      const res = await availability(listing, {
        desde: '2027-03-01',
        hasta: '2027-03-31',
      }).expect(200);

      for (const periodo of res.body.ocupados)
        expect(Object.keys(periodo).sort()).toEqual([
          'fin',
          'inicio',
          'origen',
        ]);
      const texto = JSON.stringify(res.body);
      expect(texto).not.toContain('Viaje familiar');
      expect(texto).not.toContain(tenant.userId);
    });

    it('AC1: un período que cruza el borde del mes sale completo, y una reserva y un bloqueo sobre el mismo día salen los dos (C04)', async () => {
      const listing = await newListing();
      await reservation(
        listing,
        '2027-03-30T10:00:00-06:00',
        '2027-04-02T10:00:00-06:00',
        'CONFIRMADA',
      );
      // Bloquear sobre una CONFIRMADA da 409 (QA-14.1, B06), así que este
      // cruce solo puede venir de datos anteriores: se crea directo en la base.
      await prisma.availabilityBlock.create({
        data: {
          listingId: listing,
          startAt: new Date('2027-04-01T00:00:00-06:00'),
          endAt: new Date('2027-04-02T00:00:00-06:00'),
        },
      });

      const abril = await busy(listing, '2027-04-01', '2027-04-30');

      expect(abril).toEqual([
        {
          inicio: '2027-03-30T10:00:00-06:00',
          fin: '2027-04-02T10:00:00-06:00',
          origen: 'RESERVA',
        },
        {
          inicio: '2027-04-01T00:00:00-06:00',
          fin: '2027-04-02T00:00:00-06:00',
          origen: 'BLOQUEO',
        },
      ]);
    });
  });

  describe('las solicitudes pendientes no apartan fechas (AC2)', () => {
    it('AC2: PENDIENTE, RECHAZADA, CANCELADA y COMPLETADA no ocupan días (C05)', async () => {
      const listing = await newListing();
      for (const status of [
        'PENDIENTE',
        'RECHAZADA',
        'CANCELADA',
        'COMPLETADA',
      ] as const) {
        await reservation(
          listing,
          '2027-03-12T09:00:00-06:00',
          '2027-03-12T12:00:00-06:00',
          status,
        );
      }

      expect(await busy(listing, '2027-03-01', '2027-03-31')).toEqual([]);
    });

    it('AC2: una PENDIENTE pasa a ocupar el día solo cuando el arrendador la aprueba (H04); si la rechaza, sigue libre (C06)', async () => {
      const listing = await newListing();
      const aprobada = await reservation(
        listing,
        '2027-03-12T09:00:00-06:00',
        '2027-03-12T12:00:00-06:00',
        'PENDIENTE',
      );
      const rechazada = await reservation(
        listing,
        '2027-03-15T09:00:00-06:00',
        '2027-03-15T12:00:00-06:00',
        'PENDIENTE',
      );
      expect(await busy(listing, '2027-03-01', '2027-03-31')).toEqual([]);

      const decidir = (id: string, decision: string) =>
        auth(
          http().patch(`/api/v1/reservas/${id}/decision`).send({ decision }),
          landlord,
        ).expect(200);
      await decidir(aprobada.id, 'APROBAR');
      await decidir(rechazada.id, 'RECHAZAR');

      expect(await busy(listing, '2027-03-01', '2027-03-31')).toEqual([
        {
          inicio: '2027-03-12T09:00:00-06:00',
          fin: '2027-03-12T12:00:00-06:00',
          origen: 'RESERVA',
        },
      ]);
    });
  });

  describe('fechas en hora de El Salvador', () => {
    it('AC1: «hasta» incluye todo el último día local y el fin de un período no cuenta como ocupado (C07)', async () => {
      const listing = await newListing();
      // 31 de marzo 23:00 aquí = 1 de abril 05:00 UTC: es de marzo.
      await reservation(
        listing,
        '2027-03-31T23:00:00-06:00',
        '2027-03-31T23:30:00-06:00',
        'CONFIRMADA',
      );
      // Termina el 1 de mayo a las 00:00: el 1 de mayo queda libre.
      await block(
        listing,
        '2027-04-30T00:00:00-06:00',
        '2027-05-01T00:00:00-06:00',
      );

      expect(await busy(listing, '2027-03-31', '2027-03-31')).toHaveLength(1);
      expect(await busy(listing, '2027-04-01', '2027-04-01')).toEqual([]);
      expect(await busy(listing, '2027-05-01', '2027-05-01')).toEqual([]);
      expect(await busy(listing, '2027-04-30', '2027-04-30')).toHaveLength(1);
    });
  });

  describe('casos negativos: validación y publicación', () => {
    it('C08: rango inválido responde 400 (8 subcasos) y 92 días sí se aceptan', async () => {
      const listing = await newListing();
      const malos: Record<string, string>[] = [
        { hasta: '2027-03-31' },
        { desde: '2027-03-01' },
        { desde: '01/03/2027', hasta: '2027-03-31' },
        { desde: '2027-02-30', hasta: '2027-03-31' },
        { desde: '2027-03-31', hasta: '2027-03-01' },
        { desde: '2027-01-01', hasta: '2027-04-03' },
        { desde: '2027-03-01', hasta: '2027-03-31', estado: 'PENDIENTE' },
      ];
      for (const query of malos) await availability(listing, query).expect(400);
      await availability('no-es-uuid', {
        desde: '2027-03-01',
        hasta: '2027-03-31',
      }).expect(400);

      await availability(listing, {
        desde: '2027-01-01',
        hasta: '2027-04-02',
      }).expect(200);
    });

    it('C09: una publicación que no existe o está desactivada responde 404', async () => {
      const inactiva = await newListing(false);
      for (const id of [randomUUID(), inactiva]) {
        await availability(id, {
          desde: '2027-03-01',
          hasta: '2027-03-31',
        }).expect(404);
      }
    });
  });
});
