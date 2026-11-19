import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { DepositConflictError } from '@Returns/errors';
import {
  Prisma,
  type DepositResolution,
  type ReservationStatus,
  type ReturnFinalState,
} from '@PrismaClient';

/** Código de Prisma para violación de restricción única. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** La reserva con lo que hace falta para resolver o mostrar su garantía. */
export interface DepositState {
  id: string;
  status: ReservationStatus;
  tenantId: string;
  landlordId: string;
  listingName: string;
  depositAmount: Prisma.Decimal;
  /** Estado final de la devolución; null si todavía no se registró. */
  returnFinalState: ReturnFinalState | null;
  resolution: DepositResolution | null;
}

export interface ResolveDepositData {
  reservationId: string;
  originalDeposit: Prisma.Decimal;
  retainedAmount: Prisma.Decimal;
  releasedAmount: Prisma.Decimal;
  reason: string | null;
}

/** Único punto del módulo que habla con `deposit_resolutions`. */
@Injectable()
export class DepositResolutionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findState(reservationId: string): Promise<DepositState | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        tenantId: true,
        depositAmount: true,
        listing: { select: { landlordId: true, name: true } },
        returnRecord: { select: { finalState: true } },
        depositResolution: true,
      },
    });
    if (!reservation) return null;
    return {
      id: reservation.id,
      status: reservation.status,
      tenantId: reservation.tenantId,
      landlordId: reservation.listing.landlordId,
      listingName: reservation.listing.name,
      depositAmount: reservation.depositAmount,
      returnFinalState: reservation.returnRecord?.finalState ?? null,
      resolution: reservation.depositResolution,
    };
  }

  /**
   * Guarda la resolución y pasa la reserva a COMPLETADA, todo en una
   * transacción.
   *
   * Bloquea la fila de la reserva (`SELECT ... FOR UPDATE`) y vuelve a revisar
   * el estado: si otra petición la cerró entre la lectura y este punto, no se
   * guarda nada.
   *
   * @throws {DepositConflictError} si ya no está EN_CURSO o ya tiene
   *   resolución (también si el UNIQUE de `reservation_id` frena a la segunda).
   */
  async resolveAndComplete(
    data: ResolveDepositData,
  ): Promise<DepositResolution> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: ReservationStatus }[]>`
          SELECT "status" FROM "reservations"
          WHERE "id" = ${data.reservationId}::uuid
          FOR UPDATE`;
        if (!locked || locked.status !== 'EN_CURSO') {
          throw new DepositConflictError('NO_EN_CURSO');
        }

        const resolution = await tx.depositResolution.create({
          data: {
            ...data,
            status: data.retainedAmount.isZero() ? 'LIBERADA' : 'RETENIDA',
          },
        });
        await tx.reservation.update({
          where: { id: data.reservationId },
          data: { status: 'COMPLETADA' },
        });
        return resolution;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new DepositConflictError('YA_RESUELTA');
      }
      throw error;
    }
  }
}
