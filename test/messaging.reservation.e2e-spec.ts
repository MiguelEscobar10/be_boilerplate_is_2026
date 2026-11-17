import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

type Status =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'EN_CURSO'
  | 'COMPLETADA';

/**
 * Conversación de la reserva (BE-16.1, H16).
 *
 * Levanta la app completa contra la base de pruebas y borra al final solo lo
 * que creó. Los estados de la reserva se ponen directo en la base: cómo se
 * llega a cada uno lo prueban BE-04.1 y BE-08.1.
 */
describe('mensajería: conversación de la reserva (BE-16.1)', () => {
  const suffix = `be-16.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let listingId: string;
  const who = ['landlord', 'tenant', 'other', 'otherLandlord'] as const;
  type Who = (typeof who)[number];
  const tokens = {} as Record<Who, string>;
  const ids = {} as Record<Who, string>;

  const http = () => request(app.getHttpServer());
  const as = (user: Who) => ({ Authorization: `Bearer ${tokens[user]}` });

  async function createAccount(user: Who, rol: 'ARRENDADOR' | 'ARRENDATARIO') {
    const email = `${user}-${suffix}`;
    const { body } = await http()
      .post('/api/v1/users')
      .send({ email, password, rol, nombre: user, telefono: '70001234' })
      .expect(201);
    ids[user] = body.id;
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    tokens[user] = login.body.accessToken;
  }

  // Cada reserva usa días distintos para no chocar con la regla de traslape.
  let day = 0;
  async function newReservation(status: Status): Promise<string> {
    day += 3;
    const startAt = new Date(Date.UTC(2027, 0, 1 + day, 15));
    const endAt = new Date(Date.UTC(2027, 0, 2 + day, 15));
    const reservation = await prisma.reservation.create({
      data: {
        listingId,
        tenantId: ids.tenant,
        startAt,
        endAt,
        status,
        rentalCost: '30.00',
        depositAmount: '10.00',
      },
    });
    return reservation.id;
  }

  const setStatus = (id: string, status: Status) =>
    prisma.reservation.update({ where: { id }, data: { status } });

  const open = (reservationId: string, user: Who = 'tenant') =>
    http().post(`/api/v1/reservas/${reservationId}/conversacion`).set(as(user));

  const send = (
    conversationId: string,
    contenido: unknown,
    user: Who = 'tenant',
  ) =>
    http()
      .post(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(as(user))
      .send({ contenido });

  const history = (conversationId: string, user: Who = 'tenant') =>
    http()
      .get(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(as(user));

  beforeAll(async () => {
    process.env.DATABASE_URL = resolveTestDatabaseUrl();
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

    await createAccount('landlord', 'ARRENDADOR');
    await createAccount('tenant', 'ARRENDATARIO');
    await createAccount('other', 'ARRENDATARIO');
    await createAccount('otherLandlord', 'ARRENDADOR');

    const listing = await prisma.listing.create({
      data: {
        landlordId: ids.landlord,
        type: 'ESPACIO',
        name: 'Sala de reuniones',
        location: 'San Salvador',
        rateAmount: '30.00',
        rateUnit: 'DIA',
      },
    });
    listingId = listing.id;
  }, 60_000);

  afterAll(async () => {
    const users = { email: { endsWith: suffix } };
    await prisma.notification.deleteMany({ where: { user: users } });
    await prisma.conversation.deleteMany({ where: { listingId } });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: users });
    await app.close();
  });

  describe('abrir la conversación', () => {
    it('con la reserva CONFIRMADA la crea (201) y después la recupera (200)', async () => {
      const reservationId = await newReservation('CONFIRMADA');

      const first = await open(reservationId).expect(201);
      const second = await open(reservationId).expect(200);

      expect(second.body).toEqual({ id: first.body.id });
      const saved = await prisma.conversation.findUniqueOrThrow({
        where: { id: first.body.id },
      });
      expect(saved).toMatchObject({
        reservationId,
        listingId,
        tenantId: ids.tenant,
        landlordId: ids.landlord,
      });
    });

    it('el arrendador también la abre y llega a la misma', async () => {
      const reservationId = await newReservation('CONFIRMADA');

      const byLandlord = await open(reservationId, 'landlord').expect(201);
      const byTenant = await open(reservationId, 'tenant').expect(200);

      expect(byTenant.body.id).toBe(byLandlord.body.id);
    });

    it('con la reserva EN_CURSO también se abre', async () => {
      const reservationId = await newReservation('EN_CURSO');

      await open(reservationId).expect(201);
    });

    it('si los dos la abren al mismo tiempo queda una sola', async () => {
      const reservationId = await newReservation('CONFIRMADA');

      const [a, b] = await Promise.all([
        open(reservationId, 'tenant'),
        open(reservationId, 'landlord'),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(
        await prisma.conversation.count({ where: { reservationId } }),
      ).toBe(1);
    });

    it('no es la misma que la conversación previa a la reserva', async () => {
      const reservationId = await newReservation('CONFIRMADA');
      const previous = await http()
        .post(`/api/v1/publicaciones/${listingId}/conversaciones`)
        .set(as('tenant'));

      const ofReservation = await open(reservationId);

      expect(ofReservation.body.id).not.toBe(previous.body.id);
    });

    it('con la reserva PENDIENTE responde 409 CONVERSACION_NO_HABILITADA', async () => {
      const reservationId = await newReservation('PENDIENTE');

      const { body } = await open(reservationId).expect(409);

      expect(body.codigo).toBe('CONVERSACION_NO_HABILITADA');
      expect(
        await prisma.conversation.count({ where: { reservationId } }),
      ).toBe(0);
    });

    it.each(['RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
      'con la reserva %s y sin conversación responde 409 CONVERSACION_CERRADA',
      async (status) => {
        const reservationId = await newReservation(status);

        const { body } = await open(reservationId).expect(409);

        expect(body.codigo).toBe('CONVERSACION_CERRADA');
      },
    );

    it('una reserva de otro arrendatario es 404', async () => {
      const reservationId = await newReservation('CONFIRMADA');

      await open(reservationId, 'other').expect(404);
    });

    it('un arrendador que no es el dueño también recibe 404', async () => {
      const reservationId = await newReservation('CONFIRMADA');

      await open(reservationId, 'otherLandlord').expect(404);
    });

    it('una reserva que no existe es 404 y un id que no es UUID es 400', async () => {
      await open(randomUUID()).expect(404);
      await open('no-es-un-uuid').expect(400);
    });

    it('sin sesión responde 401', async () => {
      const reservationId = await newReservation('CONFIRMADA');

      await http()
        .post(`/api/v1/reservas/${reservationId}/conversacion`)
        .expect(401);
    });
  });

  describe('mensajes según el estado de la reserva', () => {
    it('con la reserva CONFIRMADA guarda el mensaje y avisa al otro sin el texto', async () => {
      const reservationId = await newReservation('CONFIRMADA');
      const { body: conversation } = await open(reservationId);

      const { body: message } = await send(
        conversation.id,
        'Te espero el lunes a las 8 en el portón',
        'landlord',
      ).expect(201);

      const aviso = await prisma.notification.findFirst({
        where: { userId: ids.tenant, referenceId: message.id },
      });
      expect(aviso).toMatchObject({
        sourceModule: 'MENSAJERIA',
        title: 'Mensaje nuevo',
        referenceType: 'mensaje',
      });
      expect(aviso?.message).toContain('Sala de reuniones');
      expect(aviso?.message).not.toContain('portón');
    });

    it('sigue habilitada cuando la reserva pasa a EN_CURSO', async () => {
      const reservationId = await newReservation('CONFIRMADA');
      const { body: conversation } = await open(reservationId);
      await send(conversation.id, 'Ya voy en camino').expect(201);

      await setStatus(reservationId, 'EN_CURSO');

      await send(conversation.id, 'Ya llegué', 'tenant').expect(201);
      await send(conversation.id, 'Perfecto', 'landlord').expect(201);
    });

    it.each(['RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
      'con la reserva %s el POST da 409 CONVERSACION_CERRADA y el historial sigue',
      async (status) => {
        const reservationId = await newReservation('CONFIRMADA');
        const { body: conversation } = await open(reservationId);
        await send(conversation.id, 'Gracias por todo').expect(201);
        await setStatus(reservationId, status);

        const { body } = await send(conversation.id, 'Una cosa más').expect(
          409,
        );
        expect(body.codigo).toBe('CONVERSACION_CERRADA');

        const { body: page } = await history(conversation.id).expect(200);
        expect(
          page.items.map((m: { contenido: string }) => m.contenido),
        ).toEqual(['Gracias por todo']);
        // También se puede volver a pedir la conversación para leerla.
        await open(reservationId).expect(200);
      },
    );

    it('el mensaje rechazado no se guarda ni genera aviso', async () => {
      const reservationId = await newReservation('CONFIRMADA');
      const { body: conversation } = await open(reservationId);
      await setStatus(reservationId, 'COMPLETADA');
      const before = await prisma.notification.count({
        where: { userId: ids.landlord },
      });

      await send(conversation.id, 'No debería llegar').expect(409);

      expect(
        await prisma.message.count({
          where: { conversationId: conversation.id },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({ where: { userId: ids.landlord } }),
      ).toBe(before);
    });

    it.each([
      ['vacío', ''],
      ['de solo espacios', '   '],
      ['de 1001 caracteres', 'a'.repeat(1001)],
    ])('un mensaje %s responde 400', async (_case, contenido) => {
      const reservationId = await newReservation('CONFIRMADA');
      const { body: conversation } = await open(reservationId);

      await send(conversation.id, contenido).expect(400);
    });

    it('un mensaje de 1000 caracteres se acepta', async () => {
      const reservationId = await newReservation('CONFIRMADA');
      const { body: conversation } = await open(reservationId);

      await send(conversation.id, 'a'.repeat(1000)).expect(201);
    });

    it('una tercera persona no lee ni escribe: 404', async () => {
      const reservationId = await newReservation('CONFIRMADA');
      const { body: conversation } = await open(reservationId);

      await send(conversation.id, 'Hola', 'other').expect(404);
      await history(conversation.id, 'other').expect(404);
      await history(conversation.id, 'otherLandlord').expect(404);
    });

    it('la conversación previa a la reserva no depende de ningún estado', async () => {
      const { body: previous } = await http()
        .post(`/api/v1/publicaciones/${listingId}/conversaciones`)
        .set(as('tenant'));

      await send(previous.id, '¿Tiene proyector?').expect(201);
    });
  });
});
