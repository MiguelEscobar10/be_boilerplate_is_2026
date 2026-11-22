import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * Plan de pruebas, nivel componente: H15. Preguntar al arrendador antes de
 * reservar.
 *
 * Un `it` por criterio de aceptación (AC1 a AC6), más casos negativos. La
 * batería detallada está en test/qa/qa-15.1-mensajes.e2e-spec.ts (M01 a M23).
 */

type Session = { token: string; userId: string };

describe('H15. Preguntar al arrendador antes de reservar', () => {
  const email = `plan-h15-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  const LISTING_NAME = 'Cámara fotográfica profesional';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let tenant: Session;
  let outsider: Session;
  let listingId: string;
  let inactiveListingId: string;
  let accounts = 0;

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

  const open = (who: Session, id = listingId) =>
    http().post(`/api/v1/publicaciones/${id}/conversaciones`).set(auth(who));
  const send = (conversationId: string, who: Session, contenido: unknown) =>
    http()
      .post(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(auth(who))
      .send({ contenido });
  const read = (conversationId: string, who: Session) =>
    http()
      .get(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(auth(who));
  const texts = async (conversationId: string, who: Session) =>
    (
      (await read(conversationId, who).expect(200)).body.items as {
        contenido: string;
      }[]
    ).map((m) => m.contenido);
  const messagesIn = (conversationId: string) =>
    prisma.message.count({ where: { conversationId } });

  /** Conversación nueva y vacía entre `tenant` y `landlord`. */
  const fresh = async () => {
    await prisma.conversation.deleteMany({
      where: { listingId, tenantId: tenant.userId },
    });
    const { body } = await open(tenant).expect(201);
    return body.id as string;
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

    landlord = await account('ARRENDADOR');
    tenant = await account('ARRENDATARIO');
    outsider = await account('ARRENDATARIO');

    const listing = (isActive: boolean) =>
      prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'EQUIPO',
          name: LISTING_NAME,
          location: 'Antiguo Cuscatlán',
          rateAmount: '25.00',
          rateUnit: 'DIA',
          isActive,
        },
      });
    listingId = (await listing(true)).id;
    inactiveListingId = (await listing(false)).id;
  }, 60_000);

  afterAll(async () => {
    const users = { email: { endsWith: email } };
    await prisma.notification.deleteMany({ where: { user: users } });
    await prisma.conversation.deleteMany({
      where: { listingId: { in: [listingId, inactiveListingId] } },
    });
    await prisma.listing.deleteMany({
      where: { id: { in: [listingId, inactiveListingId] } },
    });
    await prisma.user.deleteMany({ where: users });
    await app.close();
  });

  it('AC1: desde el detalle de una publicación activa el arrendatario abre la conversación con el arrendador y le puede escribir', async () => {
    await prisma.conversation.deleteMany({ where: { listingId } });

    const { body } = await open(tenant).expect(201);
    await send(body.id, tenant, '¿Incluye tarjeta de memoria?').expect(201);

    const saved = await prisma.conversation.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(saved).toMatchObject({
      listingId,
      tenantId: tenant.userId,
      landlordId: landlord.userId,
    });
  });

  it('AC1 (negativo): con una publicación desactivada no se abre la conversación', async () => {
    await open(tenant, inactiveListingId).expect(404);
    expect(
      await prisma.conversation.count({
        where: { listingId: inactiveListingId },
      }),
    ).toBe(0);
  });

  it('AC2: el mensaje queda en el historial y lo ven los dos participantes', async () => {
    const id = await fresh();

    await send(id, tenant, '¿Está disponible el sábado?').expect(201);
    await send(id, landlord, 'Sí, desde las 8:00').expect(201);

    const expected = ['¿Está disponible el sábado?', 'Sí, desde las 8:00'];
    expect(await texts(id, tenant)).toEqual(expected);
    expect(await texts(id, landlord)).toEqual(expected);
  });

  it('AC3: al registrarse el mensaje, el otro participante recibe el aviso «Mensaje nuevo» con el nombre del bien y sin el contenido', async () => {
    const id = await fresh();

    const { body } = await send(id, tenant, 'Mi número es 7000-1234').expect(
      201,
    );

    const notice = await prisma.notification.findFirst({
      where: { userId: landlord.userId, referenceId: body.id },
    });
    expect(notice).toMatchObject({
      title: 'Mensaje nuevo',
      sourceModule: 'MENSAJERIA',
    });
    expect(notice?.message).toContain(LISTING_NAME);
    expect(notice?.message).not.toContain('7000-1234');
    expect(
      await prisma.notification.count({
        where: { userId: tenant.userId, referenceId: body.id },
      }),
    ).toBe(0);
  });

  it('AC4 (negativo): un mensaje de más de 1000 caracteres no se envía e indica el máximo de 1000', async () => {
    const id = await fresh();

    const { body } = await send(id, tenant, 'a'.repeat(1001)).expect(400);

    expect(String(body.message)).toMatch(/1000/);
    expect(await messagesIn(id)).toBe(0);
  });

  it('AC4: exactamente 1000 caracteres sí se envía', async () => {
    const id = await fresh();
    await send(id, tenant, 'a'.repeat(1000)).expect(201);
    expect(await messagesIn(id)).toBe(1);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '    '],
  ])(
    'AC5 (negativo): un mensaje %s no se permite',
    async (_caso, contenido) => {
      const id = await fresh();
      await send(id, tenant, contenido).expect(400);
      expect(await messagesIn(id)).toBe(0);
    },
  );

  it('AC6 (negativo): quien no participa no puede abrir ni leer la conversación, ni escribir en ella', async () => {
    const id = await fresh();
    await send(id, tenant, 'Pregunta privada').expect(201);

    await read(id, outsider).expect(404);
    await send(id, outsider, 'Me meto').expect(404);

    expect(await messagesIn(id)).toBe(1);
  });
});
