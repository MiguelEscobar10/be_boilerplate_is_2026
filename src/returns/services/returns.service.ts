import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReturnConflictError } from '@Returns/errors';
import { ReturnRepository } from '@Returns/repositories';
import type { Return, ReturnFinalState } from '@PrismaClient';

export const MAX_DAMAGES_LENGTH = 500;

export interface RegisterReturnInput {
  fechaReal: string;
  estadoFinal: ReturnFinalState;
  danos?: string;
}

const NO_EXISTE = 'La reserva no existe.';
const YA_REGISTRADA = 'La devolución de esta reserva ya se registró.';

/**
 * Registro de la devolución (H09, BE-09.1).
 *
 * Orden de las reglas: datos (400) → reserva (404) → dueño (403) → entrega
 * previa y duplicado (409) → fecha contra la entrega (400). Nada se guarda si
 * alguna falla.
 */
@Injectable()
export class ReturnsService {
  constructor(private readonly returns: ReturnRepository) {}

  async register(
    reservationId: string,
    landlordId: string,
    input: RegisterReturnInput,
  ): Promise<Return> {
    const damages = this.validateDamages(input.estadoFinal, input.danos);
    const returnedAt = new Date(input.fechaReal);
    if (Number.isNaN(returnedAt.getTime())) {
      throw new BadRequestException('La fecha real no es válida.');
    }

    const reservation = await this.returns.findReservation(reservationId);
    if (!reservation) throw new NotFoundException(NO_EXISTE);
    if (reservation.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Solo el arrendador del bien puede registrar la devolución.',
      );
    }
    if (reservation.hasReturn) throw new ConflictException(YA_REGISTRADA);
    if (reservation.status !== 'EN_CURSO' || !reservation.deliveredAt) {
      throw new ConflictException(
        'Solo se registra la devolución de una reserva con entrega previa (EN_CURSO).',
      );
    }
    if (returnedAt < reservation.deliveredAt) {
      throw new BadRequestException(
        `La fecha real no puede ser anterior a la entrega (${reservation.deliveredAt.toISOString()}).`,
      );
    }

    try {
      return await this.returns.create({
        reservationId,
        registeredById: landlordId,
        returnedAt,
        finalState: input.estadoFinal,
        damages,
      });
    } catch (error) {
      if (error instanceof ReturnConflictError) {
        throw new ConflictException(
          error.reason === 'YA_DEVUELTA'
            ? YA_REGISTRADA
            : 'La reserva ya no está EN_CURSO.',
        );
      }
      throw error;
    }
  }

  /**
   * La devolución de una reserva, para su arrendador o su arrendatario.
   *
   * @throws {NotFoundException} si la reserva no existe, no es de quien
   *   pregunta (para no revelar que existe) o todavía no tiene devolución.
   */
  async findForParticipant(
    reservationId: string,
    userId: string,
  ): Promise<Return> {
    const reservation = await this.returns.findReservation(reservationId);
    if (
      !reservation ||
      (reservation.landlordId !== userId && reservation.tenantId !== userId)
    ) {
      throw new NotFoundException(NO_EXISTE);
    }
    const found = await this.returns.findByReservation(reservationId);
    if (!found) {
      throw new NotFoundException('La reserva todavía no tiene devolución.');
    }
    return found;
  }

  /**
   * Daños obligatorios (1 a 500) con CON_OBSERVACIONES y vacíos con
   * SIN_OBSERVACIONES. Devuelve el texto recortado o null.
   */
  private validateDamages(
    finalState: ReturnFinalState,
    damages: string | undefined,
  ): string | null {
    const trimmed = typeof damages === 'string' ? damages.trim() : '';
    if (finalState === 'SIN_OBSERVACIONES') {
      if (trimmed.length > 0) {
        throw new BadRequestException(
          'Con SIN_OBSERVACIONES no se anotan daños.',
        );
      }
      return null;
    }
    if (trimmed.length === 0) {
      throw new BadRequestException(
        'Con CON_OBSERVACIONES hay que describir los daños o faltantes.',
      );
    }
    if (trimmed.length > MAX_DAMAGES_LENGTH) {
      throw new BadRequestException(
        `Los daños pueden tener como máximo ${MAX_DAMAGES_LENGTH} caracteres.`,
      );
    }
    return trimmed;
  }
}
