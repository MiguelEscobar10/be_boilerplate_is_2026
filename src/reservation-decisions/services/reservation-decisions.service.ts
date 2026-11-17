import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
// Cuando entre el contrato de BE-20.2 (#12) estos dos imports pasan a
// `@Notifications`, que es el único lugar de importación que publica.
import { AvisosService } from '@Notifications/services';
import type { Reservation } from '@PrismaClient';
import type {
  DecideReservationDto,
  ListLandlordRequestsQueryDto,
} from '@ReservationDecisions/dto';
import {
  DecisionResponseDto,
  LandlordRequestDto,
  type LandlordRequestsPageDto,
} from '@ReservationDecisions/dto';
import {
  ConflictoDisponibilidadException,
  DecisionConflictError,
  SolicitudYaDecididaException,
} from '@ReservationDecisions/errors';
import {
  ReservationDecisionRepository,
  type ReservationForDecision,
} from '@ReservationDecisions/repositories';
import { buildDecisionNotice } from './decision-notice.js';

/** H04, criterio 5: el mismo texto para "no es tuya" y "ya fue decidida". */
const NO_SE_PUEDE_MODIFICAR = 'Esta solicitud no se puede modificar.';

/** Aprobación y rechazo de solicitudes de reserva (H04). */
@Injectable()
export class ReservationDecisionsService {
  private readonly logger = new Logger(ReservationDecisionsService.name);

  constructor(
    private readonly decisions: ReservationDecisionRepository,
    private readonly avisos: AvisosService,
  ) {}

  /** Página de solicitudes de las publicaciones del arrendador. */
  async listForLandlord(
    landlordId: string,
    { estado, page, limit }: ListLandlordRequestsQueryDto,
  ): Promise<LandlordRequestsPageDto> {
    const { items, total } = await this.decisions.findPageForLandlord(
      landlordId,
      { status: estado, page, limit },
    );
    return {
      items: items.map((row) => LandlordRequestDto.fromRow(row)),
      total,
      page,
      limit,
    };
  }

  /**
   * Aprueba o rechaza una solicitud PENDIENTE de una publicación propia y
   * avisa al arrendatario.
   *
   * @throws {BadRequestException} si viene un motivo al aprobar.
   * @throws {NotFoundException} si la reserva no existe.
   * @throws {ForbiddenException} si la publicación es de otro arrendador.
   * @throws {SolicitudYaDecididaException} 409 si ya fue decidida.
   * @throws {ConflictoDisponibilidadException} 409 si al aprobar las fechas
   *   ya están ocupadas por otra reserva o por un bloqueo.
   */
  async decide(
    reservationId: string,
    landlordId: string,
    { decision, motivo }: DecideReservationDto,
    now = new Date(),
  ): Promise<DecisionResponseDto> {
    // El DTO ya lo recortó; un motivo vacío es "sin motivo".
    const reason = motivo ? motivo : null;
    if (decision === 'APROBAR' && reason) {
      throw new BadRequestException('El motivo solo se usa al rechazar.');
    }

    const reservation = await this.decisions.findForDecision(reservationId);
    if (!reservation) throw new NotFoundException('La reserva no existe.');
    if (reservation.listing.landlordId !== landlordId) {
      throw new ForbiddenException(NO_SE_PUEDE_MODIFICAR);
    }
    // Respuesta rápida para el caso común. La comprobación que vale es la de
    // la transacción, que cubre dos decisiones simultáneas.
    if (reservation.status !== 'PENDIENTE') {
      throw new SolicitudYaDecididaException();
    }

    const decided = await this.save(
      reservation,
      landlordId,
      decision,
      reason,
      now,
    );
    await this.notify(reservation, decided);
    return DecisionResponseDto.fromEntity(decided);
  }

  private async save(
    reservation: ReservationForDecision,
    landlordId: string,
    decision: DecideReservationDto['decision'],
    reason: string | null,
    now: Date,
  ): Promise<Reservation> {
    try {
      return decision === 'APROBAR'
        ? await this.decisions.approve(reservation, landlordId, now)
        : await this.decisions.reject(reservation.id, landlordId, reason, now);
    } catch (error) {
      if (!(error instanceof DecisionConflictError)) throw error;
      if (error.reason === 'YA_DECIDIDA') {
        throw new SolicitudYaDecididaException();
      }
      throw new ConflictoDisponibilidadException(error.reason);
    }
  }

  /**
   * Avisa después de guardar, fuera de la transacción, como pide el contrato
   * del servicio de avisos. La decisión ya quedó guardada: si el aviso falla
   * no se deshace, solo se registra.
   */
  private async notify(
    reservation: ReservationForDecision,
    decided: Reservation,
  ): Promise<void> {
    try {
      await this.avisos.notificar(
        buildDecisionNotice(
          {
            id: reservation.id,
            tenantId: reservation.tenantId,
            listingName: reservation.listing.name,
            startAt: reservation.startAt,
            endAt: reservation.endAt,
          },
          decided.status === 'CONFIRMADA' ? 'CONFIRMADA' : 'RECHAZADA',
          decided.rejectionReason,
        ),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo avisar de la decisión de la reserva ${reservation.id}`,
        error as Error,
      );
    }
  }
}
