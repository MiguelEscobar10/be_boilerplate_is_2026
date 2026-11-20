import {
  BadRequestException,
  Body,
  Controller,
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
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import type { User } from '@PrismaClient';
import {
  CreateTenantRatingDto,
  TenantRatingCreatedDto,
} from '@TenantRatings/dto';
import { TenantRatingsService } from '@TenantRatings/services';

const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la reserva debe ser un UUID.'),
});

/**
 * Calificación del arrendatario (H18). Comparte el prefijo `reservas` con
 * otros módulos; esta es la única ruta con `/calificacion-arrendatario`.
 */
@ApiTags('reseñas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reservas')
export class TenantRatingsController {
  constructor(private readonly ratings: TenantRatingsService) {}

  @Roles('ARRENDADOR')
  @Post(':id/calificacion-arrendatario')
  @ApiOperation({
    summary: 'Califica al arrendatario de una reserva COMPLETADA',
    description:
      'Solo el arrendador dueño del bien, una vez por reserva: puntaje de 1 a 5 y comentario opcional de hasta 500 caracteres.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: TenantRatingCreatedDto })
  @ApiBadRequestResponse({
    description:
      'Puntaje fuera de 1 a 5 o no entero, comentario de más de 500 caracteres o id que no es UUID.',
  })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendador.' })
  @ApiNotFoundResponse({
    description: 'La reserva no existe o es de un bien de otro arrendador.',
  })
  @ApiConflictResponse({
    description: 'RESERVA_YA_CALIFICADA: la reserva ya fue calificada.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'RESERVA_NO_COMPLETADA: la reserva no está COMPLETADA.',
  })
  rate(
    @CurrentUser() user: User,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: CreateTenantRatingDto,
  ): Promise<TenantRatingCreatedDto> {
    return this.ratings.rate(id, user.id, dto);
  }
}
