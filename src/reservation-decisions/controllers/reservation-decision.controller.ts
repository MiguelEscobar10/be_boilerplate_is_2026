import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import type { User } from '@PrismaClient';
import {
  DecideReservationDto,
  DecisionResponseDto,
} from '@ReservationDecisions/dto';
import { ReservationDecisionsService } from '@ReservationDecisions/services';

/**
 * Un id que no es UUID da 400: es un error de sintaxis de la request. Sin el
 * pipe, Postgres respondería con un error de tipo y el cliente vería un 500.
 */
const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la reserva debe ser un UUID.'),
});

/**
 * Decisión del arrendador sobre una solicitud (H04). Comparte el prefijo
 * `reservas` con el módulo de solicitar reservas (BE-03.1); las rutas no
 * chocan porque esta es la única con `/decision`.
 */
@ApiTags('reservas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reservas')
export class ReservationDecisionController {
  constructor(private readonly decisions: ReservationDecisionsService) {}

  @Roles('ARRENDADOR')
  @Patch(':id/decision')
  @ApiOperation({
    summary: 'Aprueba o rechaza una solicitud de reserva PENDIENTE',
    description:
      'Solo el dueño de la publicación. Al aprobar pasa a CONFIRMADA si las fechas siguen libres; al rechazar pasa a RECHAZADA con un motivo opcional. En los dos casos se avisa al arrendatario. Las demás solicitudes PENDIENTE que se cruzan no cambian.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DecisionResponseDto })
  @ApiBadRequestResponse({
    description:
      'Decisión inválida, motivo de más de 500 caracteres, motivo al aprobar o id que no es UUID.',
  })
  @ApiForbiddenResponse({
    description:
      'La cuenta no es de arrendador o la reserva es de una publicación ajena.',
  })
  @ApiNotFoundResponse({ description: 'La reserva no existe.' })
  @ApiConflictResponse({
    description:
      'SOLICITUD_YA_DECIDIDA: ya fue aprobada o rechazada. CONFLICTO_DISPONIBILIDAD: las fechas ya están ocupadas por otra reserva confirmada o por un bloqueo.',
  })
  decide(
    @CurrentUser() user: User,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: DecideReservationDto,
  ): Promise<DecisionResponseDto> {
    return this.decisions.decide(id, user.id, dto);
  }
}
