import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SimulatedPayment } from '@PrismaClient';

/** Último intento de pago de una reserva propia (H06). */
export class UltimoPagoResponseDto {
  @ApiProperty({ format: 'uuid' })
  pagoId!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({
    example: '65.00',
    description:
      'Costo del alquiler + depósito. String con 2 decimales, igual que en el pago.',
  })
  montoTotal!: string;

  @ApiProperty({
    example: '2026-11-12T16:00:00.000Z',
    description: 'Fecha del intento, en UTC.',
  })
  fechaRegistro!: string;

  @ApiProperty({ enum: ['PENDIENTE', 'APROBADO', 'RECHAZADO'] })
  estado!: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';

  @ApiProperty({ example: true })
  simulado!: true;

  @ApiPropertyOptional({
    example: 'Tarjeta rechazada por la pasarela de prueba',
    description: 'Solo si es RECHAZADO.',
  })
  motivo?: string;

  static fromEntity(pago: SimulatedPayment): UltimoPagoResponseDto {
    const respuesta: UltimoPagoResponseDto = {
      pagoId: pago.id,
      reservaId: pago.reservationId,
      montoTotal: pago.totalAmount.toFixed(2),
      fechaRegistro: pago.createdAt.toISOString(),
      estado: pago.status,
      simulado: true,
    };
    if (pago.status === 'RECHAZADO' && pago.rejectionReason) {
      respuesta.motivo = pago.rejectionReason;
    }
    return respuesta;
  }
}
