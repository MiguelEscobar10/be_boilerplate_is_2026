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

export class ListingRateDto {
  @ApiProperty({ example: 15, description: 'Monto de la tarifa.' })
  monto!: number;

  @ApiProperty({ enum: RateUnit })
  unidad!: RateUnit;
}

/** Promedios y total de calificaciones de una publicación (H17). */
export interface ListingRatingSummary {
  promedioBien: number | null;
  promedioArrendador: number | null;
  totalCalificaciones: number;
}

/**
 * Detalle completo de una publicación (H12, BE-12.1): lo que el arrendatario
 * necesita antes de reservar. Conserva los campos de BE-01.1 y agrega la
 * tarifa y el depósito como número, los promedios y `requiereVerificacion`.
 * Del arrendador solo sale su id: ni correo, ni teléfono, ni nombre.
 */
export class ListingDetailDto extends ListingResponseDto {
  @ApiProperty({ type: ListingRateDto })
  tarifa!: ListingRateDto;

  @ApiProperty({ example: 20, description: 'Depósito de garantía.' })
  deposito!: number;

  @ApiProperty({
    example: false,
    description:
      'Si solo la pueden solicitar arrendatarios con identidad verificada (H19).',
  })
  requiereVerificacion!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 4.5,
    description:
      'Promedio de las calificaciones de esta publicación, con un decimal. null si no tiene.',
  })
  promedioBien!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 4.8,
    description:
      'Promedio del arrendador en todas sus publicaciones, con un decimal. null si no tiene.',
  })
  promedioArrendador!: number | null;

  @ApiProperty({
    example: 6,
    description: 'Calificaciones de esta publicación. 0 si no tiene.',
  })
  totalCalificaciones!: number;

  static fromDetail(
    listing: Listing & { images: ListingImage[] },
    ratings: ListingRatingSummary,
  ): ListingDetailDto {
    return Object.assign(ListingResponseDto.fromEntity(listing), {
      tarifa: {
        monto: listing.rateAmount.toNumber(),
        unidad: listing.rateUnit,
      },
      deposito: listing.depositAmount.toNumber(),
      requiereVerificacion: listing.requiresVerification,
      ...ratings,
    });
  }
}
