import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import type { User } from '@PrismaClient';
import {
  LandlordRequestsPageDto,
  ListLandlordRequestsQueryDto,
} from '@ReservationDecisions/dto';
import { ReservationDecisionsService } from '@ReservationDecisions/services';

/** Panel "Mis solicitudes" del arrendador (H04, criterio 1). */
@ApiTags('reservas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('arrendador')
export class LandlordRequestsController {
  constructor(private readonly decisions: ReservationDecisionsService) {}

  @Roles('ARRENDADOR')
  @Get('solicitudes')
  @ApiOperation({
    summary: 'Solicitudes de reserva de las publicaciones del arrendador',
    description:
      'De la más reciente a la más antigua, de 12 en 12 por página, con filtro opcional por estado. Solo incluye solicitudes de publicaciones propias.',
  })
  @ApiOkResponse({ type: LandlordRequestsPageDto })
  @ApiBadRequestResponse({
    description:
      'Estado o paginación inválidos, o un parámetro que no existe en la query.',
  })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendador.' })
  list(
    @CurrentUser() user: User,
    @Query() query: ListLandlordRequestsQueryDto,
  ): Promise<LandlordRequestsPageDto> {
    return this.decisions.listForLandlord(user.id, query);
  }
}
