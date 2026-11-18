import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IdentityVerificationStatus } from '@PrismaClient';
import type { VerificationWithApplicant } from '@Verification/repositories';

export const DECISIONES = ['APROBAR', 'RECHAZAR'] as const;
export type Decision = (typeof DECISIONES)[number];

/** Query de GET /verificaciones. Por defecto, la cola de PENDIENTE. */
export class ListVerificationsQueryDto {
  @ApiPropertyOptional({
    enum: IdentityVerificationStatus,
    default: IdentityVerificationStatus.PENDIENTE,
  })
  @IsOptional()
  @IsEnum(IdentityVerificationStatus, {
    message: 'estado debe ser PENDIENTE, APROBADA o RECHAZADA.',
  })
  estado: IdentityVerificationStatus = IdentityVerificationStatus.PENDIENTE;
}

/** Body de PATCH /verificaciones/{id}/decision. */
export class DecisionDto {
  @ApiProperty({ enum: DECISIONES, example: 'RECHAZAR' })
  @IsIn(DECISIONES, { message: 'decision debe ser APROBAR o RECHAZAR.' })
  decision!: Decision;

  @ApiPropertyOptional({
    example: 'Documento ilegible',
    maxLength: 500,
    description: 'Solo al rechazar. Opcional.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf((dto: DecisionDto) => dto.decision === 'RECHAZAR')
  @IsString({ message: 'motivo debe ser un texto.' })
  @Matches(/\S/, { message: 'motivo no puede estar vacío.' })
  @MaxLength(500, { message: 'motivo puede tener como máximo 500 caracteres.' })
  motivo?: string;
}

export class ApplicantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ana@example.com' })
  email!: string;

  @ApiPropertyOptional({ example: 'Ana López', nullable: true })
  nombre!: string | null;
}

/** Una solicitud en la cola del REVISOR. Sin la ruta del documento. */
export class VerificationQueueItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: IdentityVerificationStatus })
  estado!: IdentityVerificationStatus;

  @ApiProperty({ type: ApplicantDto })
  usuario!: ApplicantDto;

  @ApiProperty({ format: 'date-time' })
  enviadaAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  motivoRechazo!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  revisadaAt!: Date | null;

  @ApiProperty({
    example: '/api/v1/verificaciones/7c1e.../documento',
    description: 'Ruta protegida para abrir el documento (solo REVISOR).',
  })
  documentoUrl!: string;

  static fromEntity(v: VerificationWithApplicant): VerificationQueueItemDto {
    return {
      id: v.id,
      estado: v.status,
      usuario: {
        id: v.user.id,
        email: v.user.email,
        nombre: v.user.profile?.name ?? null,
      },
      enviadaAt: v.submittedAt,
      motivoRechazo: v.rejectionReason,
      revisadaAt: v.reviewedAt,
      documentoUrl: `/api/v1/verificaciones/${v.id}/documento`,
    };
  }
}
