import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingRepository,
  type ListingWithImages,
} from '@Listings/repositories';
import {
  ImageStorageService,
  type ImageKind,
} from './image-storage.service.js';
import {
  ListingPageDto,
  ListingSummaryDto,
  type CreateListingDto,
  type ListListingsQueryDto,
} from '@Listings/dto';
// Ruta directa y no `@Availability/services`: ese índice importa a este
// servicio y formaría un ciclo.
import {
  DAY_MS,
  startOfLocalDay,
} from '../../availability/services/local-time.js';
import type { Listing, ListingImage } from '@PrismaClient';

export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadedImage {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ListingsService {
  constructor(
    private readonly listingRepository: ListingRepository,
    private readonly storage: ImageStorageService,
  ) {}

  async create(
    landlordId: string,
    dto: CreateListingDto,
    files: UploadedImage[],
  ): Promise<Listing> {
    // Los montos ya vienen con formato válido (DTO); falta el rango.
    if (Number(dto.tarifaMonto) <= 0) {
      throw new BadRequestException('La tarifa debe ser mayor que 0.');
    }
    const kinds = this.validateImages(files);

    const imagePaths: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        imagePaths.push(await this.storage.save(file.buffer, kinds[i]));
      }

      return await this.listingRepository.create({
        landlordId,
        type: dto.tipo,
        name: dto.nombre,
        description: dto.descripcion,
        location: dto.ubicacion,
        rateAmount: dto.tarifaMonto,
        rateUnit: dto.tarifaUnidad,
        depositAmount: dto.depositoMonto,
        conditions: dto.condiciones,
        imagePaths,
      });
    } catch (error) {
      // Si algo falla después de escribir archivos, no deja fotos huérfanas.
      await this.storage.removeMany(imagePaths);
      throw error;
    }
  }

  /**
   * Catálogo público (H02) con filtros (H11): solo activas, más reciente
   * primero. Los filtros se combinan: se devuelven las que cumplen todos.
   *
   * @throws {BadRequestException} si precioMin supera a precioMax, falta una
   *   de las dos fechas, una fecha no existe o `hasta` es anterior a `desde`.
   */
  async search(query: ListListingsQueryDto): Promise<ListingPageDto> {
    const { precioMin, precioMax } = query;
    if (
      precioMin !== undefined &&
      precioMax !== undefined &&
      precioMin > precioMax
    ) {
      throw new BadRequestException(
        'precioMin no puede ser mayor que precioMax.',
      );
    }

    const { items, total } = await this.listingRepository.search({
      text: query.buscar || undefined,
      type: query.tipo,
      location: query.ubicacion || undefined,
      minRate: precioMin,
      maxRate: precioMax,
      available: this.availableRange(query.desde, query.hasta),
      page: query.page,
      limit: query.limit,
    });
    return {
      items: items.map((row) => ListingSummaryDto.fromRow(row)),
      page: query.page,
      total,
    };
  }

  /** Convierte `desde` y `hasta` (días de El Salvador, incluidos) en [from, to). */
  private availableRange(
    desde?: string,
    hasta?: string,
  ): { from: Date; to: Date } | undefined {
    if (!desde && !hasta) return undefined;
    if (!desde || !hasta) {
      throw new BadRequestException(
        'Para filtrar por fechas disponibles enviá desde y hasta.',
      );
    }
    const from = startOfLocalDay(desde);
    if (!from) {
      throw new BadRequestException(`La fecha desde (${desde}) no existe.`);
    }
    const lastDay = startOfLocalDay(hasta);
    if (!lastDay) {
      throw new BadRequestException(`La fecha hasta (${hasta}) no existe.`);
    }
    if (lastDay < from) {
      throw new BadRequestException(
        'La fecha hasta no puede ser anterior a desde.',
      );
    }
    // `hasta` va incluido: el rango termina cuando empieza el día siguiente.
    return { from, to: new Date(lastDay.getTime() + DAY_MS) };
  }

  async findById(id: string): Promise<ListingWithImages> {
    const listing = await this.listingRepository.findActiveById(id);
    if (!listing)
      throw new NotFoundException(
        'La publicación no existe o no está disponible.',
      );
    return listing;
  }

  async findImage(listingId: string, position: number): Promise<ListingImage> {
    const image = await this.listingRepository.findImage(listingId, position);
    if (!image) throw new NotFoundException('La imagen no existe.');
    return image;
  }

  /** De 1 a 10 fotos, JPG o PNG, de máximo 5 MB cada una. */
  private validateImages(files: UploadedImage[]): ImageKind[] {
    if (files.length === 0) {
      throw new BadRequestException('Agregá al menos una fotografía.');
    }
    if (files.length > MAX_IMAGES) {
      throw new BadRequestException(
        `Se permiten como máximo ${MAX_IMAGES} fotografías.`,
      );
    }

    return files.map((file) => {
      if (file.size > MAX_IMAGE_BYTES) {
        throw new BadRequestException(
          `La imagen "${file.originalname}" pesa más de 5 MB.`,
        );
      }
      const kind = this.storage.detectKind(file.buffer);
      if (!kind) {
        throw new BadRequestException(
          `La imagen "${file.originalname}" no es JPG ni PNG.`,
        );
      }
      return kind;
    });
  }
}
