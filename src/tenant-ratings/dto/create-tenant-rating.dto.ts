import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PUNTAJE_MIN = 1;
export const PUNTAJE_MAX = 5;
export const COMENTARIO_MAX = 500;

/**
 * Body de POST /reservas/:id/calificacion-arrendatario. El puntaje llega como
 * número JSON: un `"5"` en texto es 400, igual que un 4.5.
 */
export class CreateTenantRatingDto {
  @ApiProperty({ minimum: PUNTAJE_MIN, maximum: PUNTAJE_MAX, example: 5 })
  @IsDefined({ message: 'puntaje es obligatorio.' })
  @IsInt({ message: 'puntaje debe ser un número entero.' })
  @Min(PUNTAJE_MIN, {
    message: `puntaje debe estar entre ${PUNTAJE_MIN} y ${PUNTAJE_MAX}.`,
  })
  @Max(PUNTAJE_MAX, {
    message: `puntaje debe estar entre ${PUNTAJE_MIN} y ${PUNTAJE_MAX}.`,
  })
  puntaje!: number;

  @ApiPropertyOptional({
    description:
      'Comentario opcional. Se guarda sin los espacios de los extremos.',
    maxLength: COMENTARIO_MAX,
    example: 'Devolvió el equipo a tiempo',
  })
  @IsOptional()
  // El largo se mide ya recortado, que es como se guarda.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'comentario debe ser un texto.' })
  @MaxLength(COMENTARIO_MAX, {
    message: `comentario no puede superar los ${COMENTARIO_MAX} caracteres.`,
  })
  comentario?: string;
}
