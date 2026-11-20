import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createTestPrismaClient } from './helpers/test-database.js';

/**
 * Prueba de restricciones de `returns` y `deposit_resolutions` (DB-09.1).
 *
 * Igual que las demás pruebas de restricciones: corre solo contra una base
 * local cuyo nombre termina en `_test`. Crea su propio arrendador,
 * arrendatario, publicación y reservas con un email único y al final borra
 * solo lo que creó.
 *
 * La base de pruebas debe tener las migraciones aplicadas:
 *   DATABASE_URL=<url de la base _test> npx prisma migrate deploy
 */
const prisma = createTestPrismaClient();

describe('devoluciones y garantía: restricciones (DB-09.1)', () => {
  const email = `db-09.1-${randomUUID()}@test.local`;
  let landlordId: string;
  let tenantId: string;
  let listingId: string;

  const START = new Date('2026-12-01T09:00:00Z');
  const END = new Date('2026-12-01T12:00:00Z');

  const newReservation = () =>
    prisma.reservation.create({
      data: {
        listingId,
        tenantId,
        startAt: START,
        endAt: END,
        status: 'EN_CURSO',
        rentalCost: '45.00',
        depositAmount: '20.00',
      },
    });

  const sinObservaciones = (reservationId: string) =>
    ({
      reservationId,
      returnedAt: END,
      finalState: 'SIN_OBSERVACIONES',
      registeredById: landlordId,
    }) as const;

  const conObservaciones = (reservationId: string, damages = 'Rayón lateral') =>
    ({
      reservationId,
      returnedAt: END,
      finalState: 'CON_OBSERVACIONES',
      damages,
      registeredById: landlordId,
    }) as const;

  const liberada = (reservationId: string) =>
    ({
      reservationId,
      originalDeposit: '20.00',
      retainedAmount: '0.00',
      releasedAmount: '20.00',
      status: 'LIBERADA',
    }) as const;

  const retenida = (reservationId: string) =>
    ({
      reservationId,
      originalDeposit: '20.00',
      retainedAmount: '5.00',
      releasedAmount: '15.00',
      status: 'RETENIDA',
      reason: 'Daño reportado',
    }) as const;

  beforeAll(async () => {
    const landlord = await prisma.user.create({
      data: {
        email: `landlord-${email}`,
        passwordHash: 'no-es-un-hash-real',
        role: 'ARRENDADOR',
      },
    });
    const tenant = await prisma.user.create({
      data: { email: `tenant-${email}`, passwordHash: 'no-es-un-hash-real' },
    });
    landlordId = landlord.id;
    tenantId = tenant.id;
    listingId = (
      await prisma.listing.create({
        data: {
          landlordId,
          type: 'EQUIPO',
          name: 'Taladro percutor',
          location: 'Antiguo Cuscatlán',
          rateAmount: '15.00',
          rateUnit: 'HORA',
        },
      })
    ).id;
  });

  afterAll(async () => {
    // Devoluciones y resoluciones van primero: su FK a la reserva es RESTRICT.
    const mine = { reservation: { tenant: { email: { endsWith: email } } } };
    await prisma.depositResolution.deleteMany({ where: mine });
    await prisma.return.deleteMany({ where: mine });
    await prisma.reservation.deleteMany({
      where: { tenant: { email: { endsWith: email } } },
    });
    await prisma.listing.deleteMany({
      where: { landlord: { email: { endsWith: email } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: email } } });
    await prisma.$disconnect();
  });

  describe('returns', () => {
    it('guarda la devolución con la fecha real, el estado final, los daños y quién la registró', async () => {
      const reservation = await newReservation();

      const saved = await prisma.return.create({
        data: { ...conObservaciones(reservation.id), observations: 'Sin caja' },
        include: { reservation: true, registeredBy: true },
      });

      expect(saved.returnedAt).toEqual(END);
      expect(saved.finalState).toBe('CON_OBSERVACIONES');
      expect(saved.damages).toBe('Rayón lateral');
      expect(saved.observations).toBe('Sin caja');
      expect(saved.reservation.id).toBe(reservation.id);
      expect(saved.registeredBy.id).toBe(landlordId);
    });

    it('una reserva tiene como máximo una devolución (UNIQUE reservation_id)', async () => {
      const reservation = await newReservation();
      await prisma.return.create({ data: sinObservaciones(reservation.id) });

      await expect(
        prisma.return.create({ data: conObservaciones(reservation.id) }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(
        await prisma.return.count({ where: { reservationId: reservation.id } }),
      ).toBe(1);
    });

    it('rechaza un estado final fuera del enum', async () => {
      const reservation = await newReservation();

      await expect(
        prisma.$executeRaw`
          INSERT INTO "returns" ("id", "reservation_id", "returned_at", "final_state", "registered_by")
          VALUES (${randomUUID()}::uuid, ${reservation.id}::uuid, now(), 'ROTO'::"ReturnFinalState", ${landlordId}::uuid)`,
      ).rejects.toThrow(/ReturnFinalState/);
    });

    it.each([
      ['sin daños', undefined],
      ['con daños vacíos', ''],
      ['con daños de solo espacios', ' \n\t '],
    ])('rechaza CON_OBSERVACIONES %s', async (_, damages) => {
      const reservation = await newReservation();

      await expect(
        prisma.return.create({
          data: { ...conObservaciones(reservation.id), damages },
        }),
      ).rejects.toThrow(/returns_damages_check/);
    });

    it('rechaza SIN_OBSERVACIONES con daños anotados', async () => {
      const reservation = await newReservation();

      await expect(
        prisma.return.create({
          data: { ...sinObservaciones(reservation.id), damages: 'Rayón' },
        }),
      ).rejects.toThrow(/returns_damages_check/);
    });

    it('rechaza una nota general de solo espacios y unos daños de 501 caracteres', async () => {
      await expect(
        prisma.return.create({
          data: {
            ...sinObservaciones((await newReservation()).id),
            observations: '   ',
          },
        }),
      ).rejects.toThrow(/returns_observations_check/);

      await expect(
        prisma.return.create({
          data: conObservaciones((await newReservation()).id, 'a'.repeat(501)),
        }),
      ).rejects.toMatchObject({ code: 'P2000' });
    });

    it('rechaza una reserva o un usuario que no existen (FK)', async () => {
      await expect(
        prisma.return.create({ data: sinObservaciones(randomUUID()) }),
      ).rejects.toMatchObject({ code: 'P2003' });

      const reservation = await newReservation();
      await expect(
        prisma.return.create({
          data: {
            ...sinObservaciones(reservation.id),
            registeredById: randomUUID(),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('no deja borrar una reserva que tiene devolución (RESTRICT)', async () => {
      const reservation = await newReservation();
      await prisma.return.create({ data: sinObservaciones(reservation.id) });

      await expect(
        prisma.reservation.delete({ where: { id: reservation.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  describe('deposit_resolutions', () => {
    it('guarda una garantía LIBERADA completa, sin motivo', async () => {
      const reservation = await newReservation();

      const saved = await prisma.depositResolution.create({
        data: liberada(reservation.id),
      });

      expect(saved.releasedAmount.toFixed(2)).toBe('20.00');
      expect(saved.retainedAmount.toFixed(2)).toBe('0.00');
      expect(saved.status).toBe('LIBERADA');
      expect(saved.reason).toBeNull();
      expect(saved.resolvedAt).toBeInstanceOf(Date);
    });

    it('guarda una garantía RETENIDA y conserva el motivo', async () => {
      const reservation = await newReservation();

      const saved = await prisma.depositResolution.create({
        data: retenida(reservation.id),
      });

      expect(saved.retainedAmount.toFixed(2)).toBe('5.00');
      expect(saved.releasedAmount.toFixed(2)).toBe('15.00');
      expect(saved.status).toBe('RETENIDA');
      expect(saved.reason).toBe('Daño reportado');
    });

    it('acepta retener el depósito completo y una reserva sin garantía (todo en 0)', async () => {
      const completa = await prisma.depositResolution.create({
        data: {
          ...retenida((await newReservation()).id),
          retainedAmount: '20.00',
          releasedAmount: '0.00',
        },
      });
      expect(completa.status).toBe('RETENIDA');

      const sinGarantia = await prisma.depositResolution.create({
        data: {
          ...liberada((await newReservation()).id),
          originalDeposit: '0.00',
          releasedAmount: '0.00',
        },
      });
      expect(sinGarantia.status).toBe('LIBERADA');
    });

    it('una reserva tiene como máximo una resolución (UNIQUE reservation_id)', async () => {
      const reservation = await newReservation();
      await prisma.depositResolution.create({ data: liberada(reservation.id) });

      await expect(
        prisma.depositResolution.create({ data: retenida(reservation.id) }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it.each([
      [
        'un monto retenido mayor que el depósito',
        { retainedAmount: '25.00', releasedAmount: '0.00' },
        /deposit_resolutions_retained_within_deposit_check|deposit_resolutions_amounts_match_deposit_check/,
      ],
      [
        'un monto retenido negativo',
        { retainedAmount: '-5.00', releasedAmount: '25.00' },
        /deposit_resolutions_retained_amount_check/,
      ],
      [
        'un monto liberado negativo',
        { retainedAmount: '25.00', releasedAmount: '-5.00' },
        /deposit_resolutions_released_amount_check|deposit_resolutions_retained_within_deposit_check/,
      ],
      [
        'partes que no suman el depósito',
        { retainedAmount: '5.00', releasedAmount: '10.00' },
        /deposit_resolutions_amounts_match_deposit_check/,
      ],
    ])('rechaza %s', async (_, amounts, constraint) => {
      const reservation = await newReservation();

      await expect(
        prisma.depositResolution.create({
          data: { ...retenida(reservation.id), ...amounts },
        }),
      ).rejects.toThrow(constraint);
    });

    it('rechaza un depósito original negativo', async () => {
      const reservation = await newReservation();

      await expect(
        prisma.depositResolution.create({
          data: {
            ...liberada(reservation.id),
            originalDeposit: '-1.00',
            releasedAmount: '-1.00',
          },
        }),
      ).rejects.toThrow(/deposit_resolutions_/);
    });

    it.each([
      ['LIBERADA con monto retenido', { status: 'LIBERADA' }],
      [
        'RETENIDA sin monto retenido',
        { retainedAmount: '0.00', releasedAmount: '20.00' },
      ],
    ] as const)('rechaza %s', async (_, changes) => {
      const reservation = await newReservation();

      await expect(
        prisma.depositResolution.create({
          data: { ...retenida(reservation.id), ...changes },
        }),
      ).rejects.toThrow(/deposit_resolutions_status_check/);
    });

    it.each([
      ['sin motivo', null],
      ['con un motivo vacío', ''],
      ['con un motivo de solo espacios', '   '],
    ])('rechaza una retención %s', async (_, reason) => {
      const reservation = await newReservation();

      await expect(
        prisma.depositResolution.create({
          data: { ...retenida(reservation.id), reason },
        }),
      ).rejects.toThrow(/deposit_resolutions_reason_check/);
    });

    it('no deja borrar una reserva que tiene resolución (RESTRICT)', async () => {
      const reservation = await newReservation();
      await prisma.depositResolution.create({ data: liberada(reservation.id) });

      await expect(
        prisma.reservation.delete({ where: { id: reservation.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
