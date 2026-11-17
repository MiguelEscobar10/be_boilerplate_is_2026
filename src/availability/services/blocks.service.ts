import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AvailabilityBlock } from '@PrismaClient';
import type {
  BlockListResponseDto,
  BlockResponseDto,
  CreateBlockDto,
} from '@Availability/dto';
import {
  BlockOverlapsReservationError,
  RangoConReservaException,
} from '@Availability/errors';
import { BlockRepository } from '@Availability/repositories';
import { toLocalIso } from './local-time.js';

/** H14, criterio 5: el texto que ve quien intenta bloquear un bien ajeno. */
const PUBLICACION_NO_ENCONTRADA = 'Publicación no encontrada.';

function toResponse(block: AvailabilityBlock): BlockResponseDto {
  return {
    id: block.id,
    publicacionId: block.listingId,
    inicio: toLocalIso(block.startAt),
    fin: toLocalIso(block.endAt),
    motivo: block.reason,
  };
}

/** Bloqueos de fechas del arrendador (H14). */
@Injectable()
export class BlocksService {
  constructor(private readonly blocks: BlockRepository) {}

  /**
   * Bloquea un rango de una publicación propia.
   *
   * @throws {BadRequestException} si `fin` no es posterior a `inicio` o una
   *   fecha no existe.
   * @throws {NotFoundException} si la publicación no existe.
   * @throws {ForbiddenException} si la publicación es de otro arrendador.
   * @throws {RangoConReservaException} 409 si el rango se cruza con una
   *   reserva CONFIRMADA o EN_CURSO.
   */
  async create(
    listingId: string,
    landlordId: string,
    { inicio, fin, motivo }: CreateBlockDto,
  ): Promise<BlockResponseDto> {
    const startAt = new Date(inicio);
    const endAt = new Date(fin);
    // El DTO ya revisó el formato; esto atrapa fechas que no existen, como
    // el 30 de febrero, que el formato deja pasar.
    if (Number.isNaN(startAt.getTime()) || !sameDay(inicio, startAt)) {
      throw new BadRequestException(`La fecha inicio (${inicio}) no existe.`);
    }
    if (Number.isNaN(endAt.getTime()) || !sameDay(fin, endAt)) {
      throw new BadRequestException(`La fecha fin (${fin}) no existe.`);
    }
    if (endAt <= startAt) {
      throw new BadRequestException(
        'La fecha fin debe ser posterior a la de inicio.',
      );
    }

    await this.assertOwner(listingId, landlordId);

    try {
      const block = await this.blocks.create({
        listingId,
        createdById: landlordId,
        startAt,
        endAt,
        // El DTO ya lo recortó; un motivo vacío es "sin motivo".
        reason: motivo ? motivo : null,
      });
      return toResponse(block);
    } catch (error) {
      if (error instanceof BlockOverlapsReservationError) {
        throw new RangoConReservaException();
      }
      throw error;
    }
  }

  /** Bloqueos de una publicación propia, con su motivo. */
  async listForOwner(
    listingId: string,
    landlordId: string,
  ): Promise<BlockListResponseDto> {
    await this.assertOwner(listingId, landlordId);
    const blocks = await this.blocks.findByListing(listingId);
    return { items: blocks.map(toResponse) };
  }

  /**
   * 404 si no existe y 403 si es de otro arrendador, como pide la ficha de
   * BE-14.1. El texto es el de H14 en los dos casos.
   */
  private async assertOwner(listingId: string, landlordId: string) {
    const owner = await this.blocks.findListingOwner(listingId);
    if (!owner) throw new NotFoundException(PUBLICACION_NO_ENCONTRADA);
    if (owner !== landlordId) {
      throw new ForbiddenException(PUBLICACION_NO_ENCONTRADA);
    }
  }
}

/**
 * Comprueba que el día escrito exista. `new Date('2026-02-30T00:00:00Z')`
 * no falla: lo corre al 2 de marzo. Se compara año, mes y día del texto con
 * los de la fecha ya ajustada a la zona que trae el texto.
 */
function sameDay(text: string, date: Date): boolean {
  const [y, m, d] = text.slice(0, 10).split('-').map(Number);
  const zone = text.slice(19).replace(/^\.\d+/, '');
  const offsetMin =
    zone === 'Z' || zone === ''
      ? 0
      : (zone.startsWith('-') ? -1 : 1) *
        (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const local = new Date(date.getTime() + offsetMin * 60_000);
  return (
    local.getUTCFullYear() === y &&
    local.getUTCMonth() === m - 1 &&
    local.getUTCDate() === d
  );
}
