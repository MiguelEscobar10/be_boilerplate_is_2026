import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const DECISIONES = ['APROBAR', 'RECHAZAR'] as const;
export type Decision = (typeof DECISIONES)[number];

export const MOTIVO_MAX = 500;

/** Body de PATCH /reservas/:id/decision. */
export class DecideReservationDto {
  @ApiProperty({ enum: DECISIONES })
  @IsIn(DECISIONES, { message: 'decision debe ser APROBAR o RECHAZAR.' })
  decision!: Decision;

  @ApiPropertyOptional({
    description:
      'Motivo del rechazo. Opcional y solo al rechazar; se guarda sin los espacios de los extremos.',
    maxLength: MOTIVO_MAX,
    example: 'Fechas no disponibles',
  })
  @IsOptional()
  // El largo se mide ya recortado, que es como se guarda.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'motivo debe ser un texto.' })
  @MaxLength(MOTIVO_MAX, {
    message: `motivo no puede superar los ${MOTIVO_MAX} caracteres.`,
  })
  motivo?: string;
}
