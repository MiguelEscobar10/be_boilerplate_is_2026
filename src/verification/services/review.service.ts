import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IdentityVerificationRepository,
  type VerificationWithApplicant,
} from '@Verification/repositories';
import type { Decision } from '@Verification/dto';
import type {
  IdentityVerification,
  IdentityVerificationStatus,
} from '@PrismaClient';

const NO_EXISTE = 'La solicitud de verificación no existe.';

/**
 * Revisión manual de las solicitudes de verificación (H07, BE-07.2). Solo la
 * usa el REVISOR: el permiso lo pone el controller con @Roles('REVISOR').
 */
@Injectable()
export class ReviewService {
  constructor(private readonly verifications: IdentityVerificationRepository) {}

  /** Solicitudes de un estado, en orden de llegada. */
  list(
    status: IdentityVerificationStatus,
  ): Promise<VerificationWithApplicant[]> {
    return this.verifications.findByStatus(status);
  }

  /**
   * La solicitud cuyo documento se quiere abrir.
   *
   * @throws {NotFoundException} si no existe.
   */
  async findForDocument(id: string): Promise<IdentityVerification> {
    const verification = await this.verifications.findById(id);
    if (!verification) throw new NotFoundException(NO_EXISTE);
    return verification;
  }

  /**
   * Aprueba o rechaza una solicitud PENDIENTE y registra quién y cuándo.
   *
   * @throws {BadRequestException} si se manda un motivo al aprobar.
   * @throws {NotFoundException} si la solicitud no existe.
   * @throws {ConflictException} si ya estaba decidida (también si otro REVISOR
   *   la decidió al mismo tiempo).
   */
  async decide(
    id: string,
    reviewerId: string,
    decision: Decision,
    reason?: string,
  ): Promise<IdentityVerification> {
    if (decision === 'APROBAR' && reason !== undefined) {
      throw new BadRequestException(
        'El motivo solo se escribe al rechazar una solicitud.',
      );
    }

    const verification = await this.verifications.findById(id);
    if (!verification) throw new NotFoundException(NO_EXISTE);
    if (verification.status !== 'PENDIENTE') {
      throw new ConflictException(this.alreadyDecided(verification.status));
    }

    const decided = await this.verifications.decide(verification, {
      status: decision === 'APROBAR' ? 'APROBADA' : 'RECHAZADA',
      reviewedById: reviewerId,
      rejectionReason: decision === 'RECHAZAR' ? (reason ?? null) : null,
    });
    if (!decided) {
      // Otro REVISOR la decidió entre la lectura y el UPDATE.
      throw new ConflictException(this.alreadyDecided());
    }
    return decided;
  }

  private alreadyDecided(status?: IdentityVerificationStatus): string {
    return status
      ? `La solicitud ya fue resuelta (${status}) y no se puede decidir otra vez.`
      : 'La solicitud ya fue resuelta y no se puede decidir otra vez.';
  }
}
