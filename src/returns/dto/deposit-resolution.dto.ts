import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import type { DepositStatus, ReservationStatus } from '@PrismaClient';
import type { DepositState } from '@Returns/repositories';

/** Cuerpo de `POST /reservas/{id}/deposito/resolucion`. */
export class ResolveDepositDto {
  @ApiProperty({
    example: 5.0,
    description:
      'Importe que se retiene, con dos decimales como máximo. 0 libera la garantía completa.',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    {
      message: 'El monto retenido debe ser un número con hasta dos decimales.',
    },
  )
  @Min(0, { message: 'El monto retenido no puede ser negativo.' })
  montoRetenido!: number;

  @ApiPropertyOptional({
    example: 'Daño reportado',
    description: 'Obligatorio (1 a 500 caracteres) si se retiene algo.',
  })
  @IsOptional()
  @IsString({ message: 'El motivo debe ser un texto.' })
  motivo?: string;
}

const ESTADOS_GARANTIA = ['PENDIENTE', 'LIBERADA', 'RETENIDA'] as const;

/**
 * Estado de la garantía de una reserva. Es la respuesta de la resolución y de
 * la consulta; sin resolución, `estadoGarantia` es PENDIENTE y los montos
 * retenido y liberado van en null.
 */
export class DepositResolutionDto {
  @ApiProperty({ example: 20.0 })
  depositoOriginal!: number;

  @ApiProperty({ example: 5.0, nullable: true, type: Number })
  montoRetenido!: number | null;

  @ApiProperty({ example: 15.0, nullable: true, type: Number })
  montoLiberado!: number | null;

  @ApiProperty({ enum: ESTADOS_GARANTIA, example: 'RETENIDA' })
  estadoGarantia!: DepositStatus | 'PENDIENTE';

  @ApiProperty({ example: 'Daño reportado', nullable: true, type: String })
  motivo!: string | null;

  @ApiProperty({ example: 'COMPLETADA' })
  estadoReserva!: ReservationStatus;

  @ApiProperty({
    example: true,
    description: 'Es un registro simulado: no se mueve dinero.',
  })
  simulado!: true;

  static fromState(state: DepositState): DepositResolutionDto {
    const { resolution } = state;
    return {
      depositoOriginal: (
        resolution?.originalDeposit ?? state.depositAmount
      ).toNumber(),
      montoRetenido: resolution?.retainedAmount.toNumber() ?? null,
      montoLiberado: resolution?.releasedAmount.toNumber() ?? null,
      estadoGarantia: resolution?.status ?? 'PENDIENTE',
      motivo: resolution?.reason ?? null,
      estadoReserva: state.status,
      simulado: true,
    };
  }
}
