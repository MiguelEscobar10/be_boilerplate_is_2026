import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { resolveTestDatabaseUrl } from './helpers/test-database.js';

/**
 * Conversaciones y mensajes antes de reservar (BE-15.1).
 *
 * Levanta la app completa contra la base de pruebas y borra al final solo lo
 * que creó.
 */
describe('mensajería (BE-15.1)', () => {
  const suffix = `be-15.1-${randomUUID()}@test.local`;
  const password = 'Str0ngPass';
  let app: INestApplication<App>;
  let prisma: import('../src/prisma/services/prisma.service.js').PrismaService;
  let listingId: string;
  const tokens: Record<'landlord' | 'tenant' | 'other', string> = {
    landlord: '',
    tenant: '',
    other: '',
  };
  const ids: Record<'landlord' | 'tenant' | 'other', string> = {
    landlord: '',
    tenant: '',
    other: '',
  };

  const http = () => request(app.getHttpServer());
  const as = (who: keyof typeof tokens) => ({
    Authorization: `Bearer ${tokens[who]}`,
  });

  async function createAccount(
    who: keyof typeof tokens,
    rol: 'ARRENDADOR' | 'ARRENDATARIO',
  ) {
    const email = `${who}-${suffix}`;
    const { body } = await http()
      .post('/api/v1/users')
      .send({ email, password, rol, nombre: who, telefono: '70001234' })
      .expect(201);
    ids[who] = body.id;
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    tokens[who] = login.body.accessToken;
  }

  const open = (who: keyof typeof tokens = 'tenant', listing = listingId) =>
    http().post(`/api/v1/publicaciones/${listing}/conversaciones`).set(as(who));

  const send = (
    conversationId: string,
    contenido: unknown,
    who: keyof typeof tokens = 'tenant',
  ) =>
    http()
      .post(`/api/v1/conversaciones/${conversationId}/mensajes`)
      .set(as(who))
      .send({ contenido });

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

    const listing = await prisma.listing.create({
      data: {
        landlordId: ids.landlord,
        type: 'EQUIPO',
        name: 'Taladro percutor',
        location: 'Antiguo Cuscatlán',
        rateAmount: '15.00',
        rateUnit: 'DIA',
      },
    });
    listingId = listing.id;
  }, 60_000);

  afterAll(async () => {
    const users = { email: { endsWith: suffix } };
    await prisma.notification.deleteMany({ where: { user: users } });
    await prisma.conversation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: users });
    await app.close();
  });

  it('abre la conversación (201) y la reutiliza la segunda vez (200)', async () => {
    const first = await open().expect(201);
    const second = await open().expect(200);

    expect(second.body.id).toBe(first.body.id);
  });

  it('guarda un mensaje (201), aparece en el historial y avisa al arrendador sin el texto', async () => {
    const { body: conversation } = await open();
    const { body: message } = await send(
      conversation.id,
      '  ¿Incluye las brocas?  ',
    ).expect(201);
    await send(conversation.id, 'Sí, vienen 5.', 'landlord').expect(201);

    const history = await http()
      .get(`/api/v1/conversaciones/${conversation.id}/mensajes`)
      .set(as('tenant'))
      .expect(200);
    expect(
      history.body.items.map((m: { contenido: string }) => m.contenido),
    ).toEqual(['¿Incluye las brocas?', 'Sí, vienen 5.']);
    expect(history.body).toMatchObject({ page: 1, limit: 50, total: 2 });

    const aviso = await prisma.notification.findFirst({
      where: { userId: ids.landlord, referenceId: message.id },
    });
    expect(aviso).toMatchObject({
      sourceModule: 'MENSAJERIA',
      title: 'Mensaje nuevo',
      referenceType: 'mensaje',
    });
    expect(aviso?.message).toContain('Taladro percutor');
    expect(aviso?.message).not.toContain('brocas');
  });

  it('pagina el historial', async () => {
    const { body: conversation } = await open();
    const page = await http()
      .get(`/api/v1/conversaciones/${conversation.id}/mensajes?page=2&limit=1`)
      .set(as('tenant'))
      .expect(200);

    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].contenido).toBe('Sí, vienen 5.');
  });

  it.each([
    ['vacío', ''],
    ['de solo espacios', '    '],
    ['de 1001 caracteres', 'a'.repeat(1001)],
    ['que no es texto', 42],
  ])(
    'rechaza con 400 un mensaje %s y no lo guarda',
    async (_case, contenido) => {
      const { body: conversation } = await open();
      const before = await prisma.message.count({
        where: { conversationId: conversation.id },
      });

      await send(conversation.id, contenido).expect(400);

      expect(
        await prisma.message.count({
          where: { conversationId: conversation.id },
        }),
      ).toBe(before);
    },
  );

  it('acepta un mensaje de exactamente 1000 caracteres', async () => {
    const { body: conversation } = await open();
    await send(conversation.id, 'a'.repeat(1000)).expect(201);
  });

  it('responde 404 a quien no participa, al leer y al escribir', async () => {
    const { body: conversation } = await open();

    await http()
      .get(`/api/v1/conversaciones/${conversation.id}/mensajes`)
      .set(as('other'))
      .expect(404);
    await send(conversation.id, 'Hola', 'other').expect(404);
  });

  it('responde 404 si la conversación o la publicación no existen', async () => {
    await send(randomUUID(), 'Hola').expect(404);
    await open('tenant', randomUUID()).expect(404);
  });

  it('responde 404 si la publicación está desactivada', async () => {
    const inactive = await prisma.listing.create({
      data: {
        landlordId: ids.landlord,
        type: 'ESPACIO',
        name: 'Bodega',
        location: 'Santa Tecla',
        rateAmount: '30.00',
        rateUnit: 'SEMANA',
        isActive: false,
      },
    });
    try {
      await open('tenant', inactive.id).expect(404);
    } finally {
      await prisma.listing.delete({ where: { id: inactive.id } });
    }
  });

  it('responde 403 si un arrendador intenta abrir una conversación', async () => {
    await open('landlord').expect(403);
  });

  it('responde 401 sin sesión', async () => {
    await http()
      .post(`/api/v1/publicaciones/${listingId}/conversaciones`)
      .expect(401);
  });
});
