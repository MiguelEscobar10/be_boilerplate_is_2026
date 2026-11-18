import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from '../helpers/test-database.js';

/**
 * QA-15.1 (MP4-84): mensajes, avisos y privacidad de la conversación previa a
 * la reserva (H15).
 *
 * Cada caso tiene un id (M01, M02...) que se repite en la evidencia de
 * docs/qa/QA-15.1-mensajes.md. Además de la respuesta HTTP, cada caso revisa
 * lo guardado: filas de `conversations` y `messages`, y avisos en
 * `notifications`.
 */

type Session = { token: string; userId: string };

describe('QA-15.1: conversación antes de reservar', () => {
  const email = `qa-15.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  const LISTING_NAME = 'Taladro percutor Bosch';
  let app: INestApplication<App>;
  let prisma: import('../../src/prisma/services/prisma.service.js').PrismaService;
  let landlord: Session;
  let otherLandlord: Session;
  let tenant: Session;
  let otherTenant: Session;
  let listingId: string;
  let inactiveListingId: string;
  let accounts = 0;

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

  const open = (who: Session, id = listingId) =>
    http().post(`/api/v1/publicaciones/${id}/conversaciones`).set(auth(who));
  const send = (conversationId: string, who: Session, body: unknown) =>
    http()
      .post(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(auth(who))
      .send(body as object);
  const read = (conversationId: string, who: Session, query = '') =>
    http()
      .get(`/api/v1/conversaciones/${conversationId}/mensajes${query}`)
      .set(auth(who));

  const messagesIn = (conversationId: string) =>
    prisma.message.count({ where: { conversationId } });
  const noticesFor = (who: Session) =>
    prisma.notification.findMany({
      where: { userId: who.userId, sourceModule: 'MENSAJERIA' },
    });

  /** Conversación nueva, limpia, entre `tenant` y `landlord`. */
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
    otherLandlord = await account('ARRENDADOR');
    tenant = await account('ARRENDATARIO');
    otherTenant = await account('ARRENDATARIO');

    const listing = (isActive: boolean) =>
      prisma.listing.create({
        data: {
          landlordId: landlord.userId,
          type: 'EQUIPO',
          name: LISTING_NAME,
          location: 'San Salvador',
          rateAmount: '15.00',
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

  describe('criterio 1: abrir la conversación desde una publicación activa', () => {
    it('M01: el arrendatario la abre (201) y al volver la recupera (200)', async () => {
      await prisma.conversation.deleteMany({ where: { listingId } });

      const first = await open(tenant).expect(201);
      const again = await open(tenant).expect(200);

      expect(again.body.id).toBe(first.body.id);
      const saved = await prisma.conversation.findUniqueOrThrow({
        where: { id: first.body.id },
      });
      expect(saved).toMatchObject({
        listingId,
        tenantId: tenant.userId,
        landlordId: landlord.userId,
        reservationId: null,
      });
    });

    it('M02: con una publicación desactivada o que no existe responde 404 y no crea nada', async () => {
      await open(tenant, inactiveListingId).expect(404);
      await open(tenant, randomUUID()).expect(404);

      expect(
        await prisma.conversation.count({
          where: { listingId: inactiveListingId },
        }),
      ).toBe(0);
    });

    it('M03: un arrendador no abre conversaciones (403), ni en su propia publicación', async () => {
      await open(landlord).expect(403);
      await open(otherLandlord).expect(403);
    });

    it('M04: sin sesión responde 401', async () => {
      await http()
        .post(`/api/v1/publicaciones/${listingId}/conversaciones`)
        .expect(401);
    });
  });

  describe('criterio 2: el mensaje queda en el historial y lo ven los dos', () => {
    it('M05: el mensaje del arrendatario se guarda y lo leen él y el arrendador', async () => {
      const id = await fresh();

      const { body: created } = await send(id, tenant, {
        contenido: '  ¿Incluye las brocas?  ',
      }).expect(201);

      const saved = await prisma.message.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(saved).toMatchObject({
        authorId: tenant.userId,
        content: '¿Incluye las brocas?',
      });
      for (const who of [tenant, landlord]) {
        const { body } = await read(id, who).expect(200);
        expect(body.items).toEqual([
          expect.objectContaining({
            id: created.id,
            autorId: tenant.userId,
            contenido: '¿Incluye las brocas?',
          }),
        ]);
      }
    });

    it('M06: la respuesta del arrendador queda después, en orden cronológico', async () => {
      const id = await fresh();
      await send(id, tenant, { contenido: 'Hola' }).expect(201);
      await send(id, landlord, { contenido: 'Sí, incluye 5 brocas' }).expect(
        201,
      );
      await send(id, tenant, { contenido: 'Gracias' }).expect(201);

      const { body } = await read(id, tenant).expect(200);
      expect(body.items.map((m: { contenido: string }) => m.contenido)).toEqual(
        ['Hola', 'Sí, incluye 5 brocas', 'Gracias'],
      );
      expect(body.total).toBe(3);
    });

    it('M07: el historial pagina y no pierde mensajes', async () => {
      const id = await fresh();
      for (let i = 1; i <= 5; i++) {
        await send(id, tenant, { contenido: `Mensaje ${i}` }).expect(201);
      }

      const first = await read(id, landlord, '?page=1&limit=2').expect(200);
      const last = await read(id, landlord, '?page=3&limit=2').expect(200);

      expect(first.body).toMatchObject({ page: 1, limit: 2, total: 5 });
      expect(
        first.body.items.map((m: { contenido: string }) => m.contenido),
      ).toEqual(['Mensaje 1', 'Mensaje 2']);
      expect(
        last.body.items.map((m: { contenido: string }) => m.contenido),
      ).toEqual(['Mensaje 5']);
    });
  });

  describe('criterio 3: aviso "Mensaje nuevo" sin el texto', () => {
    it('M08: el arrendador recibe el aviso con el nombre del bien y sin el texto; quien escribe no', async () => {
      const id = await fresh();
      const before = (await noticesFor(tenant)).length;

      const { body } = await send(id, tenant, {
        contenido: 'Mi número es 7000-1234, ¿me llama?',
      }).expect(201);

      const notice = (await noticesFor(landlord)).find(
        (n) => n.referenceId === body.id,
      );
      expect(notice).toMatchObject({
        title: 'Mensaje nuevo',
        referenceType: 'mensaje',
      });
      expect(notice?.message).toContain(LISTING_NAME);
      expect(notice?.message).not.toContain('7000-1234');
      expect((await noticesFor(tenant)).length).toBe(before);
    });

    it('M09: cuando responde el arrendador, el aviso le llega al arrendatario', async () => {
      const id = await fresh();

      const { body } = await send(id, landlord, {
        contenido: 'Sí, está disponible el sábado',
      }).expect(201);

      const notice = (await noticesFor(tenant)).find(
        (n) => n.referenceId === body.id,
      );
      expect(notice?.title).toBe('Mensaje nuevo');
      expect(notice?.message).not.toContain('sábado');
    });
  });

  describe('criterio 4: mensajes inválidos', () => {
    it.each([
      ['M10', 'vacío', ''],
      ['M11', 'de solo espacios', '    '],
      ['M12', 'de 1001 caracteres', 'a'.repeat(1001)],
      ['M13', 'que no es texto', 42],
      ['M14', 'sin contenido', undefined],
    ])(
      '%s: un mensaje %s responde 400 con el motivo y no guarda nada ni avisa',
      async (_id, _caso, contenido) => {
        const id = await fresh();
        const notices = (await noticesFor(landlord)).length;

        const { body } = await send(
          id,
          tenant,
          contenido === undefined ? {} : { contenido },
        ).expect(400);

        expect(String(body.message)).toMatch(/mensaje/i);
        expect(await messagesIn(id)).toBe(0);
        expect((await noticesFor(landlord)).length).toBe(notices);
      },
    );

    it('M15: exactamente 1000 caracteres se acepta', async () => {
      const id = await fresh();

      await send(id, tenant, { contenido: 'a'.repeat(1000) }).expect(201);

      expect(await messagesIn(id)).toBe(1);
    });

    it('M16: no se puede mandar otro autor en el cuerpo (400) y no se guarda', async () => {
      const id = await fresh();

      await send(id, tenant, {
        contenido: 'Hola',
        autorId: landlord.userId,
      }).expect(400);

      expect(await messagesIn(id)).toBe(0);
    });
  });

  describe('criterio 5: solo la ven los dos participantes', () => {
    it.each([
      ['M17', 'otro arrendatario', () => otherTenant],
      ['M18', 'otro arrendador', () => otherLandlord],
    ])(
      '%s: %s no puede leer ni escribir: 404 "La conversación no existe."',
      async (_id, _quien, who) => {
        const id = await fresh();
        await send(id, tenant, { contenido: 'Privado' }).expect(201);

        const reading = await read(id, who()).expect(404);
        const writing = await send(id, who(), {
          contenido: 'Me meto',
        }).expect(404);

        expect(reading.body.message).toBe('La conversación no existe.');
        expect(writing.body.message).toBe('La conversación no existe.');
        expect(await messagesIn(id)).toBe(1);
      },
    );

    it('M19: otro arrendatario en la misma publicación tiene su propia conversación, sin los mensajes ajenos', async () => {
      const id = await fresh();
      await send(id, tenant, { contenido: 'Pregunta mía' }).expect(201);
      await prisma.conversation.deleteMany({
        where: { listingId, tenantId: otherTenant.userId },
      });

      const { body: own } = await open(otherTenant).expect(201);
      const { body: page } = await read(own.id, otherTenant).expect(200);

      expect(own.id).not.toBe(id);
      expect(page.items).toEqual([]);
    });

    it('M20: una conversación inexistente es 404 y un id que no es UUID es 400', async () => {
      await read(randomUUID(), tenant).expect(404);
      await read('no-es-uuid', tenant).expect(400);
    });

    it('M21: sin sesión no se lee ni se escribe (401)', async () => {
      const id = await fresh();

      await http().get(`/api/v1/conversaciones/${id}/mensajes`).expect(401);
      await http()
        .post(`/api/v1/conversaciones/${id}/mensajes`)
        .send({ contenido: 'Hola' })
        .expect(401);
    });
  });
});
