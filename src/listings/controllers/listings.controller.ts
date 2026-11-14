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
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, Public, Roles } from '@Auth/decorators';
import {
  CreateListingDto,
  ListingCreatedDto,
  ListingResponseDto,
} from '@Listings/dto';
import { UploadErrorsFilter } from '@Listings/filters';
import {
  ImageStorageService,
  ListingsService,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from '@Listings/services';
import type { UploadedImage } from '@Listings/services';
import type { User } from '@PrismaClient';

type ImageFields = {
  imagenes?: UploadedImage[];
  'imagenes[]'?: UploadedImage[];
};

@ApiTags('publicaciones')
@Controller('publicaciones')
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly storage: ImageStorageService,
  ) {}

  /**
   * Publica un equipo o espacio (H01). Recibe multipart/form-data con los
   * datos y de 1 a 10 fotos en `imagenes` (también se acepta `imagenes[]`).
   * Solo para cuentas ARRENDADOR; el resto recibe 403.
   */
  @Roles('ARRENDADOR')
  @Post()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Publica un equipo o espacio' })
  @ApiCreatedResponse({ type: ListingCreatedDto })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o imágenes no admitidas.',
  })
  @ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
  @ApiForbiddenResponse({ description: 'La cuenta no es de arrendador.' })
  @UseFilters(UploadErrorsFilter)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'imagenes', maxCount: MAX_IMAGES },
        { name: 'imagenes[]', maxCount: MAX_IMAGES },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
      },
    ),
  )
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateListingDto,
    @UploadedFiles() files: ImageFields = {},
  ): Promise<ListingCreatedDto> {
    const images = [...(files.imagenes ?? []), ...(files['imagenes[]'] ?? [])];
    const listing = await this.listingsService.create(user.id, dto, images);
    return ListingCreatedDto.fromEntity(listing);
  }

  /** Consulta pública de una publicación activa con sus imágenes en orden. */
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Consulta una publicación' })
  @ApiOkResponse({ type: ListingResponseDto })
  @ApiNotFoundResponse({ description: 'No existe o está desactivada.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ListingResponseDto> {
    return ListingResponseDto.fromEntity(
      await this.listingsService.findById(id),
    );
  }

  /** Sirve una foto de una publicación activa. */
  @Public()
  @Get(':id/imagenes/:orden')
  @ApiOperation({ summary: 'Devuelve una foto de la publicación' })
  @ApiNotFoundResponse({ description: 'La imagen no existe.' })
  async findImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orden', ParseIntPipe) orden: number,
    @Res() res: Response,
  ): Promise<void> {
    const image = await this.listingsService.findImage(id, orden);
    res.type(this.storage.contentType(image.path));
    res.sendFile(this.storage.absolutePath(image.path));
  }
}
