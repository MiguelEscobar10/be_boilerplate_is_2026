import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { DeliveryWithPhotos } from '@Deliveries/repositories';
import type { Delivery } from '@PrismaClient';

/**
 * Campo de texto del multipart. El largo y el vacío los revisa el servicio
 * para responder siempre el mismo mensaje.
 */
export class CreateDeliveryDto {
  @ApiPropertyOptional({
    description: 'Estado inicial del bien. Obligatoria, de 1 a 500 caracteres.',
    example: 'Taladro completo, con su estuche y dos brocas.',
  })
  @IsOptional()
  @IsString({ message: 'La nota debe ser un texto.' })
  nota?: string;
}

export class DeliveryCreatedDto {
  @ApiProperty({ format: 'uuid' })
  entregaId!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ example: 'EN_CURSO' })
  estadoReserva!: 'EN_CURSO';

  static fromEntity(delivery: Delivery): DeliveryCreatedDto {
    return {
      entregaId: delivery.id,
      reservaId: delivery.reservationId,
      estadoReserva: 'EN_CURSO',
    };
  }
}

export class DeliveryPhotoDto {
  @ApiProperty({ example: 0 })
  orden!: number;

  @ApiProperty({ example: '/api/v1/reservas/7c1e.../entrega/fotos/0' })
  url!: string;
}

export class DeliveryResponseDto {
  @ApiProperty({ format: 'uuid' })
  entregaId!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ format: 'date-time' })
  entregadaAt!: Date;

  @ApiProperty()
  nota!: string;

  @ApiProperty({ type: [DeliveryPhotoDto] })
  fotos!: DeliveryPhotoDto[];

  static fromEntity(delivery: DeliveryWithPhotos): DeliveryResponseDto {
    return {
      entregaId: delivery.id,
      reservaId: delivery.reservationId,
      entregadaAt: delivery.deliveredAt,
      nota: delivery.initialConditionNote,
      fotos: delivery.photos.map((photo) => ({
        orden: photo.position,
        url: `/api/v1/reservas/${delivery.reservationId}/entrega/fotos/${photo.position}`,
      })),
    };
  }
}
