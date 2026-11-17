import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de restricciones de `conversations` y `messages` (DB-15.1).
 *
 * Misma regla que las demás pruebas de base: solo corre contra una base local
 * cuyo nombre termina en `_test`, y al final borra solo lo que creó.
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error('Definí TEST_DATABASE_URL o DATABASE_URL.');
  }

  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;

  const dbName = url.pathname.slice(1);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(
      `La base de pruebas debe ser local (host: ${url.hostname}).`,
    );
  }
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `La base de pruebas debe terminar en _test (es ${dbName}).`,
    );
  }
  return url.toString();
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveTestDatabaseUrl() }),
});

describe('mensajería: restricciones (DB-15.1)', () => {
  const suffix = `db-15.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;

  const newUser = (name: string) =>
    prisma.user.create({
      data: { email: `${name}-${suffix}`, passwordHash: 'no-es-un-hash-real' },
    });

  const newConversation = (
    data: { reservationId?: string; tenantId?: string } = {},
  ) =>
    prisma.conversation.create({
      data: {
        listingId,
        landlordId,
        tenantId: data.tenantId ?? tenantId,
        reservationId: data.reservationId,
      },
    });

  beforeAll(async () => {
    landlordId = (await newUser('arrendador')).id;
    tenantId = (await newUser('arrendatario')).id;
    const listing = await prisma.listing.create({
      data: {
        landlordId,
        type: 'EQUIPO',
        name: 'Proyector',
        location: 'San Salvador',
        rateAmount: '20.00',
        rateUnit: 'DIA',
      },
    });
    listingId = listing.id;
  });

  afterAll(async () => {
    // Orden por las FK RESTRICT: conversaciones (y sus mensajes), reservas,
    // publicación, usuarios.
    await prisma.conversation.deleteMany({ where: { listingId } });
    await prisma.reservation.deleteMany({ where: { listingId } });
    await prisma.listing.deleteMany({ where: { id: listingId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({ where: { listingId } });
  });

  it('guarda una conversación con sus mensajes en orden', async () => {
    const conversation = await newConversation();
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        authorId: tenantId,
        content: '¿Incluye el cable HDMI?',
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        authorId: landlordId,
        content: 'Sí, y el control.',
      },
    });

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(history.map((m) => m.authorId)).toEqual([tenantId, landlordId]);
    expect(conversation.reservationId).toBeNull();
  });

  it('no permite dos conversaciones previas a la reserva entre las mismas personas', async () => {
    await newConversation();

    await expect(newConversation()).rejects.toMatchObject({ code: 'P2002' });
  });

  it('otro arrendatario sí puede abrir su propia conversación sobre la misma publicación', async () => {
    const other = await newUser(`otro-${randomUUID()}`);
    await newConversation();

    await expect(
      newConversation({ tenantId: other.id }),
    ).resolves.toBeDefined();
  });

  it('las conversaciones de reserva no chocan con la previa', async () => {
    // Desde DB-16.1 reservation_id tiene FK, así que hace falta una reserva real.
    const reservation = await prisma.reservation.create({
      data: {
        listingId,
        tenantId,
        startAt: new Date('2026-12-01T15:00:00.000Z'),
        endAt: new Date('2026-12-02T15:00:00.000Z'),
        status: 'CONFIRMADA',
        rentalCost: '20.00',
        depositAmount: '0.00',
      },
    });
    await newConversation();

    await expect(
      newConversation({ reservationId: reservation.id }),
    ).resolves.toBeDefined();
  });

  it('rechaza una conversación del arrendador consigo mismo', async () => {
    await expect(newConversation({ tenantId: landlordId })).rejects.toThrow(
      /conversations_distinct_participants_check/,
    );
  });

  it('rechaza una publicación que no existe (FK)', async () => {
    await expect(
      prisma.conversation.create({
        data: { listingId: randomUUID(), tenantId, landlordId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it.each([
    ['vacío', ''],
    ['de solo espacios', '   '],
  ])('rechaza un mensaje %s', async (_case, content) => {
    const conversation = await newConversation();

    await expect(
      prisma.message.create({
        data: { conversationId: conversation.id, authorId: tenantId, content },
      }),
    ).rejects.toThrow(/messages_content_not_blank_check/);
  });

  it('acepta 1000 caracteres y rechaza 1001', async () => {
    const conversation = await newConversation();
    const base = { conversationId: conversation.id, authorId: tenantId };

    await expect(
      prisma.message.create({ data: { ...base, content: 'a'.repeat(1000) } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.message.create({ data: { ...base, content: 'a'.repeat(1001) } }),
    ).rejects.toMatchObject({ code: 'P2000' });
  });

  it('borra los mensajes al borrar la conversación (ON DELETE CASCADE)', async () => {
    const conversation = await newConversation();
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        authorId: tenantId,
        content: 'Hola',
      },
    });

    await prisma.conversation.delete({ where: { id: conversation.id } });

    expect(
      await prisma.message.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(0);
  });

  it('no deja borrar una publicación que tiene conversaciones (RESTRICT)', async () => {
    await newConversation();

    await expect(
      prisma.listing.delete({ where: { id: listingId } }),
    ).rejects.toMatchObject({
      code: 'P2003',
    });
  });
});
