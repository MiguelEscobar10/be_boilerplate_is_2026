import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AvisosService } from '@Notifications';
import { VerificationRequirementService } from '@Verification/services';
import type { CreateReservationDto } from '@Reservations/dto';
import { ReservationDto } from '@Reservations/dto';
import {
  FechaPasadaException,
  PeriodoNoDisponibleException,
} from '@Reservations/errors';
import {
  ReservationsRepository,
  type ReservationDetail,
} from '@Reservations/repositories';
import { VerificacionRequeridaException } from '@Verification/errors';
import { costExceedsLimit, rentalCost } from './reservation-cost.js';
import { parseInstant } from './reservation-dates.js';
import { buildRequestNotice } from './reservation-notice.js';

/** Mismo texto para "no existe" y "no es tuya": no se revela si existe. */
const RESERVA_NO_EXISTE = 'La reserva no existe.';
const PUBLICACION_NO_ENCONTRADA = 'Publicación no encontrada.';

/** Solicitud y consulta de reservas (H03). */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly reservations: ReservationsRepository,
    private readonly requirement: VerificationRequirementService,
    private readonly avisos: AvisosService,
  ) {}

  /**
   * Registra una solicitud PENDIENTE para el período pedido y avisa al
   * arrendador. El costo y el depósito salen de la publicación, no del
   * cliente, y se guardan como fotografía del precio.
   *
   * @throws {BadRequestException} si una fecha no existe, `fin` no es
   *   posterior a `inicio` o el costo no cabe.
   * @throws {FechaPasadaException} 400 si el inicio ya pasó.
   * @throws {NotFoundException} si la publicación no existe o está inactiva.
   * @throws {VerificacionRequeridaException} 422 si la publicación exige
   *   verificación y el arrendatario no la tiene.
   * @throws {PeriodoNoDisponibleException} 409 si el período choca con una
   *   reserva CONFIRMADA o EN_CURSO o con un bloqueo.
   */
  async create(
    tenantId: string,
    { publicacionId, inicio, fin }: CreateReservationDto,
    now = new Date(),
  ): Promise<ReservationDto> {
    const startAt = parseInstant(inicio, 'inicio');
    const endAt = parseInstant(fin, 'fin');
    if (endAt <= startAt) {
      throw new BadRequestException(
        'La fecha fin debe ser posterior a la de inicio.',
      );
    }
    if (startAt < now) throw new FechaPasadaException();

    const listing = await this.reservations.findListing(publicacionId);
    if (!listing?.isActive) {
      throw new NotFoundException(PUBLICACION_NO_ENCONTRADA);
    }

    if (
      await this.requirement.exigeVerificacionYNoCumple(listing.id, tenantId)
    ) {
      throw new VerificacionRequeridaException();
    }

    if (await this.reservations.hasConflict(listing.id, startAt, endAt)) {
      throw new PeriodoNoDisponibleException();
    }

    const cost = rentalCost(
      listing.rateAmount,
      listing.rateUnit,
      startAt,
      endAt,
    );
    if (costExceedsLimit(cost)) {
      throw new BadRequestException('El período es demasiado largo.');
    }

    const created = await this.reservations.create({
      listingId: listing.id,
      tenantId,
      startAt,
      endAt,
      rentalCost: cost,
      depositAmount: listing.depositAmount,
    });
    await this.notify(created, listing.landlordId);
    return ReservationDto.fromRow(created);
  }

  /**
   * Detalle de una reserva para quien la pidió o para el dueño de la
   * publicación. Para cualquier otra persona es un 404, igual que si no
   * existiera.
   *
   * @throws {NotFoundException} si no existe o la persona no participa.
   */
  async findOne(id: string, userId: string): Promise<ReservationDto> {
    const reservation = await this.reservations.findDetail(id);
    if (
      !reservation ||
      (reservation.tenantId !== userId &&
        reservation.listing.landlordId !== userId)
    ) {
      throw new NotFoundException(RESERVA_NO_EXISTE);
    }
    return ReservationDto.fromRow(reservation);
  }

  /**
   * Avisa después de guardar, como pide el contrato del servicio de avisos. La
   * solicitud ya quedó guardada: si el aviso falla no se deshace, solo se
   * registra.
   */
  private async notify(
    reservation: ReservationDetail,
    landlordId: string,
  ): Promise<void> {
    try {
      await this.avisos.notificar(
        buildRequestNotice({
          id: reservation.id,
          landlordId,
          listingName: reservation.listing.name,
          startAt: reservation.startAt,
          endAt: reservation.endAt,
        }),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo avisar de la solicitud ${reservation.id}`,
        error as Error,
      );
    }
  }
}
