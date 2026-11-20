import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import type { User } from '@PrismaClient';
import { CreateReservationDto, ReservationDto } from '@Reservations/dto';
import { ReservationsService } from '@Reservations/services';

/**
 * Un id que no es UUID da 400: es un error de sintaxis de la request. Sin el
 * pipe, Postgres respondería con un error de tipo y el cliente vería un 500.
 */
const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la reserva debe ser un UUID.'),
});

/**
 * Solicitud y consulta de reservas (H03). Comparte el prefijo `reservas` con
 * la decisión (H04), la entrega, la devolución y el pago; las rutas no chocan
 * porque cada una tiene su propio sufijo.
 */
@ApiTags('reservas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reservas')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Roles('ARRENDATARIO')
  @Post()
  @ApiOperation({
    summary: 'Solicita una reserva',
    description:
      'Crea la solicitud en estado PENDIENTE para el período pedido, con el costo calculado por el servidor, y avisa al arrendador. Una solicitud PENDIENTE no aparta las fechas.',
  })
  @ApiCreatedResponse({ type: ReservationDto })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, fin igual o anterior al inicio o FECHA_PASADA (el inicio ya pasó).',
  })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendatario.' })
  @ApiNotFoundResponse({
    description: 'La publicación no existe o está desactivada.',
  })
  @ApiConflictResponse({
    description:
      'PERIODO_NO_DISPONIBLE: el período choca con una reserva confirmada, en curso o con un bloqueo.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'VERIFICACION_REQUERIDA: la publicación solo acepta usuarios verificados.',
  })
  create(
    @CurrentUser() user: User,
    @Body() dto: CreateReservationDto,
  ): Promise<ReservationDto> {
    return this.reservations.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de una reserva propia',
    description:
      'Solo el arrendatario que la solicitó o el dueño de la publicación. Para cualquier otra persona responde 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReservationDto })
  @ApiBadRequestResponse({ description: 'El id no es un UUID.' })
  @ApiNotFoundResponse({ description: 'La reserva no existe o no es tuya.' })
  findOne(
    @CurrentUser() user: User,
    @Param('id', ID_PIPE) id: string,
  ): Promise<ReservationDto> {
    return this.reservations.findOne(id, user.id);
  }
}
