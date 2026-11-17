import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryConflictError,
  EntregaNoHabilitadaException,
} from '@Deliveries/errors';
import {
  DeliveryRepository,
  type DeliveryWithPhotos,
} from '@Deliveries/repositories';
import {
  DeliveryPhotoStorageService,
  type PhotoKind,
} from './delivery-photo-storage.service.js';
import type { Delivery } from '@PrismaClient';

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_NOTE_LENGTH = 500;

export interface UploadedPhoto {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const NO_EXISTE = 'La reserva no existe.';

/**
 * Registro de la entrega e inicio del alquiler (H08, BE-08.1).
 *
 * Orden de las reglas: datos (400) → reserva (404) → dueño (403) → estado y
 * duplicado (409) → fecha de inicio (422). Nada se guarda si alguna falla.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly storage: DeliveryPhotoStorageService,
  ) {}

  async register(
    reservationId: string,
    landlordId: string,
    note: string | undefined,
    photos: UploadedPhoto[],
    now: Date = new Date(),
  ): Promise<Delivery> {
    const initialConditionNote = this.validateNote(note);
    const kinds = this.validatePhotos(photos);

    const reservation = await this.deliveries.findReservation(reservationId);
    if (!reservation) throw new NotFoundException(NO_EXISTE);
    if (reservation.landlordId !== landlordId) {
      throw new ForbiddenException(
        'Solo el arrendador del bien puede registrar la entrega.',
      );
    }
    if (reservation.hasDelivery) {
      throw new ConflictException('La entrega de esta reserva ya se registró.');
    }
    if (reservation.status !== 'CONFIRMADA') {
      throw new ConflictException(
        `Solo se registra la entrega de una reserva CONFIRMADA (está ${reservation.status}).`,
      );
    }
    if (now < reservation.startAt) {
      throw new EntregaNoHabilitadaException(reservation.startAt);
    }

    const photoPaths: string[] = [];
    try {
      for (const [i, photo] of photos.entries()) {
        photoPaths.push(await this.storage.save(photo.buffer, kinds[i]));
      }
      return await this.deliveries.createAndStart({
        reservationId,
        registeredById: landlordId,
        initialConditionNote,
        photoPaths,
      });
    } catch (error) {
      // Si algo falla después de escribir fotos, no quedan huérfanas.
      await this.storage.removeMany(photoPaths);
      if (error instanceof DeliveryConflictError) {
        throw new ConflictException(
          error.reason === 'YA_ENTREGADA'
            ? 'La entrega de esta reserva ya se registró.'
            : 'La reserva ya no está CONFIRMADA.',
        );
      }
      throw error;
    }
  }

  /**
   * La entrega de una reserva, para su arrendador o su arrendatario.
   *
   * @throws {NotFoundException} si la reserva no existe, no es de quien
   *   pregunta (para no revelar que existe) o todavía no tiene entrega.
   */
  async findForParticipant(
    reservationId: string,
    userId: string,
  ): Promise<DeliveryWithPhotos> {
    const reservation = await this.deliveries.findReservation(reservationId);
    if (
      !reservation ||
      (reservation.landlordId !== userId && reservation.tenantId !== userId)
    ) {
      throw new NotFoundException(NO_EXISTE);
    }
    const delivery = await this.deliveries.findByReservation(reservationId);
    if (!delivery) {
      throw new NotFoundException('La reserva todavía no tiene entrega.');
    }
    return delivery;
  }

  /** La ruta de una foto, con los mismos permisos que la entrega. */
  async findPhotoPath(
    reservationId: string,
    userId: string,
    position: number,
  ): Promise<string> {
    const delivery = await this.findForParticipant(reservationId, userId);
    const photo = delivery.photos.find((p) => p.position === position);
    if (!photo) throw new NotFoundException('La foto no existe.');
    return photo.path;
  }

  private validateNote(note: string | undefined): string {
    const trimmed = typeof note === 'string' ? note.trim() : '';
    if (trimmed.length === 0) {
      throw new BadRequestException(
        'La nota del estado inicial es obligatoria.',
      );
    }
    if (trimmed.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(
        `La nota puede tener como máximo ${MAX_NOTE_LENGTH} caracteres.`,
      );
    }
    return trimmed;
  }

  /** Hasta 5 fotos opcionales, JPG o PNG de máximo 5 MB cada una. */
  private validatePhotos(photos: UploadedPhoto[]): PhotoKind[] {
    if (photos.length > MAX_PHOTOS) {
      throw new BadRequestException(
        `Se permiten como máximo ${MAX_PHOTOS} fotos.`,
      );
    }
    return photos.map((photo) => {
      if (photo.size > MAX_PHOTO_BYTES) {
        throw new BadRequestException(
          `La foto "${photo.originalname}" pesa más de 5 MB.`,
        );
      }
      const kind = this.storage.detectKind(photo.buffer);
      if (!kind) {
        throw new BadRequestException(
          `La foto "${photo.originalname}" no es JPG ni PNG.`,
        );
      }
      return kind;
    });
  }
}
