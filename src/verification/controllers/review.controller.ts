import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
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

const DOCUMENT_UNAVAILABLE = 'El documento no está disponible.';

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
  @ApiNotFoundResponse({
    description: 'La solicitud no existe o su archivo ya no está disponible.',
  })
  async document(
    @Param('id', ID_PIPE) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const verification = await this.reviewService.findForDocument(id);
    // Si el archivo falta en disco, sendFile respondería con su propio error,
    // que incluye la ruta absoluta del servidor. Se responde un 404 genérico.
    if (!(await this.storage.exists(verification.documentKey))) {
      throw new NotFoundException(DOCUMENT_UNAVAILABLE);
    }
    res.type(this.storage.contentType(verification.documentKey));
    // Que el navegador no lo guarde en caché compartida: es un dato personal.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    // El tipo lo decide el servidor (por la firma, al subirlo): que el
    // navegador no intente adivinar otro.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(
      this.storage.absolutePath(verification.documentKey),
      (error) => {
        // Por si el archivo desaparece entre la comprobación y el envío.
        if (error && !res.headersSent) {
          res.status(404).json({
            statusCode: 404,
            message: DOCUMENT_UNAVAILABLE,
            error: 'Not Found',
          });
        }
      },
    );
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
