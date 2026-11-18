import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationStatus } from '@PrismaClient';
import type { LandlordRequestRow } from '@ReservationDecisions/repositories';

class RequestListingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Taladro percutor' })
  nombre!: string;
}

class RequestTenantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ana Martínez' })
  nombre!: string;
}

/** Una solicitud en el panel del arrendador (H04, criterio 1). */
export class LandlordRequestDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ReservationStatus })
  estado!: ReservationStatus;

  @ApiProperty({ type: RequestListingDto })
  publicacion!: RequestListingDto;

  @ApiProperty({ type: RequestTenantDto, description: 'Quién la solicitó.' })
  arrendatario!: RequestTenantDto;

  @ApiProperty({ format: 'date-time' })
  inicio!: Date;

  @ApiProperty({ format: 'date-time' })
  fin!: Date;

  @ApiProperty({ example: '45.00', description: 'Costo del alquiler.' })
  costoEstimado!: string;

  @ApiProperty({ example: '20.00' })
  depositoMonto!: string;

  @ApiProperty({ format: 'date-time' })
  creadaAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  decididaAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  motivoRechazo!: string | null;

  static fromRow(row: LandlordRequestRow): LandlordRequestDto {
    return {
      id: row.id,
      estado: row.status,
      publicacion: { id: row.listing.id, nombre: row.listing.name },
      arrendatario: {
        id: row.tenant.id,
        // Las cuentas creadas por el registro siempre tienen perfil; el
        // correo es el respaldo para las que no (las del seed).
        nombre: row.tenant.profile?.name ?? row.tenant.email,
      },
      inicio: row.startAt,
      fin: row.endAt,
      costoEstimado: row.rentalCost.toFixed(2),
      depositoMonto: row.depositAmount.toFixed(2),
      creadaAt: row.createdAt,
      decididaAt: row.decidedAt,
      motivoRechazo: row.rejectionReason,
    };
  }
}

/** Página de "Mis solicitudes". */
export class LandlordRequestsPageDto {
  @ApiProperty({ type: [LandlordRequestDto] })
  items!: LandlordRequestDto[];

  @ApiProperty({
    example: 1,
    description:
      'Total de solicitudes que cumplen el filtro (no solo las de esta página).',
  })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 12 })
  limit!: number;
}
