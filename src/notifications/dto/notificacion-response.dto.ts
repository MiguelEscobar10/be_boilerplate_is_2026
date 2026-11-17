import { ApiProperty } from '@nestjs/swagger';
import { ModuloOrigen } from '@PrismaClient';
import type { NotificationRow } from '@Notifications/repositories';

/** Entidad que originó el aviso (p. ej. una reserva). */
export class ReferenciaNotificacionDto {
  @ApiProperty({ example: 'reserva' })
  tipo!: string;

  @ApiProperty({ example: '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b' })
  id!: string;
}

/**
 * Forma pública de una notificación. Usa los nombres en español del brief y
 * nunca expone `userId`.
 */
export class NotificacionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ModuloOrigen,
    enumName: 'ModuloOrigen',
    example: 'RESERVAS',
  })
  moduloOrigen!: ModuloOrigen;

  @ApiProperty({ example: 'Reserva CONFIRMADA' })
  titulo!: string;

  @ApiProperty({ example: 'Tu reserva de «Taladro» fue confirmada.' })
  mensaje!: string;

  @ApiProperty({
    type: ReferenciaNotificacionDto,
    nullable: true,
    description: 'null si el aviso no tiene referencia.',
  })
  referencia!: ReferenciaNotificacionDto | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Fecha de lectura. null = no leída.',
  })
  leidaAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  creadaAt!: Date;

  static fromEntity(notification: NotificationRow): NotificacionResponseDto {
    // El CHECK notifications_reference_pair_check garantiza que van las dos o
    // ninguna; se revisan ambas igual para no devolver una referencia a medias.
    const referencia =
      notification.referenceType !== null && notification.referenceId !== null
        ? { tipo: notification.referenceType, id: notification.referenceId }
        : null;

    return {
      id: notification.id,
      moduloOrigen: notification.sourceModule,
      titulo: notification.title,
      mensaje: notification.message,
      referencia,
      leidaAt: notification.readAt,
      creadaAt: notification.createdAt,
    };
  }
}
