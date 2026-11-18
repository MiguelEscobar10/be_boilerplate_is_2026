import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, Roles } from '@Auth/decorators';
import {
  CreateDeliveryDto,
  DeliveryCreatedDto,
  DeliveryResponseDto,
} from '@Deliveries/dto';
import { PhotoUploadErrorsFilter } from '@Deliveries/filters';
import {
  DeliveriesService,
  DeliveryPhotoStorageService,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
} from '@Deliveries/services';
import type { UploadedPhoto } from '@Deliveries/services';
import type { User } from '@PrismaClient';

type PhotoFields = {
  fotos?: UploadedPhoto[];
  'fotos[]'?: UploadedPhoto[];
};

/** Entrega del equipo o inicio del uso del espacio (H08, BE-08.1). */
@ApiTags('reservas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller('reservas')
export class DeliveriesController {
  constructor(
    private readonly deliveriesService: DeliveriesService,
    private readonly storage: DeliveryPhotoStorageService,
  ) {}

  /**
   * multipart/form-data con `nota` (1 a 500 caracteres) y hasta 5 fotos JPG o
   * PNG de máximo 5 MB en `fotos` (también se acepta `fotos[]`). La fecha real
   * la pone el servidor.
   */
  @Roles('ARRENDADOR')
  @Post(':id/entrega')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Registra la entrega y pasa la reserva a EN_CURSO' })
  @ApiCreatedResponse({ type: DeliveryCreatedDto })
  @ApiBadRequestResponse({
    description:
      'Nota vacía o de más de 500, más de 5 fotos o fotos no admitidas.',
  })
  @ApiForbiddenResponse({
    description:
      'La cuenta no es de arrendador o la reserva no es de un bien suyo.',
  })
  @ApiNotFoundResponse({ description: 'La reserva no existe.' })
  @ApiConflictResponse({
    description: 'La reserva no está CONFIRMADA o ya tiene entrega.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'ENTREGA_NO_HABILITADA: todavía no llega el inicio de la reserva.',
  })
  @UseFilters(PhotoUploadErrorsFilter)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'fotos', maxCount: MAX_PHOTOS },
        { name: 'fotos[]', maxCount: MAX_PHOTOS },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS },
      },
    ),
  )
  async register(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDeliveryDto,
    @UploadedFiles() files: PhotoFields = {},
  ): Promise<DeliveryCreatedDto> {
    const photos = [...(files.fotos ?? []), ...(files['fotos[]'] ?? [])];
    const delivery = await this.deliveriesService.register(
      id,
      user.id,
      dto.nota,
      photos,
    );
    return DeliveryCreatedDto.fromEntity(delivery);
  }

  /** Para el arrendador y el arrendatario de la reserva; para el resto, 404. */
  @Get(':id/entrega')
  @ApiOperation({ summary: 'Consulta la entrega de una reserva propia' })
  @ApiOkResponse({ type: DeliveryResponseDto })
  @ApiNotFoundResponse({
    description: 'La reserva no existe, no es tuya o no tiene entrega.',
  })
  async findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeliveryResponseDto> {
    return DeliveryResponseDto.fromEntity(
      await this.deliveriesService.findForParticipant(id, user.id),
    );
  }

  @Get(':id/entrega/fotos/:orden')
  @ApiOperation({ summary: 'Devuelve una foto del estado inicial' })
  @ApiNotFoundResponse({ description: 'La foto no existe o no es tuya.' })
  async findPhoto(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orden', ParseIntPipe) orden: number,
    @Res() res: Response,
  ): Promise<void> {
    const path = await this.deliveriesService.findPhotoPath(id, user.id, orden);
    res.type(this.storage.contentType(path));
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(this.storage.absolutePath(path));
  }
}
