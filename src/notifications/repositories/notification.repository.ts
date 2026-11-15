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

/** Columnas que salen hacia la bandeja. Nunca incluye `userId`. */
const NOTIFICATION_SELECT = {
  id: true,
  sourceModule: true,
  title: true,
  message: true,
  referenceType: true,
  referenceId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

/** Fila de la bandeja, con las columnas de NOTIFICATION_SELECT. */
export type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_SELECT;
}>;

export interface FindPageByUserOptions {
  /** Solo las no leídas (`read_at IS NULL`). */
  unreadOnly: boolean;
  skip: number;
  take: number;
}

/**
 * Único punto del módulo que habla con la tabla `notifications`.
 *
 * Traduce los códigos de Prisma a errores del módulo para que AvisosService
 * no tenga que conocerlos. Lo usan AvisosService (escritura) y BandejaService
 * (lectura y marca de leída).
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

  /**
   * Una página de la bandeja de `userId`, más recientes primero, y el total de
   * filas que cumplen el mismo filtro (no solo las de la página).
   *
   * El orden usa el índice `(user_id, read_at, created_at DESC)`. `id` desempata
   * avisos creados en el mismo milisegundo para que las páginas sean estables.
   */
  async findPageByUser(
    userId: string,
    { unreadOnly, skip, take }: FindPageByUserOptions,
  ): Promise<{ items: NotificationRow[]; total: number }> {
    const where: Prisma.NotificationWhereInput = unreadOnly
      ? { userId, readAt: null }
      : { userId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Marca como leída la notificación `id` de `userId` y la devuelve.
   *
   * El UPDATE filtra por `id`, `userId` y `read_at IS NULL` en una sola
   * sentencia: no toca filas de otros usuarios ni otras notificaciones, y dos
   * llamadas simultáneas no pisan la fecha. Si ya estaba leída, la devuelve con
   * su `readAt` original (idempotente).
   *
   * @returns `null` si no existe o pertenece a otro usuario. Los dos casos son
   *   indistinguibles a propósito.
   */
  async markAsRead(
    id: string,
    userId: string,
  ): Promise<NotificationRow | null> {
    const [updated] = await this.prisma.notification.updateManyAndReturn({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
      select: NOTIFICATION_SELECT,
    });
    if (updated) return updated;

    // No se actualizó nada: o ya estaba leída, o no es de este usuario.
    return this.prisma.notification.findFirst({
      where: { id, userId },
      select: NOTIFICATION_SELECT,
    });
  }

  /** Cantidad de notificaciones no leídas de `userId`. */
  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }
}
