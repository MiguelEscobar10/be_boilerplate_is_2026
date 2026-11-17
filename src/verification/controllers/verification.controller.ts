import {
  Controller,
  Get,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser, Roles } from '@Auth/decorators';
import {
  VerificationCreatedDto,
  VerificationResponseDto,
} from '@Verification/dto';
import { DocumentUploadErrorsFilter } from '@Verification/filters';
import {
  MAX_DOCUMENT_BYTES,
  VerificationService,
} from '@Verification/services';
import type { UploadedDocument } from '@Verification/services';
import type { User } from '@PrismaClient';

/**
 * Verificación de identidad del usuario autenticado (H07, BE-07.1).
 *
 * Solo para cuentas ARRENDATARIO (sección 2.5, supuesto 2: el arrendador no se
 * verifica); el resto recibe 403. Ninguna respuesta incluye el documento ni su
 * ruta: el archivo solo lo abre el REVISOR (BE-07.2).
 */
@ApiTags('verificaciones')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@ApiForbiddenResponse({ description: 'La cuenta no es de arrendatario.' })
@Roles('ARRENDATARIO')
@Controller('usuarios/me/verificaciones')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  /** Recibe multipart/form-data con el archivo en `documento`. */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['documento'],
      properties: {
        documento: {
          type: 'string',
          format: 'binary',
          description: 'JPG, PNG o PDF de máximo 5 MB.',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Envía el documento de identidad para revisión' })
  @ApiCreatedResponse({ type: VerificationCreatedDto })
  @ApiBadRequestResponse({
    description: 'Falta el archivo, no es JPG, PNG ni PDF o pesa más de 5 MB.',
  })
  @ApiConflictResponse({
    description:
      'Ya hay una solicitud PENDIENTE: hay que esperar la respuesta.',
  })
  @UseFilters(DocumentUploadErrorsFilter)
  @UseInterceptors(
    FileInterceptor('documento', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    }),
  )
  async submit(
    @CurrentUser() user: User,
    @UploadedFile() file?: UploadedDocument,
  ): Promise<VerificationCreatedDto> {
    const verification = await this.verificationService.submit(user.id, file);
    return VerificationCreatedDto.fromEntity(verification);
  }

  @Get('ultima')
  @ApiOperation({
    summary: 'Consulta el estado de la última solicitud propia',
    description:
      'Devuelve el estado y, si fue RECHAZADA, el motivo. Nunca el documento.',
  })
  @ApiOkResponse({ type: VerificationResponseDto })
  @ApiNotFoundResponse({ description: 'Todavía no envió ninguna solicitud.' })
  async findLatest(
    @CurrentUser() user: User,
  ): Promise<VerificationResponseDto> {
    return VerificationResponseDto.fromEntity(
      await this.verificationService.findLatest(user.id),
    );
  }
}
