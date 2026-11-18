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
import { IncomeQueryDto, IncomeReportDto } from '@Income/dto';
import { IncomeService } from '@Income/services';
import type { User } from '@PrismaClient';

/** Reporte de ingresos del arrendador (H21, BE-21.1). */
@ApiTags('reportes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reportes')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  @Roles('ARRENDADOR')
  @Get('ingresos')
  @ApiOperation({
    summary: 'Ingresos por bien del arrendador en un período',
    description:
      'Suma el costo de alquiler de los pagos APROBADO (sin depósito) de los bienes del arrendador autenticado. ' +
      'Fechas inclusivas en hora de El Salvador; la que falte sale del mes en curso. Rango máximo de 366 días. ' +
      'Los importes van como texto con 2 decimales.',
  })
  @ApiOkResponse({ type: IncomeReportDto })
  @ApiBadRequestResponse({
    description:
      'Fecha con formato inválido o inexistente, desde posterior a hasta, rango de más de 366 días o un parámetro no admitido.',
  })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendador.' })
  income(
    @CurrentUser() user: User,
    @Query() query: IncomeQueryDto,
  ): Promise<IncomeReportDto> {
    return this.incomeService.reportFor(user.id, query);
  }
}
