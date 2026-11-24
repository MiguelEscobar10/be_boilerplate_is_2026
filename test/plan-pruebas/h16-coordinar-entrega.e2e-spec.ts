import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * Plan de pruebas, nivel componente: H16. Coordinar la entrega con el
 * arrendatario.
 *
 * Un `it` por criterio de aceptación (AC1 a AC5), más casos negativos. La
 * batería detallada está en test/qa/qa-16.1-conversacion-reserva.e2e-spec.ts
 * (R01 a R20).
 */

type Session = { token: string; userId: string };
type Status =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'EN_CURSO'
  | 'COMPLETADA';

const DAY = 24 * 60 * 60 * 1000;

describe('H16. Coordinar la entrega con el arrendatario', () => {
  const email = `plan-h16-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  const LISTING_NAME = 'Salón de eventos para 80 personas';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let tenant: Session;
  let listingId: string;
  let accounts = 0;
  let slot = 0;

  const http = () => request(app.getHttpServer());
  const auth = (who: Session) => ({ Authorization: `Bearer ${who.token}` });

  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `p${++accounts}-${email}`;
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

  /** Reserva del arrendatario en días que no se cruzan con las demás. */
  const reservation = async (status: Status) => {
    const startAt = new Date(Date.UTC(2027, 5, 1) + slot++ * 3 * DAY);
    const r = await prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt,
        endAt: new Date(startAt.getTime() + DAY),
        status,
        rentalCost: '150.00',
        depositAmount: '200.00',
      },
    });
    return r.id;
  };
  const setStatus = (id: string, status: Status) =>
    prisma.reservation.update({ where: { id }, data: { status } });

  const open = (reservationId: string, who: Session = tenant) =>
    http()
      .post(`/api/v1/reservas/${reservationId}/conversacion`)
      .set(auth(who));
  const send = (conversationId: string, who: Session, contenido: unknown) =>
    http()
      .post(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(auth(who))
      .send({ contenido });
  const texts = async (conversationId: string, who: Session) =>
    (
      (
        await http()
          .get(`/api/v1/conversaciones/${conversationId}/mensajes`)
          .set(auth(who))
          .expect(200)
      ).body.items as { contenido: string }[]
    ).map((m) => m.contenido);
  const messagesIn = (conversationId: string) =>
    prisma.message.count({ where: { conversationId } });
  const conversationsOf = (reservationId: string) =>
    prisma.conversation.count({ where: { reservationId } });

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
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'ESPACIO',
          name: LISTING_NAME,
          location: 'Santa Tecla',
          rateAmount: '150.00',
          rateUnit: 'DIA',
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    const users = { email: { endsWith: email } };
    await prisma.notification.deleteMany({ where: { user: users } });
    await prisma.conversation.deleteMany({ where: { listingId } });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: users });
    await app.close();
  });

  it('AC1: con la reserva CONFIRMADA la conversación queda habilitada para el arrendador y el arrendatario', async () => {
    const id = await reservation('CONFIRMADA');

    const first = await open(id, tenant).expect(201);
    const again = await open(id, landlord).expect(200);

    expect(again.body.id).toBe(first.body.id);
    for (const r of [first, again]) {
      expect(r.body).toMatchObject({
        estadoReserva: 'CONFIRMADA',
        puedeEscribir: true,
      });
    }
  });

  it('AC2: el mensaje queda en el historial y el otro participante recibe el aviso del servicio de avisos', async () => {
    const id = await reservation('CONFIRMADA');
    const { body: conversation } = await open(id);

    const { body } = await send(
      conversation.id,
      landlord,
      'Nos vemos el sábado a las 9:00 en el salón',
    ).expect(201);

    const expected = ['Nos vemos el sábado a las 9:00 en el salón'];
    expect(await texts(conversation.id, tenant)).toEqual(expected);
    expect(await texts(conversation.id, landlord)).toEqual(expected);

    const notice = await prisma.notification.findFirst({
      where: { userId: tenant.userId, referenceId: body.id },
    });
    expect(notice).toMatchObject({
      title: 'Mensaje nuevo',
      sourceModule: 'MENSAJERIA',
    });
    expect(notice?.message).not.toContain('9:00');
  });

  it('AC3 (negativo): con la reserva PENDIENTE la conversación no está habilitada', async () => {
    const id = await reservation('PENDIENTE');

    for (const who of [tenant, landlord]) {
      const { body } = await open(id, who).expect(409);
      expect(body.codigo).toBe('CONVERSACION_NO_HABILITADA');
    }
    expect(await conversationsOf(id)).toBe(0);

    await setStatus(id, 'CONFIRMADA');
    await open(id).expect(201);
  });

  it.each(['RECHAZADA', 'COMPLETADA'] as const)(
    'AC4 (negativo): con la reserva %s el mensaje no se envía, se indica el motivo y el historial sigue visible',
    async (status) => {
      const id = await reservation('CONFIRMADA');
      const { body: conversation } = await open(id);
      await send(conversation.id, tenant, 'Gracias por todo').expect(201);
      await setStatus(id, status);

      const { body } = await send(
        conversation.id,
        tenant,
        'Una cosa más',
      ).expect(409);

      expect(body.codigo).toBe('CONVERSACION_CERRADA');
      expect(String(body.message).length).toBeGreaterThan(0);
      expect(await messagesIn(conversation.id)).toBe(1);
      expect(await texts(conversation.id, tenant)).toEqual([
        'Gracias por todo',
      ]);
      expect(await texts(conversation.id, landlord)).toEqual([
        'Gracias por todo',
      ]);
    },
  );

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['de más de 1000 caracteres', 'a'.repeat(1001)],
  ])(
    'AC5 (negativo): un mensaje %s no se permite (mismas reglas de H15)',
    async (_caso, contenido) => {
      const id = await reservation('CONFIRMADA');
      const { body: conversation } = await open(id);

      await send(conversation.id, tenant, contenido).expect(400);

      expect(await messagesIn(conversation.id)).toBe(0);
    },
  );
});
