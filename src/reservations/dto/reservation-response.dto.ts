import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationStatus } from '@PrismaClient';
import { toLocalIso } from '@Availability/services';
import type { ReservationDetail } from '@Reservations/repositories';

class ReservationListingDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Taladro percutor' })
  nombre!: string;
}

/**
 * Una reserva, en la respuesta de POST /reservas y de GET /reservas/:id.
 *
 * Los importes viajan como texto con dos decimales (`"45.00"`) para no perder
 * los ceros ni redondear en el cliente, igual que en el panel del arrendador.
 */
export class ReservationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ReservationStatus,
    description:
      'Una solicitud nueva queda PENDIENTE: todavía no aparta las fechas.',
  })
  estado!: ReservationStatus;

  @ApiProperty({ type: ReservationListingDto })
  publicacion!: ReservationListingDto;

  @ApiProperty({
    example: '2026-11-12T09:00:00-06:00',
    description: 'Inicio, en hora de El Salvador.',
  })
  inicio!: string;

  @ApiProperty({ example: '2026-11-12T12:00:00-06:00' })
  fin!: string;

  @ApiProperty({
    example: '45.00',
    description:
      'Costo estimado: tarifa × unidades de cobro, con dos decimales. No incluye el depósito.',
  })
  costoAlquiler!: string;

  @ApiProperty({ example: '20.00', description: 'Depósito, aparte del costo.' })
  depositoMonto!: string;

  @ApiProperty({ format: 'date-time' })
  creadaAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  decididaAt!: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Motivo que escribió el arrendador al rechazar, si hay.',
  })
  motivoRechazo!: string | null;

  static fromRow(row: ReservationDetail): ReservationDto {
    return {
      id: row.id,
      estado: row.status,
      publicacion: { id: row.listing.id, nombre: row.listing.name },
      inicio: toLocalIso(row.startAt),
      fin: toLocalIso(row.endAt),
      costoAlquiler: row.rentalCost.toFixed(2),
      depositoMonto: row.depositAmount.toFixed(2),
      creadaAt: row.createdAt,
      decididaAt: row.decidedAt,
      motivoRechazo: row.rejectionReason,
    };
  }
}
