import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '@Auth/decorators';
import {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
} from '@Availability/dto';
import { AvailabilityService } from '@Availability/services';

/**
 * Un id que no es UUID da 400, igual que una fecha mal escrita: es un error de
 * sintaxis de la request. Sin el pipe, Postgres respondería con un error de
 * tipo y el cliente vería un 500.
 */
const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la publicación debe ser un UUID.'),
});

/**
 * Disponibilidad de una publicación (H13). Comparte el prefijo
 * `publicaciones` con ListingsController, pero sus rutas no chocan: aquella
 * usa `:id` y `:id/imagenes/:orden`.
 */
@ApiTags('disponibilidad')
@Controller('publicaciones')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  /**
   * Ruta pública: el calendario se ve en el detalle del bien sin iniciar
   * sesión. Por eso la respuesta solo dice qué períodos están ocupados y por
   * qué tipo de cosa, nunca quién reservó ni el motivo de un bloqueo.
   */
  @Public()
  @Get(':id/disponibilidad')
  @ApiOperation({
    summary: 'Períodos ocupados de una publicación en un rango de fechas',
    description:
      'Fechas inclusivas en hora de El Salvador; rango máximo de 92 días. Solo cuentan las reservas CONFIRMADA o EN_CURSO y los bloqueos del arrendador: una solicitud PENDIENTE no ocupa fechas.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  @ApiBadRequestResponse({
    description:
      'Falta una fecha, tiene formato inválido o no existe, hasta es anterior a desde, o el rango pasa de 92 días.',
  })
  @ApiNotFoundResponse({
    description: 'La publicación no existe o está desactivada.',
  })
  find(
    @Param('id', ID_PIPE) id: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    return this.availabilityService.findForListing(id, query);
  }
}
