import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ReservationStatus } from '@PrismaClient';

/** H04, criterio 1: de 12 en 12 por página. */
export const LIMIT_POR_DEFECTO = 12;
export const LIMIT_MAX = 50;
/** Tope de páginas: evita que un `page` enorme haga recorrer la tabla. */
export const PAGE_MAX = 10_000;

/**
 * Query de GET /arrendador/solicitudes. Un parámetro que no esté aquí da 400
 * por `forbidNonWhitelisted`: un `estdo` mal escrito no debe ignorarse y
 * devolver todas las solicitudes.
 */
export class ListLandlordRequestsQueryDto {
  @ApiPropertyOptional({
    enum: ReservationStatus,
    description: 'Filtra por estado. Sin él, devuelve todas.',
  })
  @IsOptional()
  @IsEnum(ReservationStatus, {
    message: `estado debe ser uno de: ${Object.values(ReservationStatus).join(', ')}.`,
  })
  estado?: ReservationStatus;

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
    description: 'Solicitudes por página.',
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
