import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** H02: de 12 en 12 por página, como máximo 50. */
export const LIMIT_POR_DEFECTO = 12;
export const LIMIT_MAX = 50;
/** Tope de páginas: evita que un `page` enorme haga recorrer la tabla. */
export const PAGE_MAX = 10_000;
/** El nombre mide hasta 100; un texto más largo no puede coincidir con él. */
export const BUSCAR_MAX = 100;

/**
 * Query de GET /publicaciones. Un parámetro que no esté aquí da 400 por
 * `forbidNonWhitelisted`. Los filtros de BE-11.1 se agregan en esta clase.
 */
export class ListListingsQueryDto {
  @ApiPropertyOptional({
    description:
      'Texto a buscar en el nombre o la descripción, sin distinguir mayúsculas ni acentos. Vacío devuelve todo.',
    example: 'taladro',
    maxLength: BUSCAR_MAX,
  })
  @IsOptional()
  @IsString({ message: 'buscar debe ser un texto.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(BUSCAR_MAX, {
    message: `buscar no puede pasar de ${BUSCAR_MAX} caracteres.`,
  })
  buscar?: string;

  @ApiPropertyOptional({
    description: 'Página, desde 1.',
    type: Number,
    minimum: 1,
    maximum: PAGE_MAX,
    default: 1,
  })
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un entero.' })
  @Min(1, { message: 'page debe ser al menos 1.' })
  @Max(PAGE_MAX, { message: `page no puede pasar de ${PAGE_MAX}.` })
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Publicaciones por página.',
    type: Number,
    minimum: 1,
    maximum: LIMIT_MAX,
    default: LIMIT_POR_DEFECTO,
  })
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un entero.' })
  @Min(1, { message: 'limit debe ser al menos 1.' })
  @Max(LIMIT_MAX, { message: `limit no puede pasar de ${LIMIT_MAX}.` })
  limit: number = LIMIT_POR_DEFECTO;
}
