import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationRepository } from '@Notifications/repositories';
import {
  NotificacionResponseDto,
  type BandejaResponseDto,
  type ConteoNoLeidasResponseDto,
  type ListarNotificacionesQueryDto,
} from '@Notifications/dto';

/**
 * Bandeja de notificaciones (H10): lo que el usuario autenticado consulta y
 * marca como leído. Todas las operaciones reciben el `userId` de la sesión y
 * nunca tocan notificaciones de otro usuario.
 */
@Injectable()
export class BandejaService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
  ) {}

  /**
   * Una página de la bandeja, más recientes primero. `total` cuenta todas las
   * que cumplen el filtro, no solo las de la página.
   */
  async listar(
    userId: string,
    { soloNoLeidas, page, limit }: ListarNotificacionesQueryDto,
  ): Promise<BandejaResponseDto> {
    const { items, total } = await this.notificationRepository.findPageByUser(
      userId,
      { unreadOnly: soloNoLeidas, skip: (page - 1) * limit, take: limit },
    );
    return { items: items.map(NotificacionResponseDto.fromEntity), total };
  }

  /**
   * Marca como leída una notificación propia. Si ya estaba leída, la devuelve
   * con su fecha de lectura original.
   *
   * @throws {NotFoundException} si no existe o es de otro usuario. El mensaje
   *   es el mismo en los dos casos para no revelar que existe.
   */
  async marcarLeida(
    userId: string,
    id: string,
  ): Promise<NotificacionResponseDto> {
    const notification = await this.notificationRepository.markAsRead(
      id,
      userId,
    );
    if (!notification) {
      throw new NotFoundException('La notificación no existe.');
    }
    return NotificacionResponseDto.fromEntity(notification);
  }

  /** Cantidad de no leídas, para el contador de la aplicación. */
  async contarNoLeidas(userId: string): Promise<ConteoNoLeidasResponseDto> {
    return {
      noLeidas: await this.notificationRepository.countUnread(userId),
    };
  }
}
