import { Module } from '@nestjs/common';

/**
 * Módulo 8: Notificaciones.
 *
 * No tiene controllers: el servicio de avisos es interno y no se expone como
 * endpoint público. Los demás módulos lo importan para inyectar AvisosService.
 */
@Module({})
export class NotificationsModule {}
