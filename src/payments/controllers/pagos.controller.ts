import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import {
  CrearPagoSimuladoDto,
  ErrorPagoDto,
  PagoSimuladoResponseDto,
} from '@Payments/dto';
import { PagosService } from '@Payments/services';
import type { User } from '@PrismaClient';

@ApiTags('pagos')
@ApiBearerAuth()
@Controller()
export class PagosController {
  constructor(private readonly pagos: PagosService) {}

  /** Pago simulado de una reserva CONFIRMADA (H05). */
  @Roles('ARRENDATARIO')
  @Post('reservas/:id/pagos/simulados')
  @ApiOperation({
    summary: 'Paga una reserva confirmada con una tarjeta de prueba',
    description:
      'La pasarela simulada responde después de 2 segundos y decide por los últimos 4 dígitos: 4242 aprueba, 0002 rechaza. El monto (alquiler + depósito) sale de la reserva. Máximo 3 intentos por reserva; un rechazo no cambia el estado de la reserva. Solo se guardan los últimos 4 dígitos de la tarjeta.',
  })
  @ApiCreatedResponse({
    type: PagoSimuladoResponseDto,
    description: 'Intento registrado, APROBADO o RECHAZADO (con motivo).',
  })
  @ApiBadRequestResponse({
    type: ErrorPagoDto,
    description:
      'Datos inválidos (formato del número, vencimiento MM/AA, cvv, campos extra o id que no es UUID), en el formato por defecto; o tarjeta que no es de prueba, con codigo TARJETA_NO_VALIDA.',
  })
  @ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
  @ApiForbiddenResponse({ description: 'Solo un arrendatario paga reservas.' })
  @ApiNotFoundResponse({
    description: 'La reserva no existe o es de otro arrendatario.',
  })
  @ApiConflictResponse({
    type: ErrorPagoDto,
    description:
      'codigo RESERVA_NO_CONFIRMADA, PAGO_YA_APROBADO, PAGO_EN_PROCESO (otro intento de la misma reserva está esperando la pasarela) o INTENTOS_AGOTADOS.',
  })
  pagar(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) reservaId: string,
    @Body() dto: CrearPagoSimuladoDto,
  ): Promise<PagoSimuladoResponseDto> {
    // Solo los últimos 4 dígitos salen del controller: el número completo y
    // el código de seguridad no se guardan ni se pasan a nadie.
    return this.pagos.pagar(reservaId, user.id, dto.numeroTarjeta.slice(-4));
  }
}
