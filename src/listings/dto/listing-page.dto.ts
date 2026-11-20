import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingType, RateUnit } from '@PrismaClient';
import type { ListingSummaryRow } from '@Listings/repositories';

/** Una tarjeta del catálogo (H02). */
export class ListingSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Taladro percutor' })
  nombre!: string;

  @ApiProperty({ example: 15, description: 'Tarifa por unidad.' })
  precio!: number;

  @ApiProperty({ enum: ListingType })
  tipo!: ListingType;

  @ApiProperty({ enum: RateUnit, description: 'Unidad de la tarifa.' })
  tarifaUnidad!: RateUnit;

  @ApiProperty({ example: 'Antiguo Cuscatlán' })
  ubicacion!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Fotografía principal, o null si no tiene.',
    example: '/api/v1/publicaciones/7c1e.../imagenes/0',
  })
  imagenUrl!: string | null;

  static fromRow(row: ListingSummaryRow): ListingSummaryDto {
    return {
      id: row.id,
      nombre: row.name,
      precio: row.rateAmount.toNumber(),
      tipo: row.type,
      tarifaUnidad: row.rateUnit,
      ubicacion: row.location,
      imagenUrl:
        row.imagePosition === null
          ? null
          : `/api/v1/publicaciones/${row.id}/imagenes/${row.imagePosition}`,
    };
  }
}

/** Respuesta de GET /publicaciones: una página del catálogo. */
export class ListingPageDto {
  @ApiProperty({ type: [ListingSummaryDto] })
  items!: ListingSummaryDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 1, description: 'Total de coincidencias.' })
  total!: number;
}
