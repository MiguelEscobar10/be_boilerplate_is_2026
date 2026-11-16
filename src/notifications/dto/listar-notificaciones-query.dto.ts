import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export const LIMIT_POR_DEFECTO = 20;
export const LIMIT_MAX = 100;
/**
 * Tope de páginas. Con LIMIT_MAX, el OFFSET más grande es 999 900: entra en un
 * entero de 32 bits y evita que un `page` enorme haga recorrer la tabla.
 */
export const PAGE_MAX = 10_000;

/**
 * Solo acepta los textos `true` y `false`. Cualquier otro valor pasa tal cual
 * y lo rechaza @IsBoolean con 400. No se usa `@Type(() => Boolean)` porque
 * convierte `"false"` en `true` (todo string no vacío es truthy).
 */
function aBooleano({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/**
 * Query de GET /notificaciones. Los query params llegan como string: el
 * ValidationPipe global (con `transform`) los convierte antes de validar.
 *
 * Un parámetro que no esté aquí da 400 por `forbidNonWhitelisted`. Es
 * intencional: un `soloNoleidas` mal escrito no debe ignorarse en silencio y
 * devolver la bandeja completa.
 */
export class ListarNotificacionesQueryDto {
  @ApiPropertyOptional({
    description: 'Si es `true`, devuelve solo las no leídas.',
    type: Boolean,
    default: false,
  })
  @Transform(aBooleano)
  @IsBoolean({ message: 'soloNoLeidas debe ser true o false.' })
  soloNoLeidas: boolean = false;

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
    description: 'Notificaciones por página.',
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
