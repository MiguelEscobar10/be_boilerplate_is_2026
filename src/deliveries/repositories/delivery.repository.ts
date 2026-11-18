import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { DeliveryConflictError } from '@Deliveries/errors';
import {
  Prisma,
  type Delivery,
  type DeliveryPhoto,
  type ReservationStatus,
} from '@PrismaClient';

/** Código de Prisma para violación de restricción única. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Lo que el servicio necesita saber de la reserva antes de entregarla. */
export interface ReservationForDelivery {
  id: string;
  status: ReservationStatus;
  startAt: Date;
  tenantId: string;
  landlordId: string;
  hasDelivery: boolean;
}

export type DeliveryWithPhotos = Delivery & { photos: DeliveryPhoto[] };

export interface CreateDeliveryData {
  reservationId: string;
  registeredById: string;
  initialConditionNote: string;
  /** Rutas de las fotos ya guardadas, en orden. */
  photoPaths: string[];
}

/** Único punto del módulo que habla con `deliveries` y `delivery_photos`. */
@Injectable()
export class DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReservation(id: string): Promise<ReservationForDelivery | null> {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        startAt: true,
        tenantId: true,
        listing: { select: { landlordId: true } },
        delivery: { select: { id: true } },
      },
    });
    if (!reservation) return null;
    return {
      id: reservation.id,
      status: reservation.status,
      startAt: reservation.startAt,
      tenantId: reservation.tenantId,
      landlordId: reservation.listing.landlordId,
      hasDelivery: reservation.delivery !== null,
    };
  }

  /**
   * Registra la entrega con sus fotos y pasa la reserva a EN_CURSO, todo en
   * una transacción.
   *
   * Bloquea la fila de la reserva (`SELECT ... FOR UPDATE`) y vuelve a revisar
   * el estado dentro de la transacción: si otra petición la entregó o le
   * cambió el estado entre la lectura y este punto, no se registra nada.
   *
   * @throws {DeliveryConflictError} si ya no está CONFIRMADA o ya tiene
   *   entrega (también si el UNIQUE de `reservation_id` frena a la segunda).
   */
  async createAndStart({
    reservationId,
    registeredById,
    initialConditionNote,
    photoPaths,
  }: CreateDeliveryData): Promise<Delivery> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: ReservationStatus }[]>`
          SELECT "status" FROM "reservations"
          WHERE "id" = ${reservationId}::uuid
          FOR UPDATE`;
        if (!locked || locked.status !== 'CONFIRMADA') {
          throw new DeliveryConflictError('NO_CONFIRMADA');
        }

        const delivery = await tx.delivery.create({
          data: {
            reservationId,
            registeredById,
            initialConditionNote,
            photos: {
              create: photoPaths.map((path, position) => ({ path, position })),
            },
          },
        });
        await tx.reservation.update({
          where: { id: reservationId },
          data: { status: 'EN_CURSO' },
        });
        return delivery;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new DeliveryConflictError('YA_ENTREGADA');
      }
      throw error;
    }
  }

  findByReservation(reservationId: string): Promise<DeliveryWithPhotos | null> {
    return this.prisma.delivery.findUnique({
      where: { reservationId },
      include: { photos: { orderBy: { position: 'asc' } } },
    });
  }
}
