import { Module } from '@nestjs/common';
import { NotificacionesController } from '@Notifications/controllers';
import { AvisosService, BandejaService } from '@Notifications/services';
import { NotificationRepository } from '@Notifications/repositories';

/**
 * Módulo 8: Notificaciones.
 *
 * - AvisosService (H20) es interno y no se expone como endpoint: los demás
 *   módulos importan NotificationsModule y lo inyectan para llamar a
 *   `notificar(aviso)`.
 * - NotificacionesController (H10) expone la bandeja del usuario autenticado:
 *   listar, marcar como leída y contar las no leídas. No tiene POST.
 */
@Module({
  controllers: [NotificacionesController],
  providers: [AvisosService, BandejaService, NotificationRepository],
  exports: [AvisosService],
})
export class NotificationsModule {}
