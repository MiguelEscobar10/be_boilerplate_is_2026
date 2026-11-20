import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Reservation } from '@PrismaClient';

/** Respuesta de PATCH /reservas/:id/decision. */
export class DecisionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['CONFIRMADA', 'RECHAZADA'] })
  estado!: string;

  @ApiProperty({ format: 'date-time' })
  decididaAt!: Date;

  @ApiPropertyOptional({
    description: 'Motivo del rechazo, si el arrendador escribió uno.',
    nullable: true,
  })
  motivoRechazo!: string | null;

  static fromEntity(reservation: Reservation): DecisionResponseDto {
    return {
      id: reservation.id,
      estado: reservation.status,
      // Recién decidida: decided_at siempre viene.
      decididaAt: reservation.decidedAt as Date,
      motivoRechazo: reservation.rejectionReason,
    };
  }
}
