import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ListingType, RateUnit } from '@PrismaClient';

/** Monto con hasta dos decimales, sin signo: "15", "15.5", "15.50". */
const MONTO = /^\d{1,10}(\.\d{1,2})?$/;

/** En multipart todo llega como string; se recortan los espacios de los textos. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Un campo opcional que llega vacío en el form se trata como ausente. */
const emptyToUndefined = ({ value }: { value: unknown }) => {
  const v = trim({ value });
  return v === '' ? undefined : v;
};

/**
 * Campos de texto del formulario de publicación (multipart/form-data).
 * Las imágenes no viajan aquí: llegan por `imagenes[]` y las valida el servicio.
 */
export class CreateListingDto {
  @ApiProperty({ enum: ListingType, example: ListingType.EQUIPO })
  @IsEnum(ListingType, { message: 'El tipo debe ser EQUIPO o ESPACIO.' })
  tipo!: ListingType;

  @ApiProperty({ example: 'Taladro percutor', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(100, { message: 'El nombre no puede pasar de 100 caracteres.' })
  nombre!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: 'La descripción no puede pasar de 1000 caracteres.',
  })
  descripcion?: string;

  @ApiProperty({
    example: 'Antiguo Cuscatlán, La Libertad',
    minLength: 1,
    maxLength: 200,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'La ubicación es obligatoria.' })
  @MaxLength(200, { message: 'La ubicación no puede pasar de 200 caracteres.' })
  ubicacion!: string;

  @ApiProperty({
    example: '15.00',
    description: 'Mayor que 0, con hasta dos decimales.',
  })
  @Transform(trim)
  @Matches(MONTO, {
    message: 'La tarifa debe ser un monto con hasta dos decimales.',
  })
  tarifaMonto!: string;

  @ApiProperty({ enum: RateUnit, example: RateUnit.DIA })
  @IsEnum(RateUnit, {
    message: 'La unidad de cobro debe ser HORA, DIA, NOCHE o SEMANA.',
  })
  tarifaUnidad!: RateUnit;

  @ApiPropertyOptional({
    example: '50.00',
    description: 'Mayor o igual que 0. Por defecto 0.00.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(MONTO, {
    message: 'El depósito debe ser un monto con hasta dos decimales.',
  })
  depositoMonto?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: 'Las condiciones no pueden pasar de 1000 caracteres.',
  })
  condiciones?: string;
}
