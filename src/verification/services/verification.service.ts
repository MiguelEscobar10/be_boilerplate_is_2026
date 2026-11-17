import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PendingVerificationExistsError } from '@Verification/errors';
import { IdentityVerificationRepository } from '@Verification/repositories';
import { DocumentStorageService } from './document-storage.service.js';
import type { IdentityVerification } from '@PrismaClient';

/** Tamaño máximo del documento de identidad: 5 MB. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const PENDIENTE_EXISTENTE =
  'Ya tenés una solicitud de verificación PENDIENTE. Esperá la respuesta del revisor antes de enviar otra.';

export interface UploadedDocument {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * Envío y consulta de la verificación de identidad del usuario autenticado
 * (H07, BE-07.1). La revisión del REVISOR es BE-07.2.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly verifications: IdentityVerificationRepository,
    private readonly storage: DocumentStorageService,
  ) {}

  /**
   * Registra una solicitud PENDIENTE con el documento.
   *
   * @throws {BadRequestException} si falta el archivo, no es JPG, PNG ni PDF o
   *   pesa más de 5 MB. No se guarda nada.
   * @throws {ConflictException} si ya hay una solicitud PENDIENTE. No se guarda
   *   nada.
   */
  async submit(
    userId: string,
    file: UploadedDocument | undefined,
  ): Promise<IdentityVerification> {
    const kind = this.validate(file);

    // Revisión previa para no escribir el archivo en el caso común. La que
    // decide de verdad es el índice único de la base (abajo).
    if (await this.verifications.hasPending(userId)) {
      throw new ConflictException(PENDIENTE_EXISTENTE);
    }

    const documentKey = await this.storage.save(file!.buffer, kind);
    try {
      return await this.verifications.create(userId, documentKey);
    } catch (error) {
      // Si no se registró, el archivo no debe quedar huérfano.
      await this.storage.remove(documentKey);
      if (error instanceof PendingVerificationExistsError) {
        throw new ConflictException(PENDIENTE_EXISTENTE);
      }
      throw error;
    }
  }

  /**
   * La solicitud más reciente del usuario.
   *
   * @throws {NotFoundException} si todavía no envió ninguna.
   */
  async findLatest(userId: string): Promise<IdentityVerification> {
    const latest = await this.verifications.findLatestByUser(userId);
    if (!latest) {
      throw new NotFoundException(
        'Todavía no enviaste ninguna solicitud de verificación.',
      );
    }
    return latest;
  }

  /** JPG, PNG o PDF de máximo 5 MB. Devuelve el tipo detectado por su firma. */
  private validate(file: UploadedDocument | undefined) {
    if (!file || file.size === 0) {
      throw new BadRequestException(
        'Adjuntá tu documento de identidad en el campo documento.',
      );
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException(
        'El documento puede pesar como máximo 5 MB.',
      );
    }
    const kind = this.storage.detectKind(file.buffer);
    if (!kind) {
      throw new BadRequestException(
        `El documento "${file.originalname}" no es JPG, PNG ni PDF.`,
      );
    }
    return kind;
  }
}
