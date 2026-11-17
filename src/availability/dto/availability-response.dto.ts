import { ApiProperty } from '@nestjs/swagger';

/** Un período en el que la publicación no está disponible. */
export class BusyPeriodDto {
  @ApiProperty({
    description: 'Inicio del período, en hora de El Salvador.',
    example: '2026-11-12T09:00:00-06:00',
  })
  inicio!: string;

  @ApiProperty({
    description: 'Fin del período (no incluido), en hora de El Salvador.',
    example: '2026-11-12T12:00:00-06:00',
  })
  fin!: string;

  @ApiProperty({
    description:
      'RESERVA si es una reserva confirmada o en curso; BLOQUEO si el arrendador bloqueó las fechas.',
    enum: ['RESERVA', 'BLOQUEO'],
  })
  origen!: 'RESERVA' | 'BLOQUEO';
}

/** Respuesta de GET /publicaciones/:id/disponibilidad. */
export class AvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  publicacionId!: string;

  @ApiProperty({ example: '2026-11-01' })
  desde!: string;

  @ApiProperty({ example: '2026-11-30' })
  hasta!: string;

  @ApiProperty({
    description:
      'Períodos ocupados que se cruzan con el rango, en orden. Lo que no aparece está libre.',
    type: [BusyPeriodDto],
  })
  ocupados!: BusyPeriodDto[];
}
