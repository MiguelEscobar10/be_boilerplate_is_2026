import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query de GET /reportes/ingresos. Las dos fechas son opcionales: la que
 * falte sale del mes calendario en curso (hora de El Salvador). Que la fecha
 * exista (no `2026-02-30`), el orden y el rango máximo los revisa el servicio.
 * Cualquier otro parámetro (p. ej. `arrendadorId`) da 400 por el
 * `forbidNonWhitelisted` global.
 */
export class IncomeQueryDto {
  @ApiPropertyOptional({
    description:
      'Primer día del período (inclusive), `AAAA-MM-DD`, en hora de El Salvador. Por defecto, el primer día del mes en curso.',
    example: '2026-11-01',
  })
  @IsOptional()
  @Matches(FECHA, { message: 'desde debe tener el formato AAAA-MM-DD.' })
  desde?: string;

  @ApiPropertyOptional({
    description:
      'Último día del período (inclusive), `AAAA-MM-DD`, en hora de El Salvador. Por defecto, el último día del mes en curso.',
    example: '2026-11-30',
  })
  @IsOptional()
  @Matches(FECHA, { message: 'hasta debe tener el formato AAAA-MM-DD.' })
  hasta?: string;
}
