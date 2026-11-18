import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import type { AvailabilityBlock } from '@PrismaClient';
import { BlockOverlapsReservationError } from '@Availability/errors';

export interface CreateBlockData {
  listingId: string;
  createdById: string;
  startAt: Date;
  endAt: Date;
  reason: string | null;
}

/** Único punto del módulo que escribe en `availability_blocks`. */
@Injectable()
export class BlockRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Dueño de la publicación, activa o no; null si no existe. */
  async findListingOwner(listingId: string): Promise<string | null> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { landlordId: true },
    });
    return listing?.landlordId ?? null;
  }

  /**
   * Crea el bloqueo si el rango no se cruza con una reserva CONFIRMADA o
   * EN_CURSO. Usa el mismo bloqueo de fila que la aprobación de BE-04.1
   * (`SELECT ... FOR UPDATE` de la publicación): así un bloqueo y una
   * aprobación del mismo bien quedan en fila y no pueden dejar a la vez una
   * reserva confirmada y un bloqueo encima. Ver DB-04.1 en
   * docs/modulos/reservas.md.
   *
   * Las solicitudes PENDIENTE no se tocan (BE-14.1): si después se intenta
   * aprobar una que choca con el bloqueo, BE-04.1 responde 409.
   *
   * @throws {BlockOverlapsReservationError} si el rango está ocupado. En ese
   *   caso no se crea nada.
   */
  create(data: CreateBlockData): Promise<AvailabilityBlock> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "listings"
        WHERE "id" = ${data.listingId}::uuid FOR UPDATE`;

      // Dos períodos se cruzan si cada uno empieza antes de que termine el
      // otro. Tocar el borde no cuenta.
      const taken = await tx.reservation.findFirst({
        where: {
          listingId: data.listingId,
          status: { in: ['CONFIRMADA', 'EN_CURSO'] },
          startAt: { lt: data.endAt },
          endAt: { gt: data.startAt },
        },
        select: { id: true },
      });
      if (taken) throw new BlockOverlapsReservationError();

      return tx.availabilityBlock.create({ data });
    });
  }

  /** Bloqueos de la publicación, del más próximo al más lejano. */
  findByListing(listingId: string): Promise<AvailabilityBlock[]> {
    return this.prisma.availabilityBlock.findMany({
      where: { listingId },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
  }
}
