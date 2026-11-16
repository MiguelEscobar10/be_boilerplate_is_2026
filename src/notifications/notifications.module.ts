import { Module } from '@nestjs/common';
import { AvisosService } from '@Notifications/services';
import { NotificationRepository } from '@Notifications/repositories';

/**
 * Módulo 8: Notificaciones.
 *
 * No tiene controllers: el servicio de avisos es interno y no se expone como
 * endpoint público. Los demás módulos importan NotificationsModule e inyectan
 * AvisosService para llamar a `notificar(aviso)`.
 */
@Module({
  providers: [AvisosService, NotificationRepository],
  exports: [AvisosService],
})
export class NotificationsModule {}
