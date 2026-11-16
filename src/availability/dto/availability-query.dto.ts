import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, Matches } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query de GET /publicaciones/:id/disponibilidad. Las dos fechas son
 * obligatorias y van como `AAAA-MM-DD`, en hora de El Salvador. Que la fecha
 * exista (no `2026-02-30`), el orden y el rango máximo los revisa el servicio.
 *
 * Un parámetro que no esté aquí da 400 por `forbidNonWhitelisted`.
 */
export class AvailabilityQueryDto {
  @ApiProperty({
    description: 'Primer día del rango (inclusive), `AAAA-MM-DD`.',
    example: '2026-11-01',
  })
  @IsDefined({ message: 'desde es obligatorio.' })
  @Matches(FECHA, { message: 'desde debe tener el formato AAAA-MM-DD.' })
  desde!: string;

  @ApiProperty({
    description: 'Último día del rango (inclusive), `AAAA-MM-DD`.',
    example: '2026-11-30',
  })
  @IsDefined({ message: 'hasta es obligatorio.' })
  @Matches(FECHA, { message: 'hasta debe tener el formato AAAA-MM-DD.' })
  hasta!: string;
}
