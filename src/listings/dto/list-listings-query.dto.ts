import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ListingType } from '@PrismaClient';

/** H02: de 12 en 12 por página, como máximo 50. */
export const LIMIT_POR_DEFECTO = 12;
export const LIMIT_MAX = 50;
/** Tope de páginas: evita que un `page` enorme haga recorrer la tabla. */
export const PAGE_MAX = 10_000;
/** El nombre mide hasta 100; un texto más largo no puede coincidir con él. */
export const BUSCAR_MAX = 100;
/** Largo máximo de la ubicación de una publicación. */
export const UBICACION_MAX = 200;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Query de GET /publicaciones. Un parámetro que no esté aquí da 400 por
 * `forbidNonWhitelisted`. Los filtros (H11, BE-11.1) son opcionales y se
 * combinan entre sí y con `buscar`: una publicación debe cumplirlos todos.
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
  @Transform(trim)
  @MaxLength(BUSCAR_MAX, {
    message: `buscar no puede pasar de ${BUSCAR_MAX} caracteres.`,
  })
  buscar?: string;

  @ApiPropertyOptional({ enum: ListingType, description: 'Tipo de bien.' })
  @IsOptional()
  @IsEnum(ListingType, {
    message: `tipo debe ser uno de: ${Object.values(ListingType).join(', ')}.`,
  })
  tipo?: ListingType;

  @ApiPropertyOptional({
    description:
      'Texto que debe contener la ubicación, sin distinguir mayúsculas ni acentos.',
    example: 'san salvador',
    maxLength: UBICACION_MAX,
  })
  @IsOptional()
  @IsString({ message: 'ubicacion debe ser un texto.' })
  @Transform(trim)
  @MaxLength(UBICACION_MAX, {
    message: `ubicacion no puede pasar de ${UBICACION_MAX} caracteres.`,
  })
  ubicacion?: string;

  @ApiPropertyOptional({
    description: 'Tarifa mínima (inclusive).',
    type: Number,
    minimum: 0,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'precioMin debe ser un número con hasta dos decimales.' },
  )
  @Min(0, { message: 'precioMin no puede ser negativo.' })
  precioMin?: number;

  @ApiPropertyOptional({
    description: 'Tarifa máxima (inclusive). No puede ser menor que precioMin.',
    type: Number,
    minimum: 0,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'precioMax debe ser un número con hasta dos decimales.' },
  )
  @Min(0, { message: 'precioMax no puede ser negativo.' })
  precioMax?: number;

  @ApiPropertyOptional({
    description:
      'Primer día en que se necesita el bien (inclusive), `AAAA-MM-DD`, en hora de El Salvador. No puede ser un día pasado. Va junto con `fechaFin`.',
    example: '2026-12-01',
  })
  @IsOptional()
  @Matches(FECHA, { message: 'fechaInicio debe tener el formato AAAA-MM-DD.' })
  fechaInicio?: string;

  @ApiPropertyOptional({
    description:
      'Último día en que se necesita el bien (inclusive), `AAAA-MM-DD`. Va junto con `fechaInicio`.',
    example: '2026-12-03',
  })
  @IsOptional()
  @Matches(FECHA, { message: 'fechaFin debe tener el formato AAAA-MM-DD.' })
  fechaFin?: string;

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
