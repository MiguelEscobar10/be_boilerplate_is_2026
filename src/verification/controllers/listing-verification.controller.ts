import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@Auth/decorators';
import {
  RequiresVerificationResponseDto,
  UpdateRequiresVerificationDto,
} from '@Verification/dto';
import { VerificationRequirementService } from '@Verification/services';
import type { User } from '@PrismaClient';

/**
 * Opción "requiere verificación" de una publicación (H19, BE-19.1).
 *
 * Vive en el módulo de verificación y no en ListingsController (BE-01.1): solo
 * toca `requires_verification`. Comparte el prefijo `publicaciones`.
 */
@ApiTags('publicaciones')
@ApiBearerAuth()
@Controller('publicaciones')
export class ListingVerificationController {
  constructor(private readonly requirements: VerificationRequirementService) {}

  @Roles('ARRENDADOR')
  @Patch(':id/requiere-verificacion')
  @ApiOperation({
    summary:
      'Activa o desactiva "requiere verificación" en una publicación propia',
  })
  @ApiOkResponse({ type: RequiresVerificationResponseDto })
  @ApiBadRequestResponse({
    description:
      'requiereVerificacion falta o no es booleano, o el id no es UUID.',
  })
  @ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
  @ApiForbiddenResponse({
    description: 'La cuenta no es de arrendador o la publicación no es suya.',
  })
  @ApiNotFoundResponse({ description: 'La publicación no existe.' })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequiresVerificationDto,
  ): Promise<RequiresVerificationResponseDto> {
    const listing = await this.requirements.setRequiresVerification(
      id,
      user.id,
      dto.requiereVerificacion,
    );
    return RequiresVerificationResponseDto.fromEntity(listing);
  }
}
