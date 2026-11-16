import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Roles } from '@Auth/decorators';
import {
  DecisionDto,
  ListVerificationsQueryDto,
  VerificationCreatedDto,
  VerificationQueueItemDto,
} from '@Verification/dto';
import { DocumentStorageService, ReviewService } from '@Verification/services';
import type { User } from '@PrismaClient';

const ID_PIPE = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException('El id de la verificación debe ser un UUID.'),
});

/**
 * Revisión manual de documentos de identidad (H07, BE-07.2).
 *
 * Solo el usuario REVISOR (lo crea el seed; nadie puede registrarse con ese
 * rol). Cualquier otro rol recibe 403 y sin sesión 401.
 */
@ApiTags('verificaciones')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@ApiForbiddenResponse({ description: 'La cuenta no es REVISOR.' })
@Roles('REVISOR')
@Controller('verificaciones')
export class ReviewController {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly storage: DocumentStorageService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista las solicitudes de un estado (por defecto, PENDIENTE)',
    description: 'En orden de llegada. No incluye el documento.',
  })
  @ApiOkResponse({ type: [VerificationQueueItemDto] })
  @ApiBadRequestResponse({ description: 'Estado inválido.' })
  async list(
    @Query() query: ListVerificationsQueryDto,
  ): Promise<VerificationQueueItemDto[]> {
    const items = await this.reviewService.list(query.estado);
    return items.map((item) => VerificationQueueItemDto.fromEntity(item));
  }

  /** El archivo nunca tiene URL pública: solo sale por esta ruta. */
  @Get(':id/documento')
  @ApiOperation({ summary: 'Abre el documento de una solicitud' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf', 'image/png', 'image/jpeg')
  @ApiOkResponse({ description: 'El archivo, con su Content-Type.' })
  @ApiNotFoundResponse({ description: 'La solicitud no existe.' })
  async document(
    @Param('id', ID_PIPE) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const verification = await this.reviewService.findForDocument(id);
    res.type(this.storage.contentType(verification.documentKey));
    // Que el navegador no lo guarde en caché compartida: es un dato personal.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(this.storage.absolutePath(verification.documentKey));
  }

  @Patch(':id/decision')
  @ApiOperation({ summary: 'Aprueba o rechaza una solicitud PENDIENTE' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: VerificationCreatedDto })
  @ApiBadRequestResponse({
    description: 'Decisión inválida, motivo al aprobar o motivo vacío/largo.',
  })
  @ApiNotFoundResponse({ description: 'La solicitud no existe.' })
  @ApiConflictResponse({ description: 'La solicitud ya fue resuelta.' })
  async decide(
    @CurrentUser() reviewer: User,
    @Param('id', ID_PIPE) id: string,
    @Body() dto: DecisionDto,
  ): Promise<VerificationCreatedDto> {
    const decided = await this.reviewService.decide(
      id,
      reviewer.id,
      dto.decision,
      dto.motivo,
    );
    return VerificationCreatedDto.fromEntity(decided);
  }
}
