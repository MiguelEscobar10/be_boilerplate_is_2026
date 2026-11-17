import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const MOTIVO_BLOQUEO_MAX = 200;

/**
 * Fecha y hora con su zona: `2026-11-20T00:00:00-06:00` o `...Z`. Sin zona
 * no se acepta, porque no se sabría si es hora de El Salvador o UTC.
 */
export const FECHA_HORA_CON_ZONA =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Body de POST /publicaciones/:id/bloqueos. */
export class CreateBlockDto {
  @ApiProperty({
    description: 'Inicio del bloqueo, con zona horaria.',
    example: '2026-11-20T00:00:00-06:00',
  })
  @IsDefined({ message: 'inicio es obligatorio.' })
  @IsString({ message: 'inicio debe ser un texto.' })
  @Matches(FECHA_HORA_CON_ZONA, {
    message:
      'inicio debe ser una fecha y hora con zona, por ejemplo 2026-11-20T00:00:00-06:00.',
  })
  inicio!: string;

  @ApiProperty({
    description: 'Fin del bloqueo (no incluido), con zona horaria.',
    example: '2026-11-22T00:00:00-06:00',
  })
  @IsDefined({ message: 'fin es obligatorio.' })
  @IsString({ message: 'fin debe ser un texto.' })
  @Matches(FECHA_HORA_CON_ZONA, {
    message:
      'fin debe ser una fecha y hora con zona, por ejemplo 2026-11-22T00:00:00-06:00.',
  })
  fin!: string;

  @ApiPropertyOptional({
    description:
      'Motivo del bloqueo. Opcional; se guarda sin los espacios de los extremos.',
    maxLength: MOTIVO_BLOQUEO_MAX,
    example: 'Mantenimiento',
  })
  @IsOptional()
  // El largo se mide ya recortado, que es como se guarda.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'motivo debe ser un texto.' })
  @MaxLength(MOTIVO_BLOQUEO_MAX, {
    message: `motivo no puede superar los ${MOTIVO_BLOQUEO_MAX} caracteres.`,
  })
  motivo?: string;
}
