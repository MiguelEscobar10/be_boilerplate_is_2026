import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import {
  AvisoDuplicadoError,
  DestinatarioInexistenteError,
} from '@Notifications/errors';
import { Prisma, type ModuloOrigen } from '@PrismaClient';

/** Código de Prisma para violación de restricción única. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
/** Código de Prisma para violación de clave foránea. */
const FOREIGN_KEY_VIOLATION = 'P2003';

export interface CreateNotificationData {
  userId: string;
  sourceModule: ModuloOrigen;
  title: string;
  message: string;
  referenceType: string | null;
  referenceId: string | null;
}

/** Clave del índice único parcial `notifications_dedupe_key`. */
export interface NotificationDedupeKey {
  userId: string;
  sourceModule: ModuloOrigen;
  referenceType: string;
  referenceId: string;
  title: string;
}

/**
 * Único punto del módulo que habla con la tabla `notifications`.
 *
 * Traduce los códigos de Prisma a errores del módulo para que AvisosService
 * no tenga que conocerlos.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @throws {AvisoDuplicadoError} si choca con `notifications_dedupe_key`.
   * @throws {DestinatarioInexistenteError} si `userId` no existe en `users`.
   *
   * No se consulta antes de insertar: la base decide la unicidad y la
   * existencia del destinatario, así no hay carrera entre la lectura y el
   * insert. Fuera de la clave primaria (un uuid generado), la única
   * restricción única de la tabla es `notifications_dedupe_key`, así que
   * cualquier P2002 es un duplicado.
   */
  async create(data: CreateNotificationData): Promise<{ id: string }> {
    try {
      return await this.prisma.notification.create({
        data,
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
          throw new AvisoDuplicadoError();
        }
        if (error.code === FOREIGN_KEY_VIOLATION) {
          throw new DestinatarioInexistenteError();
        }
      }
      throw error;
    }
  }

  /** Busca el aviso que ocupa la clave de deduplicación. */
  findByDedupeKey(key: NotificationDedupeKey): Promise<{ id: string } | null> {
    return this.prisma.notification.findFirst({
      where: key,
      select: { id: true },
    });
  }
}
