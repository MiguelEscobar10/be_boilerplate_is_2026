import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingType, RateUnit } from '@PrismaClient';
import type { Listing, ListingImage } from '@PrismaClient';

export class ListingImageDto {
  @ApiProperty({ example: 0 })
  orden!: number;

  @ApiProperty({ example: '/api/v1/publicaciones/7c1e.../imagenes/0' })
  url!: string;
}

/** Respuesta del POST: lo mínimo para confirmar que se creó. */
export class ListingCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ListingType })
  tipo!: ListingType;

  @ApiProperty({ example: 'Taladro percutor' })
  nombre!: string;

  @ApiProperty({ example: true })
  activo!: boolean;

  static fromEntity(listing: Listing): ListingCreatedDto {
    return {
      id: listing.id,
      tipo: listing.type,
      nombre: listing.name,
      activo: listing.isActive,
    };
  }
}

/** Respuesta del GET: la publicación con sus imágenes públicas en orden. */
export class ListingResponseDto extends ListingCreatedDto {
  @ApiProperty({ format: 'uuid' })
  arrendadorId!: string;

  @ApiPropertyOptional()
  descripcion!: string | null;

  @ApiProperty()
  ubicacion!: string;

  @ApiProperty({ example: '15.00' })
  tarifaMonto!: string;

  @ApiProperty({ enum: RateUnit })
  tarifaUnidad!: RateUnit;

  @ApiProperty({ example: '0.00' })
  depositoMonto!: string;

  @ApiPropertyOptional()
  condiciones!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: [ListingImageDto] })
  imagenes!: ListingImageDto[];

  static fromEntity(
    listing: Listing & { images: ListingImage[] },
  ): ListingResponseDto {
    return {
      id: listing.id,
      tipo: listing.type,
      nombre: listing.name,
      activo: listing.isActive,
      arrendadorId: listing.landlordId,
      descripcion: listing.description,
      ubicacion: listing.location,
      // Los Decimal se devuelven como string para no perder precisión en JSON.
      tarifaMonto: listing.rateAmount.toFixed(2),
      tarifaUnidad: listing.rateUnit,
      depositoMonto: listing.depositAmount.toFixed(2),
      condiciones: listing.conditions,
      createdAt: listing.createdAt,
      imagenes: listing.images.map((image) => ({
        orden: image.position,
        url: `/api/v1/publicaciones/${listing.id}/imagenes/${image.position}`,
      })),
    };
  }
}
