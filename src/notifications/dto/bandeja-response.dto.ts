import { ApiProperty } from '@nestjs/swagger';
import { NotificacionResponseDto } from './notificacion-response.dto.js';

/** Página de la bandeja del usuario autenticado. */
export class BandejaResponseDto {
  @ApiProperty({ type: [NotificacionResponseDto] })
  items!: NotificacionResponseDto[];

  @ApiProperty({
    example: 1,
    description:
      'Total de notificaciones que cumplen el filtro (no solo las de esta página).',
  })
  total!: number;
}

/** Contador de no leídas del usuario autenticado. */
export class ConteoNoLeidasResponseDto {
  @ApiProperty({ example: 3 })
  noLeidas!: number;
}
