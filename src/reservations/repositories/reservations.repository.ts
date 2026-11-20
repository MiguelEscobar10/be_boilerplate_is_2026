import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import type { Prisma, RateUnit, ReservationStatus } from '@PrismaClient';

/** Estados que ocupan fechas (sección 2.3 del documento de historias). */
const OCUPAN_FECHAS: ReservationStatus[] = ['CONFIRMADA', 'EN_CURSO'];

/** Lo que hace falta de la publicación para solicitarla y avisar. */
export interface ListingForRequest {
  id: string;
  name: string;
  landlordId: string;
  isActive: boolean;
  rateAmount: Prisma.Decimal;
  rateUnit: RateUnit;
  depositAmount: Prisma.Decimal;
}

/** Reserva con lo necesario para mostrarla y decidir quién la puede ver. */
export interface ReservationDetail {
  id: string;
  status: ReservationStatus;
  tenantId: string;
  startAt: Date;
  endAt: Date;
  rentalCost: { toFixed(digits: number): string };
  depositAmount: { toFixed(digits: number): string };
  createdAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
  listing: { id: string; name: string; landlordId: string };
}

export interface NewReservation {
  listingId: string;
  tenantId: string;
  startAt: Date;
  endAt: Date;
  rentalCost: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
}

const DETAIL_SELECT = {
  id: true,
  status: true,
  tenantId: true,
  startAt: true,
  endAt: true,
  rentalCost: true,
  depositAmount: true,
  createdAt: true,
  decidedAt: true,
  rejectionReason: true,
  listing: { select: { id: true, name: true, landlordId: true } },
} as const;

/** Único punto del módulo que habla con `reservations` para solicitar y consultar. */
@Injectable()
export class ReservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findListing(id: string): Promise<ListingForRequest | null> {
    return this.prisma.listing.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        landlordId: true,
        isActive: true,
        rateAmount: true,
        rateUnit: true,
        depositAmount: true,
      },
    });
  }

  /**
   * ¿El período choca con una reserva CONFIRMADA o EN_CURSO o con un bloqueo
   * del arrendador? Dos períodos se cruzan si cada uno empieza antes de que
   * termine el otro: tocar el borde no cuenta. Una solicitud PENDIENTE no
   * aparta fechas, así que no cuenta.
   */
  async hasConflict(
    listingId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<boolean> {
    const overlaps = {
      listingId,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    };
    const [reservation, block] = await Promise.all([
      this.prisma.reservation.findFirst({
        where: { ...overlaps, status: { in: OCUPAN_FECHAS } },
        select: { id: true },
      }),
      this.prisma.availabilityBlock.findFirst({
        where: overlaps,
        select: { id: true },
      }),
    ]);
    return reservation !== null || block !== null;
  }

  /** Guarda la solicitud como PENDIENTE (el estado por defecto del modelo). */
  create(data: NewReservation): Promise<ReservationDetail> {
    return this.prisma.reservation.create({ data, select: DETAIL_SELECT });
  }

  findDetail(id: string): Promise<ReservationDetail | null> {
    return this.prisma.reservation.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
  }
}
