import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query de GET /reportes/ocupacion. Las dos fechas son opcionales: si falta
 * alguna, el período es el mes calendario en curso (hora de El Salvador). Que
 * la fecha exista (no `2026-02-30`), el orden y el rango máximo los revisa el
 * servicio.
 */
export class OccupancyQueryDto {
  @ApiPropertyOptional({
    description: 'Primer día del período (inclusive), `AAAA-MM-DD`.',
    example: '2026-11-01',
  })
  @IsOptional()
  @Matches(FECHA, { message: 'desde debe tener el formato AAAA-MM-DD.' })
  desde?: string;

  @ApiPropertyOptional({
    description: 'Último día del período (inclusive), `AAAA-MM-DD`.',
    example: '2026-11-30',
  })
  @IsOptional()
  @Matches(FECHA, { message: 'hasta debe tener el formato AAAA-MM-DD.' })
  hasta?: string;
}
