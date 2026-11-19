import {
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import {
  CreateReturnDto,
  ReturnCreatedDto,
  ReturnResponseDto,
} from '@Returns/dto';
import { ReturnsService } from '@Returns/services';
import type { User } from '@PrismaClient';

/** Devolución del equipo o fin del uso del espacio (H09, BE-09.1). */
@ApiTags('reservas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reservas')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Roles('ARRENDADOR')
  @Post(':id/devolucion')
  @ApiOperation({ summary: 'Registra la devolución de una reserva EN_CURSO' })
  @ApiCreatedResponse({ type: ReturnCreatedDto })
  @ApiBadRequestResponse({
    description:
      'Fecha inválida o anterior a la entrega; estado final fuera del catálogo; daños que no corresponden al estado final.',
  })
  @ApiForbiddenResponse({
    description:
      'La cuenta no es de arrendador o la reserva no es de un bien suyo.',
  })
  @ApiNotFoundResponse({ description: 'La reserva no existe.' })
  @ApiConflictResponse({
    description: 'La reserva no tiene entrega previa o ya tiene devolución.',
  })
  async register(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReturnDto,
  ): Promise<ReturnCreatedDto> {
    return ReturnCreatedDto.fromEntity(
      await this.returnsService.register(id, user.id, dto),
    );
  }

  /** Para el arrendador y el arrendatario de la reserva; para el resto, 404. */
  @Get(':id/devolucion')
  @ApiOperation({ summary: 'Consulta la devolución de una reserva propia' })
  @ApiOkResponse({ type: ReturnResponseDto })
  @ApiNotFoundResponse({
    description: 'La reserva no existe, no es tuya o no tiene devolución.',
  })
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReturnResponseDto> {
    return ReturnResponseDto.fromEntity(
      await this.returnsService.findForParticipant(id, user.id),
    );
  }
}
