import { BadRequestException, Injectable } from '@nestjs/common';
import { ListingsService } from '@Listings/services';
import type {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
} from '@Availability/dto';
import { AvailabilityRepository } from '@Availability/repositories';
import { DAY_MS, startOfLocalDay, toLocalIso } from './local-time.js';

/**
 * Rango máximo de la consulta, en días (fechas inclusivas). Alcanza para tres
 * meses seguidos de calendario (31 + 31 + 30).
 */
export const MAX_RANGE_DAYS = 92;

/** Disponibilidad de una publicación (H13). */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly listingsService: ListingsService,
    private readonly availabilityRepository: AvailabilityRepository,
  ) {}

  /**
   * Períodos ocupados de una publicación activa entre `desde` y `hasta`, las
   * dos fechas incluidas y en hora de El Salvador.
   *
   * @throws {BadRequestException} si una fecha no existe, `hasta` es anterior
   *   a `desde` o el rango pasa de MAX_RANGE_DAYS.
   * @throws {NotFoundException} si la publicación no existe o está inactiva.
   */
  async findForListing(
    listingId: string,
    { desde, hasta }: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
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
    const days = (lastDay.getTime() - from.getTime()) / DAY_MS + 1;
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango puede tener como máximo ${MAX_RANGE_DAYS} días.`,
      );
    }

    // Primero las fechas y después la publicación: un rango inválido es 400
    // aunque la publicación no exista, y no cuesta una consulta.
    await this.listingsService.findById(listingId);

    // `hasta` va incluido: el rango termina cuando empieza el día siguiente.
    const to = new Date(lastDay.getTime() + DAY_MS);
    const periods = await this.availabilityRepository.findBusyPeriods(
      listingId,
      from,
      to,
    );

    return {
      publicacionId: listingId,
      desde,
      hasta,
      ocupados: periods.map((period) => ({
        inicio: toLocalIso(period.startAt),
        fin: toLocalIso(period.endAt),
        origen: period.source,
      })),
    };
  }
}
