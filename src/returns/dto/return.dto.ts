import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsIn, IsOptional, IsString } from 'class-validator';
import type { Return, ReturnFinalState } from '@PrismaClient';

export const ESTADOS_FINALES = [
  'SIN_OBSERVACIONES',
  'CON_OBSERVACIONES',
] as const satisfies readonly ReturnFinalState[];

/**
 * Cuerpo de `POST /reservas/{id}/devolucion`. La relación entre `estadoFinal`
 * y `danos` (y su largo) la revisa el servicio.
 */
export class CreateReturnDto {
  @ApiProperty({
    format: 'date-time',
    description:
      'Fecha y hora real de la devolución (ISO 8601). No puede ser anterior a la entrega.',
    example: '2026-11-12T12:15:00-06:00',
  })
  @IsISO8601(
    { strict: true },
    { message: 'La fecha real debe ser una fecha ISO 8601.' },
  )
  fechaReal!: string;

  @ApiProperty({ enum: ESTADOS_FINALES, example: 'CON_OBSERVACIONES' })
  @IsIn(ESTADOS_FINALES, {
    message: 'El estado final debe ser SIN_OBSERVACIONES o CON_OBSERVACIONES.',
  })
  estadoFinal!: ReturnFinalState;

  @ApiPropertyOptional({
    description:
      'Daños o faltantes. Obligatorio (1 a 500 caracteres) con CON_OBSERVACIONES; vacío con SIN_OBSERVACIONES.',
    example: 'Rayón lateral',
  })
  @IsOptional()
  @IsString({ message: 'Los daños deben ser un texto.' })
  danos?: string;
}

export class ReturnCreatedDto {
  @ApiProperty({ format: 'uuid' })
  devolucionId!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ example: true })
  devolucionRegistrada!: true;

  static fromEntity(entity: Return): ReturnCreatedDto {
    return {
      devolucionId: entity.id,
      reservaId: entity.reservationId,
      devolucionRegistrada: true,
    };
  }
}

export class ReturnResponseDto {
  @ApiProperty({ format: 'uuid' })
  devolucionId!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ format: 'date-time' })
  fechaReal!: Date;

  @ApiProperty({ enum: ESTADOS_FINALES })
  estadoFinal!: ReturnFinalState;

  @ApiProperty({ nullable: true, type: String, example: 'Rayón lateral' })
  danos!: string | null;

  static fromEntity(entity: Return): ReturnResponseDto {
    return {
      devolucionId: entity.id,
      reservaId: entity.reservationId,
      fechaReal: entity.returnedAt,
      estadoFinal: entity.finalState,
      danos: entity.damages,
    };
  }
}
