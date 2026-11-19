import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import { DepositResolutionDto, ResolveDepositDto } from '@Returns/dto';
import { DepositResolutionsService } from '@Returns/services';
import type { User } from '@PrismaClient';

/** Resolución del depósito de garantía y cierre de la reserva (H09, BE-09.2). */
@ApiTags('reservas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reservas')
export class DepositResolutionsController {
  constructor(private readonly depositsService: DepositResolutionsService) {}

  @Roles('ARRENDADOR')
  @Post(':id/deposito/resolucion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resuelve la garantía y pasa la reserva a COMPLETADA (simulado)',
  })
  @ApiOkResponse({ type: DepositResolutionDto })
  @ApiBadRequestResponse({
    description:
      'Monto negativo, con más de dos decimales o que no es un número; retención sin motivo; motivo de más de 500.',
  })
  @ApiForbiddenResponse({
    description:
      'La cuenta no es de arrendador o la reserva no es de un bien suyo.',
  })
  @ApiNotFoundResponse({ description: 'La reserva no existe.' })
  @ApiConflictResponse({ description: 'La garantía ya está resuelta.' })
  @ApiUnprocessableEntityResponse({
    description:
      'codigo DEVOLUCION_NO_REGISTRADA, RETENCION_SUPERA_DEPOSITO o RETENCION_SIN_OBSERVACIONES.',
  })
  async resolve(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDepositDto,
  ): Promise<DepositResolutionDto> {
    return DepositResolutionDto.fromState(
      await this.depositsService.resolve(id, user.id, dto),
    );
  }

  /** Para el arrendador y el arrendatario de la reserva; para el resto, 404. */
  @Get(':id/deposito/resolucion')
  @ApiOperation({
    summary: 'Consulta el estado de la garantía de una reserva propia',
  })
  @ApiOkResponse({ type: DepositResolutionDto })
  @ApiNotFoundResponse({ description: 'La reserva no existe o no es tuya.' })
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepositResolutionDto> {
    return DepositResolutionDto.fromState(
      await this.depositsService.findForParticipant(id, user.id),
    );
  }
}
