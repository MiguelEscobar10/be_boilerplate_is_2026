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
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import type { User } from '@PrismaClient';
import {
  BlockListResponseDto,
  BlockResponseDto,
  CreateBlockDto,
} from '@Availability/dto';
import { BlocksService } from '@Availability/services';

const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la publicación debe ser un UUID.'),
});

/**
 * Bloqueos de fechas del arrendador (H14). Comparte el prefijo
 * `publicaciones` con ListingsController y AvailabilityController; esta es la
 * única ruta con `/bloqueos`.
 */
@ApiTags('disponibilidad')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('publicaciones')
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Roles('ARRENDADOR')
  @Post(':id/bloqueos')
  @ApiOperation({
    summary: 'Bloquea un rango de fechas de una publicación propia',
    description:
      'No se puede bloquear un rango que se cruce con una reserva CONFIRMADA o EN_CURSO. Las solicitudes PENDIENTE no cambian.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: BlockResponseDto })
  @ApiBadRequestResponse({
    description:
      'Fecha sin zona, con otro formato o que no existe, fin igual o anterior al inicio, motivo de más de 200 caracteres o id que no es UUID.',
  })
  @ApiForbiddenResponse({
    description:
      'La cuenta no es de arrendador o la publicación es de otro arrendador.',
  })
  @ApiNotFoundResponse({ description: 'La publicación no existe.' })
  @ApiConflictResponse({
    description:
      'RANGO_CON_RESERVA: el rango se cruza con una reserva CONFIRMADA o EN_CURSO.',
  })
  create(
    @CurrentUser() user: User,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: CreateBlockDto,
  ): Promise<BlockResponseDto> {
    return this.blocksService.create(id, user.id, dto);
  }

  @Roles('ARRENDADOR')
  @Get(':id/bloqueos')
  @ApiOperation({
    summary: 'Bloqueos de una publicación propia, con su motivo',
    description:
      'Para la tabla de la pantalla de bloqueos (FE-14.1). El calendario público usa /disponibilidad, que no muestra el motivo.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BlockListResponseDto })
  @ApiForbiddenResponse({
    description:
      'La cuenta no es de arrendador o la publicación es de otro arrendador.',
  })
  @ApiNotFoundResponse({ description: 'La publicación no existe.' })
  list(
    @CurrentUser() user: User,
    @Param('id', ID_PIPE) id: string,
  ): Promise<BlockListResponseDto> {
    return this.blocksService.listForOwner(id, user.id);
  }
}
