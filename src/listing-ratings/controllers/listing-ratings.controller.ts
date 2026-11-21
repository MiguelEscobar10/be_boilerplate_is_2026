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
import {
  CreateListingRatingDto,
  ListingRatingCreatedDto,
  ListingRatingDetailDto,
} from '@ListingRatings/dto';
import { ListingRatingsService } from '@ListingRatings/services';

const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la reserva debe ser un UUID.'),
});

/**
 * Calificación del bien y del arrendador (H17). Comparte el prefijo
 * `reservas` con otros módulos; esta es la única ruta con `/calificacion`.
 */
@ApiTags('reseñas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reservas')
export class ListingRatingsController {
  constructor(private readonly ratings: ListingRatingsService) {}

  @Roles('ARRENDATARIO')
  @Post(':id/calificacion')
  @ApiOperation({
    summary: 'Califica el bien y al arrendador de una reserva COMPLETADA',
    description:
      'Solo el arrendatario de la reserva, una vez por reserva: un puntaje de 1 a 5 para el bien, otro para el arrendador y un comentario opcional de hasta 500 caracteres.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: ListingRatingCreatedDto })
  @ApiBadRequestResponse({
    description:
      'Puntaje fuera de 1 a 5 o no entero, comentario de más de 500 caracteres, campos extra o id que no es UUID.',
  })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendatario.' })
  @ApiNotFoundResponse({
    description: 'La reserva no existe o es de otro arrendatario.',
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
    @Body() dto: CreateListingRatingDto,
  ): Promise<ListingRatingCreatedDto> {
    return this.ratings.rate(id, user.id, dto);
  }

  @Roles('ARRENDATARIO')
  @Get(':id/calificacion')
  @ApiOperation({
    summary: 'Consulta la calificación que dejaste en una reserva propia',
    description:
      'Sirve para saber si la reserva ya fue calificada. 404 con codigo CALIFICACION_NO_REGISTRADA si es tuya y aún no la calificas.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ListingRatingDetailDto })
  @ApiBadRequestResponse({ description: 'El id no es un UUID.' })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendatario.' })
  @ApiNotFoundResponse({
    description:
      'La reserva no existe o es de otro arrendatario (sin codigo); o es tuya y no la calificaste, con codigo CALIFICACION_NO_REGISTRADA.',
  })
  find(
    @CurrentUser() user: User,
    @Param('id', ID_PIPE) id: string,
  ): Promise<ListingRatingDetailDto> {
    return this.ratings.findRating(id, user.id);
  }
}
