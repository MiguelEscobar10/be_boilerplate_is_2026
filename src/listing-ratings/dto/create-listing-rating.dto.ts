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

const rango = (campo: string) =>
  `${campo} debe estar entre ${PUNTAJE_MIN} y ${PUNTAJE_MAX}.`;

/**
 * Body de POST /reservas/:id/calificacion. Los puntajes llegan como número
 * JSON: un `"5"` en texto es 400, igual que un 4.5.
 */
export class CreateListingRatingDto {
  @ApiProperty({ minimum: PUNTAJE_MIN, maximum: PUNTAJE_MAX, example: 4 })
  @IsDefined({ message: 'puntajeBien es obligatorio.' })
  @IsInt({ message: 'puntajeBien debe ser un número entero.' })
  @Min(PUNTAJE_MIN, { message: rango('puntajeBien') })
  @Max(PUNTAJE_MAX, { message: rango('puntajeBien') })
  puntajeBien!: number;

  @ApiProperty({ minimum: PUNTAJE_MIN, maximum: PUNTAJE_MAX, example: 5 })
  @IsDefined({ message: 'puntajeArrendador es obligatorio.' })
  @IsInt({ message: 'puntajeArrendador debe ser un número entero.' })
  @Min(PUNTAJE_MIN, { message: rango('puntajeArrendador') })
  @Max(PUNTAJE_MAX, { message: rango('puntajeArrendador') })
  puntajeArrendador!: number;

  @ApiPropertyOptional({
    description:
      'Comentario opcional. Se guarda sin los espacios de los extremos.',
    maxLength: COMENTARIO_MAX,
    example: 'Todo en orden',
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
