import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-14.1 (MP4-63): pruebas del bloqueo de fechas y sus restricciones (H14).
 *
 * Cada caso tiene un id (B01, B02...) que se repite en la evidencia de
 * docs/qa/QA-14.1-bloqueos.md. Además de la respuesta HTTP, cada caso revisa
 * lo guardado: las filas de `availability_blocks` y lo que muestra el
 * calendario público (`/disponibilidad`, H13).
 *
 * Las reservas se crean directo en la base en el estado que pide cada caso:
 * solicitar una reserva (BE-03.1) todavía no está en main.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Session = { token: string; userId: string };
type Status =
  'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'RECHAZADA' | 'COMPLETADA';

describe('QA-14.1: bloqueo de fechas', () => {
  const email = `qa-14.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let owner: Session;
  let otherLandlord: Session;
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

  const newListing = async (landlord = owner) =>
    (
      await prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'ESPACIO',
          name: 'Salón de eventos',
          location: 'San Salvador',
          rateAmount: '80.00',
          rateUnit: 'DIA',
        },
      })
    ).id;

  const reservation = (
    listingId: string,
    startAt: string,
    endAt: string,
    status: Status,
  ) =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        status,
        rentalCost: '80.00',
        depositAmount: '20.00',
      },
    });

  const block = (
    listingId: string,
    body: Record<string, unknown>,
    who: Session | null = owner,
  ) =>
    auth(
      http().post(`/api/v1/publicaciones/${listingId}/bloqueos`).send(body),
      who,
    );

  const blocksOf = (listingId: string) =>
    prisma.availabilityBlock.findMany({
      where: { listingId },
      orderBy: { startAt: 'asc' },
    });

  const calendar = (listingId: string, desde: string, hasta: string) =>
    http()
      .get(`/api/v1/publicaciones/${listingId}/disponibilidad`)
      .query({ desde, hasta })
      .expect(200)
      .then((res) => res.body.ocupados as Record<string, string>[]);

  const RANGO = {
    inicio: '2027-02-20T00:00:00-06:00',
    fin: '2027-02-22T00:00:00-06:00',
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

    owner = await account('ARRENDADOR');
    otherLandlord = await account('ARRENDADOR');
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

  describe('criterio 1: el dueño bloquea un rango libre', () => {
    it('B01: 201 con el bloqueo; queda guardado con su autor y el motivo recortado', async () => {
      const listing = await newListing();

      const res = await block(listing, {
        ...RANGO,
        motivo: '  Mantenimiento  ',
      }).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        publicacionId: listing,
        inicio: RANGO.inicio,
        fin: RANGO.fin,
        motivo: 'Mantenimiento',
      });
      const [saved] = await blocksOf(listing);
      expect(saved).toMatchObject({
        id: res.body.id,
        startAt: new Date('2027-02-20T06:00:00Z'),
        endAt: new Date('2027-02-22T06:00:00Z'),
        reason: 'Mantenimiento',
        createdById: owner.userId,
      });
    });

    it('B02: el motivo es opcional (sin motivo o en blanco queda vacío) y acepta 200 caracteres', async () => {
      const listing = await newListing();

      const sin = await block(listing, RANGO).expect(201);
      const blanco = await block(listing, { ...RANGO, motivo: '   ' }).expect(
        201,
      );
      const largo = await block(listing, {
        ...RANGO,
        motivo: 'm'.repeat(200),
      }).expect(201);

      expect([sin.body.motivo, blanco.body.motivo]).toEqual([null, null]);
      expect(largo.body.motivo).toHaveLength(200);
      expect(await blocksOf(listing)).toHaveLength(3);
    });

    it('B03: las solicitudes PENDIENTE no cambian, pero ya no se pueden aprobar sobre el bloqueo', async () => {
      const listing = await newListing();
      const pendiente = await reservation(
        listing,
        '2027-02-21T15:00:00Z',
        '2027-02-21T18:00:00Z',
        'PENDIENTE',
      );

      await block(listing, RANGO).expect(201);

      expect(
        (
          await prisma.reservation.findUniqueOrThrow({
            where: { id: pendiente.id },
          })
        ).status,
      ).toBe('PENDIENTE');
      const res = await auth(
        http()
          .patch(`/api/v1/reservas/${pendiente.id}/decision`)
          .send({ decision: 'APROBAR' }),
        owner,
      ).expect(409);
      expect(res.body.message).toBe(
        'Conflicto de disponibilidad: bloqueaste esas fechas.',
      );
    });

    it('B04: el dueño ve sus bloqueos con el motivo, del más próximo al más lejano', async () => {
      const listing = await newListing();
      await block(listing, {
        inicio: '2027-03-10T00:00:00-06:00',
        fin: '2027-03-11T00:00:00-06:00',
        motivo: 'Pintura',
      }).expect(201);
      await block(listing, {
        inicio: '2027-03-01T00:00:00-06:00',
        fin: '2027-03-02T00:00:00-06:00',
        motivo: 'Feriado',
      }).expect(201);

      const res = await auth(
        http().get(`/api/v1/publicaciones/${listing}/bloqueos`),
        owner,
      ).expect(200);

      expect(res.body.items.map((b: { motivo: string }) => b.motivo)).toEqual([
        'Feriado',
        'Pintura',
      ]);
    });
  });

  describe('criterio 2: el arrendatario ve las fechas ocupadas (H13)', () => {
    it('B05: el calendario público muestra el bloqueo sin el motivo, y el día de fin queda libre', async () => {
      const listing = await newListing();
      await block(listing, { ...RANGO, motivo: 'Privado' }).expect(201);

      const ocupados = await calendar(listing, '2027-02-01', '2027-02-28');

      expect(ocupados).toEqual([
        { inicio: RANGO.inicio, fin: RANGO.fin, origen: 'BLOQUEO' },
      ]);
      expect(await calendar(listing, '2027-02-22', '2027-02-22')).toEqual([]);
    });
  });

  describe('criterio 3: el rango tiene una reserva CONFIRMADA o EN_CURSO', () => {
    it('B06: 409 RANGO_CON_RESERVA con el texto de la historia y no se guarda nada (2 subcasos)', async () => {
      for (const status of ['CONFIRMADA', 'EN_CURSO'] as const) {
        const listing = await newListing();
        await reservation(
          listing,
          '2027-02-21T15:00:00Z',
          '2027-02-21T18:00:00Z',
          status,
        );

        const res = await block(listing, RANGO).expect(409);

        expect(res.body).toMatchObject({
          codigo: 'RANGO_CON_RESERVA',
          message: 'El rango tiene una reserva CONFIRMADA o EN_CURSO.',
        });
        expect(await blocksOf(listing)).toHaveLength(0);
      }
    });

    it('B07: PENDIENTE, RECHAZADA y COMPLETADA no impiden bloquear, ni una CONFIRMADA que solo toca el borde', async () => {
      const listing = await newListing();
      for (const status of ['PENDIENTE', 'RECHAZADA', 'COMPLETADA'] as const) {
        await reservation(
          listing,
          '2027-02-21T15:00:00Z',
          '2027-02-21T18:00:00Z',
          status,
        );
      }
      // Termina justo cuando empieza el bloqueo: [inicio, fin) no se cruzan.
      await reservation(
        listing,
        '2027-02-19T06:00:00Z',
        '2027-02-20T06:00:00Z',
        'CONFIRMADA',
      );

      await block(listing, RANGO).expect(201);
      expect(await blocksOf(listing)).toHaveLength(1);
    });
  });

  describe('criterio 4: fechas inválidas', () => {
    it('B08: fin anterior o igual al inicio: 400 que explica por qué y no se guarda nada', async () => {
      const listing = await newListing();

      const antes = await block(listing, {
        inicio: RANGO.fin,
        fin: RANGO.inicio,
      }).expect(400);
      // El mismo instante escrito en otra zona también es "igual".
      const igual = await block(listing, {
        inicio: '2027-02-20T00:00:00-06:00',
        fin: '2027-02-20T06:00:00Z',
      }).expect(400);

      for (const res of [antes, igual]) {
        expect(JSON.stringify(res.body.message)).toContain(
          'La fecha fin debe ser posterior a la de inicio.',
        );
      }
      expect(await blocksOf(listing)).toHaveLength(0);
    });

    it('B09: sin fecha, sin zona, fecha que no existe, motivo de 201 o propiedad de más: 400 y no se guarda nada', async () => {
      const listing = await newListing();
      const malos = [
        { fin: RANGO.fin },
        { inicio: '2027-02-20T00:00:00', fin: RANGO.fin },
        {
          inicio: '2027-02-30T00:00:00-06:00',
          fin: '2027-03-02T00:00:00-06:00',
        },
        { ...RANGO, motivo: 'm'.repeat(201) },
        { ...RANGO, estado: 'BLOQUEADO' },
      ];

      for (const body of malos) await block(listing, body).expect(400);
      expect(await blocksOf(listing)).toHaveLength(0);
    });
  });

  describe('criterio 5: solo el dueño puede bloquear', () => {
    it('B10: otro arrendador recibe 403 «Publicación no encontrada.» al bloquear y al listar', async () => {
      const listing = await newListing();

      const res = await block(listing, RANGO, otherLandlord).expect(403);
      expect(res.body.message).toBe('Publicación no encontrada.');
      await auth(
        http().get(`/api/v1/publicaciones/${listing}/bloqueos`),
        otherLandlord,
      ).expect(403);
      expect(await blocksOf(listing)).toHaveLength(0);
    });

    it('B11: el arrendatario recibe 403, sin sesión 401 y una publicación que no existe 404', async () => {
      const listing = await newListing();

      await block(listing, RANGO, tenant).expect(403);
      await block(listing, RANGO, null).expect(401);
      const res = await block(randomUUID(), RANGO).expect(404);
      expect(res.body.message).toBe('Publicación no encontrada.');
      expect(await blocksOf(listing)).toHaveLength(0);
    });
  });

  describe('concurrencia con la aprobación (H04)', () => {
    it('B12: bloquear y aprobar las mismas fechas a la vez: gana uno solo (5 repeticiones)', async () => {
      for (let vuelta = 0; vuelta < 5; vuelta++) {
        const listing = await newListing();
        const day = Date.UTC(2027, 3, 1 + vuelta, 6);
        const pendiente = await reservation(
          listing,
          new Date(day + 9 * HOUR).toISOString(),
          new Date(day + 12 * HOUR).toISOString(),
          'PENDIENTE',
        );

        const [bloqueo, aprobacion] = await Promise.all([
          block(listing, {
            inicio: new Date(day).toISOString(),
            fin: new Date(day + DAY).toISOString(),
          }),
          auth(
            http()
              .patch(`/api/v1/reservas/${pendiente.id}/decision`)
              .send({ decision: 'APROBAR' }),
            owner,
          ),
        ]);

        const estado = (
          await prisma.reservation.findUniqueOrThrow({
            where: { id: pendiente.id },
          })
        ).status;
        const bloqueos = await blocksOf(listing);
        if (bloqueo.status === 201) {
          expect(aprobacion.status).toBe(409);
          expect([estado, bloqueos.length]).toEqual(['PENDIENTE', 1]);
        } else {
          expect([bloqueo.status, aprobacion.status]).toEqual([409, 200]);
          expect([estado, bloqueos.length]).toEqual(['CONFIRMADA', 0]);
        }
      }
    });
  });
});
