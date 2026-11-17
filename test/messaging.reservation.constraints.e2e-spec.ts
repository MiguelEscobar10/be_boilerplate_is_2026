import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@PrismaClient';

/**
 * Prueba de restricciones de la conversación de una reserva (DB-16.1).
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

const START = new Date('2026-12-01T15:00:00.000Z');
const END = new Date('2026-12-03T15:00:00.000Z');

describe('mensajería: conversación de la reserva (DB-16.1)', () => {
  const suffix = `db-16.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let otherTenantId: string;
  let otherLandlordId: string;
  let listingId: string;
  let otherListingId: string;
  let reservationId: string;

  const newUser = (name: string) =>
    prisma.user.create({
      data: { email: `${name}-${suffix}`, passwordHash: 'no-es-un-hash-real' },
    });

  const newListing = (ownerId: string) =>
    prisma.listing.create({
      data: {
        landlordId: ownerId,
        type: 'EQUIPO',
        name: 'Proyector',
        location: 'San Salvador',
        rateAmount: '20.00',
        rateUnit: 'DIA',
      },
    });

  const newReservation = async (
    data: { listingId?: string; tenantId?: string } = {},
  ) =>
    (
      await prisma.reservation.create({
        data: {
          listingId: data.listingId ?? listingId,
          tenantId: data.tenantId ?? tenantId,
          startAt: START,
          endAt: END,
          status: 'CONFIRMADA',
          rentalCost: '40.00',
          depositAmount: '10.00',
        },
      })
    ).id;

  const reservationConversation = (
    data: Partial<{
      reservationId: string | null;
      listingId: string;
      tenantId: string;
      landlordId: string;
    }> = {},
  ) =>
    prisma.conversation.create({
      data: {
        reservationId:
          data.reservationId === undefined ? reservationId : data.reservationId,
        listingId: data.listingId ?? listingId,
        tenantId: data.tenantId ?? tenantId,
        landlordId: data.landlordId ?? landlordId,
      },
    });

  beforeAll(async () => {
    landlordId = (await newUser('arrendador')).id;
    tenantId = (await newUser('arrendatario')).id;
    otherTenantId = (await newUser('otro-arrendatario')).id;
    otherLandlordId = (await newUser('otro-arrendador')).id;
    listingId = (await newListing(landlordId)).id;
    otherListingId = (await newListing(landlordId)).id;
    reservationId = await newReservation();
  });

  afterAll(async () => {
    // Orden por las FK RESTRICT: conversaciones, reservas, publicaciones, usuarios.
    const listings = { listingId: { in: [listingId, otherListingId] } };
    await prisma.conversation.deleteMany({ where: listings });
    await prisma.reservation.deleteMany({ where: listings });
    await prisma.listing.deleteMany({
      where: { id: { in: [listingId, otherListingId] } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: suffix } } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.conversation.deleteMany({
      where: { listingId: { in: [listingId, otherListingId] } },
    });
  });

  it('guarda la conversación de la reserva y la relaciona con la reserva y las dos personas', async () => {
    const conversation = await reservationConversation();

    const found = await prisma.conversation.findUniqueOrThrow({
      where: { reservationId },
      include: { reservation: { include: { listing: true } } },
    });
    expect(found.id).toBe(conversation.id);
    expect(found.reservation?.tenantId).toBe(found.tenantId);
    expect(found.reservation?.listing.landlordId).toBe(found.landlordId);

    const reservation = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      include: { conversation: true },
    });
    expect(reservation.conversation?.id).toBe(conversation.id);
  });

  it('una reserva tiene como máximo una conversación', async () => {
    await reservationConversation();

    await expect(reservationConversation()).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('cada reserva tiene la suya y conviven con la conversación previa', async () => {
    const second = await newReservation();

    await reservationConversation({ reservationId: null });
    await reservationConversation();
    await expect(
      reservationConversation({ reservationId: second }),
    ).resolves.toBeDefined();

    expect(
      await prisma.conversation.count({ where: { listingId, tenantId } }),
    ).toBe(3);
  });

  it('rechaza una reserva que no existe (FK)', async () => {
    await expect(
      reservationConversation({ reservationId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rechaza un arrendatario que no es el de la reserva', async () => {
    await expect(
      reservationConversation({ tenantId: otherTenantId }),
    ).rejects.toThrow(/conversations_reservation_participants_check/);
  });

  it('rechaza un arrendador que no es el dueño de la publicación', async () => {
    await expect(
      reservationConversation({ landlordId: otherLandlordId }),
    ).rejects.toThrow(/conversations_reservation_participants_check/);
  });

  it('rechaza una publicación que no es la de la reserva', async () => {
    await expect(
      reservationConversation({ listingId: otherListingId }),
    ).rejects.toThrow(/conversations_reservation_participants_check/);
  });

  it('también revisa al cambiar la reserva de una conversación', async () => {
    const ofOtherTenant = await newReservation({ tenantId: otherTenantId });
    const conversation = await reservationConversation();

    await expect(
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { reservationId: ofOtherTenant },
      }),
    ).rejects.toThrow(/conversations_reservation_participants_check/);
  });

  it('una conversación previa se puede asociar a la reserva de las mismas personas', async () => {
    const previous = await reservationConversation({ reservationId: null });

    const linked = await prisma.conversation.update({
      where: { id: previous.id },
      data: { reservationId },
    });
    expect(linked.reservationId).toBe(reservationId);
  });

  it('no deja borrar una reserva que tiene conversación (RESTRICT)', async () => {
    await reservationConversation();

    await expect(
      prisma.reservation.delete({ where: { id: reservationId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('el índice único es sobre reservation_id y no crea tablas nuevas', async () => {
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'conversations'
        AND indexname = 'conversations_reservation_id_key'`;
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toMatch(
      /CREATE UNIQUE INDEX .* \(reservation_id\)/,
    );

    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name ILIKE '%conversation%'`;
    expect(tables.map((t) => t.table_name)).toEqual(['conversations']);
  });
});
