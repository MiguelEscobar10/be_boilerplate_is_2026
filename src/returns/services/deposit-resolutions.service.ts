import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AvisosService, ModuloOrigen } from '@Notifications';
import { Prisma } from '@PrismaClient';
import {
  DepositConflictError,
  GarantiaNoResolubleException,
} from '@Returns/errors';
import {
  DepositResolutionRepository,
  type DepositState,
} from '@Returns/repositories';

export const MAX_REASON_LENGTH = 500;
export const TITULO_AVISO_GARANTIA = 'Depósito de garantía resuelto';

export interface ResolveDepositInput {
  montoRetenido: number;
  motivo?: string;
}

const NO_EXISTE = 'La reserva no existe.';
const YA_RESUELTA = 'La garantía de esta reserva ya está resuelta.';

/**
 * Resolución del depósito de garantía y cierre de la reserva (H09, BE-09.2).
 *
 * Orden de las reglas: datos (400) → reserva (404) → dueño (403) → ya
 * resuelta (409) → devolución y montos (422). Nada se guarda si alguna falla.
 * Es un registro simulado: no se mueve dinero.
 */
@Injectable()
export class DepositResolutionsService {
  private readonly logger = new Logger(DepositResolutionsService.name);

  constructor(
    private readonly deposits: DepositResolutionRepository,
    private readonly avisos: AvisosService,
  ) {}

  async resolve(
    reservationId: string,
    landlordId: string,
    input: ResolveDepositInput,
  ): Promise<DepositState> {
    const retained = new Prisma.Decimal(input.montoRetenido);
    if (retained.isNegative()) {
      throw new BadRequestException('El monto retenido no puede ser negativo.');
    }
    const reason = this.validateReason(input.motivo, retained);

    const state = await this.deposits.findState(reservationId);
    if (!state) throw new NotFoundException(NO_EXISTE);
    if (state.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Solo el arrendador del bien puede resolver la garantía.',
      );
    }
    if (state.resolution || state.status === 'COMPLETADA') {
      throw new ConflictException(YA_RESUELTA);
    }
    if (!state.returnFinalState) {
      throw new GarantiaNoResolubleException('DEVOLUCION_NO_REGISTRADA');
    }
    if (retained.greaterThan(state.depositAmount)) {
      throw new GarantiaNoResolubleException('RETENCION_SUPERA_DEPOSITO');
    }
    if (state.returnFinalState === 'SIN_OBSERVACIONES' && !retained.isZero()) {
      throw new GarantiaNoResolubleException('RETENCION_SIN_OBSERVACIONES');
    }

    try {
      const resolution = await this.deposits.resolveAndComplete({
        reservationId,
        originalDeposit: state.depositAmount,
        retainedAmount: retained,
        // Se calcula con decimales exactos, no con números de JavaScript.
        releasedAmount: state.depositAmount.minus(retained),
        reason,
      });
      const resolved = { ...state, status: 'COMPLETADA' as const, resolution };
      await this.avisar(resolved);
      return resolved;
    } catch (error) {
      if (error instanceof DepositConflictError) {
        throw new ConflictException(
          error.reason === 'YA_RESUELTA'
            ? YA_RESUELTA
            : 'La reserva ya no está EN_CURSO.',
        );
      }
      throw error;
    }
  }

  /**
   * El estado de la garantía de una reserva (PENDIENTE si no se resolvió),
   * para su arrendador o su arrendatario.
   *
   * @throws {NotFoundException} si la reserva no existe o no es de quien
   *   pregunta (para no revelar que existe).
   */
  async findForParticipant(
    reservationId: string,
    userId: string,
  ): Promise<DepositState> {
    const state = await this.deposits.findState(reservationId);
    if (!state || (state.landlordId !== userId && state.tenantId !== userId)) {
      throw new NotFoundException(NO_EXISTE);
    }
    return state;
  }

  /** Motivo obligatorio (1 a 500) si se retiene algo. Recortado o null. */
  private validateReason(
    reason: string | undefined,
    retained: Prisma.Decimal,
  ): string | null {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed.length > MAX_REASON_LENGTH) {
      throw new BadRequestException(
        `El motivo puede tener como máximo ${MAX_REASON_LENGTH} caracteres.`,
      );
    }
    if (!retained.isZero() && trimmed.length === 0) {
      throw new BadRequestException(
        'Para retener parte de la garantía hay que indicar el motivo.',
      );
    }
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Aviso de H09 al arrendatario. Si falla, la resolución ya está guardada:
   * se registra el error y se sigue.
   */
  private async avisar(state: DepositState): Promise<void> {
    const { resolution } = state;
    if (!resolution) return;
    try {
      await this.avisos.notificar({
        destinatarioId: state.tenantId,
        titulo: TITULO_AVISO_GARANTIA,
        mensaje: `El depósito de garantía de «${state.listingName}» fue resuelto: monto liberado $${resolution.releasedAmount.toFixed(2)}, monto retenido $${resolution.retainedAmount.toFixed(2)}.`,
        moduloOrigen: ModuloOrigen.PAGOS_GARANTIA,
        referencia: { tipo: 'reserva', id: state.id },
      });
    } catch (error) {
      const e = error as Error;
      this.logger.error(
        `No se pudo registrar el aviso «${TITULO_AVISO_GARANTIA}» de la reserva ${state.id}: ${e?.message ?? String(error)}`,
        e?.stack,
      );
    }
  }
}
