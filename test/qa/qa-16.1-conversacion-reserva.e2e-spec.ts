import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-16.1 (MP4-88): la conversación de la reserva en cada uno de sus estados
 * (H16).
 *
 * Cada caso tiene un id (R01, R02...) que se repite en la evidencia de
 * docs/qa/QA-16.1-conversacion-reserva.md. Además de la respuesta HTTP, cada
 * caso revisa lo guardado: filas de `conversations` y `messages`, y avisos en
 * `notifications`.
 *
 * Las reservas se crean directo en la base en el estado que pide cada caso, y
 * los cambios de estado también se hacen ahí: cómo se llega a cada estado lo
 * prueban QA-04.1 y QA-08.1.
 */

type Session = { token: string; userId: string };
type Status =
  | 'PENDIENTE'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'EN_CURSO'
  | 'COMPLETADA';

const DAY = 86_400_000;

describe('QA-16.1: conversación de la reserva en cada estado', () => {
  const email = `qa-16.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  const LISTING_NAME = 'Sala de reuniones Torre Norte';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let otherTenant: Session;
  let listingId: string;
  let accounts = 0;
  let slot = 0;

  const http = () => request(app.getHttpServer());
  const auth = (who: Session) => ({ Authorization: `Bearer ${who.token}` });

  const account = async (rol: 'ARRENDATARIO' | 'ARRENDADOR') => {
    const address = `${rol === 'ARRENDADOR' ? 'dueno' : 'inquilino'}${++accounts}-${email}`;
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
    const startAt = new Date(Date.UTC(2027, 2, 1) + slot++ * 3 * DAY);
    const r = await prisma.reservation.create({
      data: {
        listingId,
        tenantId: tenant.userId,
        startAt,
        endAt: new Date(startAt.getTime() + DAY),
        status,
        rentalCost: '40.00',
        depositAmount: '10.00',
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
  const read = (conversationId: string, who: Session = tenant) =>
    http()
      .get(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(auth(who));
  const texts = async (conversationId: string, who: Session = tenant) =>
    (
      (await read(conversationId, who).expect(200)).body.items as {
        contenido: string;
      }[]
    ).map((m) => m.contenido);

  const conversationsOf = (reservationId: string) =>
    prisma.conversation.count({ where: { reservationId } });
  const messagesIn = (conversationId: string) =>
    prisma.message.count({ where: { conversationId } });
  const noticesFor = (who: Session) =>
    prisma.notification.count({
      where: { userId: who.userId, sourceModule: 'MENSAJERIA' },
    });

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
    otherLandlord = await account('ARRENDADOR');
    tenant = await account('ARRENDATARIO');
    otherTenant = await account('ARRENDATARIO');

    listingId = (
      await prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'ESPACIO',
          name: LISTING_NAME,
          location: 'San Salvador',
          rateAmount: '40.00',
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

  describe('criterio 1: con la reserva CONFIRMADA ya pueden conversar', () => {
    it('R01: el arrendatario la abre (201) y el arrendador llega a la misma (200)', async () => {
      const id = await reservation('CONFIRMADA');

      const byTenant = await open(id, tenant).expect(201);
      const byLandlord = await open(id, landlord).expect(200);

      expect(byLandlord.body.id).toBe(byTenant.body.id);
      expect(await conversationsOf(id)).toBe(1);
      const saved = await prisma.conversation.findUniqueOrThrow({
        where: { id: byTenant.body.id },
      });
      expect(saved).toMatchObject({
        reservationId: id,
        listingId,
        tenantId: tenant.userId,
        landlordId: landlord.userId,
      });
    });

    it('R02: el arrendador también la puede abrir primero', async () => {
      const id = await reservation('CONFIRMADA');

      await open(id, landlord).expect(201);
      await open(id, tenant).expect(200);
    });

    it('R03: si los dos la abren a la vez queda una sola', async () => {
      const id = await reservation('CONFIRMADA');

      const [a, b] = await Promise.all([open(id, tenant), open(id, landlord)]);

      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await conversationsOf(id)).toBe(1);
    });

    it('R04: es distinta de la conversación previa a la reserva', async () => {
      const id = await reservation('CONFIRMADA');
      const previous = await http()
        .post(`/api/v1/publicaciones/${listingId}/conversaciones`)
        .set(auth(tenant));

      const { body } = await open(id).expect(201);

      expect(body.id).not.toBe(previous.body.id);
    });
  });

  describe('criterio 2: el mensaje queda en el historial y la otra persona recibe el aviso', () => {
    it('R05: con la reserva CONFIRMADA el mensaje se guarda, lo leen los dos y avisa sin el texto', async () => {
      const id = await reservation('CONFIRMADA');
      const { body: conversation } = await open(id);
      const before = await noticesFor(tenant);

      const { body: message } = await send(
        conversation.id,
        landlord,
        'Te espero el lunes a las 8 en la recepción',
      ).expect(201);

      expect(await texts(conversation.id, tenant)).toEqual([
        'Te espero el lunes a las 8 en la recepción',
      ]);
      expect(await texts(conversation.id, landlord)).toEqual([
        'Te espero el lunes a las 8 en la recepción',
      ]);
      const notice = await prisma.notification.findFirst({
        where: { userId: tenant.userId, referenceId: message.id },
      });
      expect(notice).toMatchObject({
        sourceModule: 'MENSAJERIA',
        title: 'Mensaje nuevo',
      });
      expect(notice?.message).toContain(LISTING_NAME);
      expect(notice?.message).not.toContain('recepción');
      expect(await noticesFor(tenant)).toBe(before + 1);
    });

    it('R06: con la reserva EN_CURSO los dos siguen escribiendo', async () => {
      const id = await reservation('EN_CURSO');
      const { body: conversation } = await open(id).expect(201);

      await send(conversation.id, tenant, 'Ya llegué').expect(201);
      await send(conversation.id, landlord, 'Perfecto, voy').expect(201);

      expect(await texts(conversation.id)).toEqual([
        'Ya llegué',
        'Perfecto, voy',
      ]);
    });
  });

  describe('criterio 3: con la reserva PENDIENTE todavía no está habilitada', () => {
    it('R07: abrirla responde 409 CONVERSACION_NO_HABILITADA para los dos y no crea nada', async () => {
      const id = await reservation('PENDIENTE');

      for (const who of [tenant, landlord]) {
        const { body } = await open(id, who).expect(409);
        expect(body).toMatchObject({
          statusCode: 409,
          codigo: 'CONVERSACION_NO_HABILITADA',
        });
      }
      expect(await conversationsOf(id)).toBe(0);
    });

    it('R08: al confirmarse la reserva, la misma petición ya funciona', async () => {
      const id = await reservation('PENDIENTE');
      await open(id).expect(409);

      await setStatus(id, 'CONFIRMADA');

      await open(id).expect(201);
    });
  });

  describe('criterio 4: RECHAZADA o COMPLETADA no dejan escribir, pero el historial sigue', () => {
    it.each(['RECHAZADA', 'CANCELADA', 'COMPLETADA'] as const)(
      'R09: sin conversación previa, con la reserva %s abrirla da 409 CONVERSACION_CERRADA y no crea nada',
      async (status) => {
        const id = await reservation(status);

        const { body } = await open(id).expect(409);

        expect(body.codigo).toBe('CONVERSACION_CERRADA');
        expect(String(body.message)).toMatch(/cerrada/i);
        expect(await conversationsOf(id)).toBe(0);
      },
    );

    it.each(['CANCELADA', 'COMPLETADA'] as const)(
      'R10: con la reserva %s el mensaje no se envía, se explica el motivo, no se guarda ni avisa, y el historial sigue',
      async (status) => {
        const id = await reservation('CONFIRMADA');
        const { body: conversation } = await open(id);
        await send(conversation.id, tenant, 'Gracias por todo').expect(201);
        await setStatus(id, status);
        const notices = await noticesFor(landlord);

        for (const who of [tenant, landlord]) {
          const { body } = await send(
            conversation.id,
            who,
            'Una cosa más',
          ).expect(409);
          expect(body.codigo).toBe('CONVERSACION_CERRADA');
          expect(String(body.message)).toMatch(/historial/i);
        }

        expect(await messagesIn(conversation.id)).toBe(1);
        expect(await noticesFor(landlord)).toBe(notices);
        expect(await texts(conversation.id, tenant)).toEqual([
          'Gracias por todo',
        ]);
        expect(await texts(conversation.id, landlord)).toEqual([
          'Gracias por todo',
        ]);
        await open(id).expect(200);
      },
    );

    it('R11: una conversación que pasó a RECHAZADA (dato inconsistente) también queda cerrada', async () => {
      // Una reserva se rechaza desde PENDIENTE, así que no debería tener
      // conversación. Si por un error quedara una, igual no se puede escribir.
      const id = await reservation('CONFIRMADA');
      const { body: conversation } = await open(id);
      await setStatus(id, 'RECHAZADA');

      const { body } = await send(conversation.id, tenant, 'Hola').expect(409);

      expect(body.codigo).toBe('CONVERSACION_CERRADA');
      expect(await messagesIn(conversation.id)).toBe(0);
    });

    it('R12: el historial persiste en todos los estados por los que pasa la reserva', async () => {
      const id = await reservation('CONFIRMADA');
      const { body: conversation } = await open(id);
      await send(conversation.id, tenant, '1. Confirmada').expect(201);
      await setStatus(id, 'EN_CURSO');
      await send(conversation.id, landlord, '2. En curso').expect(201);
      await setStatus(id, 'COMPLETADA');

      expect(await texts(conversation.id, tenant)).toEqual([
        '1. Confirmada',
        '2. En curso',
      ]);
      expect(await texts(conversation.id, landlord)).toEqual([
        '1. Confirmada',
        '2. En curso',
      ]);
    });
  });

  describe('criterio 5: mismas reglas de contenido que H15', () => {
    it.each([
      ['R13', 'vacío', ''],
      ['R14', 'de solo espacios', '   '],
      ['R15', 'de 1001 caracteres', 'a'.repeat(1001)],
    ])(
      '%s: un mensaje %s responde 400 y no se guarda ni avisa',
      async (_id, _caso, contenido) => {
        const id = await reservation('CONFIRMADA');
        const { body: conversation } = await open(id);
        const notices = await noticesFor(landlord);

        await send(conversation.id, tenant, contenido).expect(400);

        expect(await messagesIn(conversation.id)).toBe(0);
        expect(await noticesFor(landlord)).toBe(notices);
      },
    );

    it('R16: exactamente 1000 caracteres se acepta', async () => {
      const id = await reservation('CONFIRMADA');
      const { body: conversation } = await open(id);

      await send(conversation.id, tenant, 'a'.repeat(1000)).expect(201);
    });
  });

  describe('permisos', () => {
    it.each([
      ['R17', 'otro arrendatario', () => otherTenant],
      ['R18', 'otro arrendador', () => otherLandlord],
    ])(
      '%s: %s no abre la reserva ni lee ni escribe en su conversación (404)',
      async (_id, _quien, who) => {
        const id = await reservation('CONFIRMADA');
        const { body: conversation } = await open(id);
        await send(conversation.id, tenant, 'Privado').expect(201);

        await open(id, who()).expect(404);
        await read(conversation.id, who()).expect(404);
        await send(conversation.id, who(), 'Me meto').expect(404);

        expect(await messagesIn(conversation.id)).toBe(1);
        expect(await conversationsOf(id)).toBe(1);
      },
    );

    it('R19: una reserva que no existe es 404 y un id que no es UUID es 400', async () => {
      await open(randomUUID()).expect(404);
      await open('no-es-uuid').expect(400);
    });

    it('R20: sin sesión responde 401', async () => {
      const id = await reservation('CONFIRMADA');

      await http().post(`/api/v1/reservas/${id}/conversacion`).expect(401);
    });
  });
});
