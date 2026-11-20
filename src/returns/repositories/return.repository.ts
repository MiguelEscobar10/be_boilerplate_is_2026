import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { ReturnConflictError } from '@Returns/errors';
import {
  Prisma,
  type ReservationStatus,
  type Return,
  type ReturnFinalState,
} from '@PrismaClient';

/** Código de Prisma para violación de restricción única. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Lo que el servicio necesita saber de la reserva antes de devolverla. */
export interface ReservationForReturn {
  id: string;
  status: ReservationStatus;
  tenantId: string;
  landlordId: string;
  /** Fecha real de la entrega; null si la reserva no se entregó. */
  deliveredAt: Date | null;
  hasReturn: boolean;
}

export interface CreateReturnData {
  reservationId: string;
  registeredById: string;
  returnedAt: Date;
  finalState: ReturnFinalState;
  damages: string | null;
}

/** Único punto del módulo que habla con `returns`. */
@Injectable()
export class ReturnRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReservation(id: string): Promise<ReservationForReturn | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        tenantId: true,
        listing: { select: { landlordId: true } },
        delivery: { select: { deliveredAt: true } },
        returnRecord: { select: { id: true } },
      },
    });
    if (!reservation) return null;
    return {
      id: reservation.id,
      status: reservation.status,
      tenantId: reservation.tenantId,
      landlordId: reservation.listing.landlordId,
      deliveredAt: reservation.delivery?.deliveredAt ?? null,
      hasReturn: reservation.returnRecord !== null,
    };
  }

  /**
   * Registra la devolución en una transacción.
   *
   * Bloquea la fila de la reserva (`SELECT ... FOR UPDATE`) y vuelve a revisar
   * el estado: si otra petición la cerró entre la lectura y este punto, no se
   * registra nada. La reserva sigue EN_CURSO hasta que se resuelva la
   * garantía (BE-09.2).
   *
   * @throws {ReturnConflictError} si ya no está EN_CURSO o ya tiene
   *   devolución (también si el UNIQUE de `reservation_id` frena a la segunda).
   */
  async create(data: CreateReturnData): Promise<Return> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: ReservationStatus }[]>`
          SELECT "status" FROM "reservations"
          WHERE "id" = ${data.reservationId}::uuid
          FOR UPDATE`;
        if (!locked || locked.status !== 'EN_CURSO') {
          throw new ReturnConflictError('NO_EN_CURSO');
        }
        return tx.return.create({ data });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ReturnConflictError('YA_DEVUELTA');
      }
      throw error;
    }
  }

  findByReservation(reservationId: string): Promise<Return | null> {
    return this.prisma.return.findUnique({ where: { reservationId } });
  }
}
