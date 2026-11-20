import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SimulatedPayment } from '@PrismaClient';

/** Resultado de un intento de pago simulado (H05). */
export class PagoSimuladoResponseDto {
  @ApiProperty({ format: 'uuid' })
  pagoId!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({
    example: '50.00',
    description:
      'Costo del alquiler + depósito, leídos de la reserva. String con 2 decimales.',
  })
  montoTotal!: string;

  @ApiProperty({ enum: ['APROBADO', 'RECHAZADO'], example: 'APROBADO' })
  estado!: 'APROBADO' | 'RECHAZADO';

  @ApiProperty({ example: true })
  simulado!: true;

  @ApiProperty({ example: 1, minimum: 1, maximum: 3 })
  intento!: number;

  @ApiPropertyOptional({
    example: 'Tarjeta rechazada por la pasarela de prueba',
    description:
      'Solo si es RECHAZADO. La reserva sigue CONFIRMADA y el cobro queda pendiente.',
  })
  motivo?: string;

  static fromEntity(pago: SimulatedPayment): PagoSimuladoResponseDto {
    const respuesta: PagoSimuladoResponseDto = {
      pagoId: pago.id,
      reservaId: pago.reservationId,
      // Los Decimal se devuelven como string para no perder precisión en JSON.
      montoTotal: pago.totalAmount.toFixed(2),
      estado: pago.status === 'APROBADO' ? 'APROBADO' : 'RECHAZADO',
      simulado: true,
      intento: pago.attemptNumber,
    };
    if (pago.status === 'RECHAZADO' && pago.rejectionReason) {
      respuesta.motivo = pago.rejectionReason;
    }
    return respuesta;
  }
}

/** Forma de los errores con código de BE-05.1 (para Swagger). */
export class ErrorPagoDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({
    example: 'Ya se usaron los 3 intentos de pago de esta reserva.',
  })
  message!: string;

  @ApiProperty({ example: 'Conflict' })
  error!: string;

  @ApiProperty({
    enum: [
      'TARJETA_NO_VALIDA',
      'RESERVA_NO_CONFIRMADA',
      'PAGO_YA_APROBADO',
      'PAGO_EN_PROCESO',
      'INTENTOS_AGOTADOS',
      'PAGO_NO_REGISTRADO',
    ],
    example: 'INTENTOS_AGOTADOS',
  })
  codigo!: string;
}
