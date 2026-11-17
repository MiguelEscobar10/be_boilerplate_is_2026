import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IdentityVerificationStatus } from '@PrismaClient';
import type { IdentityVerification } from '@PrismaClient';

/** Respuesta del POST: lo mínimo para confirmar que se registró. */
export class VerificationCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: IdentityVerificationStatus,
    example: IdentityVerificationStatus.PENDIENTE,
  })
  estado!: IdentityVerificationStatus;

  static fromEntity(
    verification: IdentityVerification,
  ): VerificationCreatedDto {
    return { id: verification.id, estado: verification.status };
  }
}

/**
 * Respuesta de la consulta de la última solicitud. Nunca incluye el
 * documento ni su ruta (`document_key`): esa referencia es privada.
 */
export class VerificationResponseDto extends VerificationCreatedDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 'Documento ilegible',
    description: 'Solo si fue RECHAZADA y el revisor escribió un motivo.',
  })
  motivoRechazo!: string | null;

  @ApiProperty({ format: 'date-time' })
  enviadaAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  revisadaAt!: Date | null;

  static fromEntity(
    verification: IdentityVerification,
  ): VerificationResponseDto {
    return {
      id: verification.id,
      estado: verification.status,
      motivoRechazo: verification.rejectionReason,
      enviadaAt: verification.submittedAt,
      revisadaAt: verification.reviewedAt,
    };
  }
}
