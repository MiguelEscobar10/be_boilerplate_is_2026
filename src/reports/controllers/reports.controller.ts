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
import { OccupancyQueryDto, OccupancyReportDto } from '@Reports/dto';
import { ReportsService } from '@Reports/services';
import type { User } from '@PrismaClient';

/** Reportes del arrendador (H22, BE-22.1). */
@ApiTags('reportes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reportes')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Roles('ARRENDADOR')
  @Get('ocupacion')
  @ApiOperation({
    summary: 'Tasa de ocupación de los bienes del arrendador en un período',
    description:
      'Fechas inclusivas en hora de El Salvador; por defecto, el mes en curso. Rango máximo de 366 días.',
  })
  @ApiOkResponse({ type: OccupancyReportDto })
  @ApiBadRequestResponse({
    description:
      'Fecha con formato inválido o inexistente, desde posterior a hasta, o rango de más de 366 días.',
  })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendador.' })
  occupancy(
    @CurrentUser() user: User,
    @Query() query: OccupancyQueryDto,
  ): Promise<OccupancyReportDto> {
    return this.reportsService.occupancyFor(user.id, query);
  }
}
