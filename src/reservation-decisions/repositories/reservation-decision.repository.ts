import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import type { Reservation, ReservationStatus } from '@PrismaClient';
import { DecisionConflictError } from '@ReservationDecisions/errors';

/** Estados que ocupan fechas (sección 2.3 del documento de historias). */
const OCUPAN_FECHAS: ReservationStatus[] = ['CONFIRMADA', 'EN_CURSO'];

/** Lo que el servicio necesita de una reserva para decidir y avisar. */
export interface ReservationForDecision {
  id: string;
  status: ReservationStatus;
  tenantId: string;
  startAt: Date;
  endAt: Date;
  listing: { id: string; landlordId: string; name: string };
}

/** Fila del panel "Mis solicitudes". */
export interface LandlordRequestRow {
  id: string;
  status: ReservationStatus;
  startAt: Date;
  endAt: Date;
  rentalCost: { toFixed(digits: number): string };
  depositAmount: { toFixed(digits: number): string };
  createdAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
  listing: { id: string; name: string };
  tenant: { id: string; email: string; profile: { name: string } | null };
}

export interface LandlordRequestsFilter {
  status?: ReservationStatus;
  page: number;
  limit: number;
}

/** Único punto del módulo que habla con `reservations` para decidir. */
@Injectable()
export class ReservationDecisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findForDecision(id: string): Promise<ReservationForDecision | null> {
    return this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tenantId: true,
        startAt: true,
        endAt: true,
        listing: { select: { id: true, landlordId: true, name: true } },
      },
    });
  }

  /**
   * Solicitudes de las publicaciones del arrendador, de la más reciente a la
   * más antigua. `id` desempata las que se crearon en el mismo instante para
   * que la paginación no repita ni salte filas.
   */
  async findPageForLandlord(
    landlordId: string,
    { status, page, limit }: LandlordRequestsFilter,
  ): Promise<{ items: LandlordRequestRow[]; total: number }> {
    const where = { listing: { landlordId }, ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          startAt: true,
          endAt: true,
          rentalCost: true,
          depositAmount: true,
          createdAt: true,
          decidedAt: true,
          rejectionReason: true,
          listing: { select: { id: true, name: true } },
          tenant: {
            select: {
              id: true,
              email: true,
              profile: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.reservation.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Aprueba una solicitud con la estrategia de DB-04.1 (ver
   * docs/modulos/reservas.md). Todo va en una transacción:
   *
   * 1. Bloquea la fila de la publicación. Dos aprobaciones del mismo bien
   *    quedan en fila: la segunda espera aquí hasta que termina la primera.
   * 2. Bloquea y vuelve a leer la reserva: tiene que seguir PENDIENTE.
   * 3. Busca reservas CONFIRMADA o EN_CURSO y bloqueos que se crucen.
   * 4. La pasa a CONFIRMADA con fecha y autor.
   *
   * Las demás solicitudes PENDIENTE que se cruzan no se tocan (H04, criterio 7).
   *
   * @throws {DecisionConflictError} si ya fue decidida o las fechas están
   *   ocupadas. En ese caso no cambia nada.
   */
  approve(
    reservation: Pick<ReservationForDecision, 'id' | 'listing'>,
    landlordId: string,
    decidedAt: Date,
  ): Promise<Reservation> {
    const listingId = reservation.listing.id;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "listings" WHERE "id" = ${listingId}::uuid FOR UPDATE`;

      // Bloquea también la fila de la reserva. Un rechazo no pasa por el
      // bloqueo de la publicación, así que sin esto podría colarse entre la
      // lectura de abajo y el UPDATE del final y la reserva quedaría decidida
      // dos veces. Con el bloqueo, ese rechazo espera y después ya no la
      // encuentra PENDIENTE.
      await tx.$queryRaw`
        SELECT "id" FROM "reservations"
        WHERE "id" = ${reservation.id}::uuid FOR UPDATE`;

      const current = await tx.reservation.findUnique({
        where: { id: reservation.id },
      });
      if (!current || current.status !== 'PENDIENTE') {
        throw new DecisionConflictError('YA_DECIDIDA');
      }

      // Dos períodos se cruzan si cada uno empieza antes de que termine el
      // otro. Tocar el borde no cuenta.
      const overlaps = {
        listingId,
        startAt: { lt: current.endAt },
        endAt: { gt: current.startAt },
      };
      const taken = await tx.reservation.findFirst({
        where: {
          ...overlaps,
          id: { not: current.id },
          status: { in: OCUPAN_FECHAS },
        },
        select: { id: true },
      });
      if (taken) throw new DecisionConflictError('RESERVA_TRASLAPADA');

      const blocked = await tx.availabilityBlock.findFirst({
        where: overlaps,
        select: { id: true },
      });
      if (blocked) throw new DecisionConflictError('FECHAS_BLOQUEADAS');

      return tx.reservation.update({
        where: { id: current.id },
        data: { status: 'CONFIRMADA', decidedAt, decidedById: landlordId },
      });
    });
  }

  /**
   * Rechaza una solicitud. No necesita bloquear la publicación porque un
   * rechazo no ocupa fechas: alcanza con que el UPDATE solo aplique si la
   * reserva sigue PENDIENTE, así no se decide dos veces.
   *
   * @throws {DecisionConflictError} si ya fue decidida.
   */
  async reject(
    reservationId: string,
    landlordId: string,
    rejectionReason: string | null,
    decidedAt: Date,
  ): Promise<Reservation> {
    const { count } = await this.prisma.reservation.updateMany({
      where: { id: reservationId, status: 'PENDIENTE' },
      data: {
        status: 'RECHAZADA',
        decidedAt,
        decidedById: landlordId,
        rejectionReason,
      },
    });
    if (count === 0) throw new DecisionConflictError('YA_DECIDIDA');

    return this.prisma.reservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
  }
}
