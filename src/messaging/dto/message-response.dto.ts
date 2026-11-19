import { ApiProperty } from '@nestjs/swagger';
import type { Message, ReservationStatus } from '@PrismaClient';

export class ConversationCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

/**
 * Respuesta de POST /reservas/{id}/conversacion (H16). Además del id, el
 * estado de la reserva y si se puede escribir, para que la pantalla sepa si
 * muestra la caja de texto o solo el historial sin otra llamada.
 */
export class ReservationConversationDto extends ConversationCreatedDto {
  @ApiProperty({
    enum: [
      'PENDIENTE',
      'CONFIRMADA',
      'RECHAZADA',
      'CANCELADA',
      'EN_CURSO',
      'COMPLETADA',
    ],
    example: 'CONFIRMADA',
  })
  estadoReserva!: ReservationStatus;

  @ApiProperty({
    example: true,
    description: 'true con la reserva CONFIRMADA o EN_CURSO.',
  })
  puedeEscribir!: boolean;
}

export class MessageCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class MessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  autorId!: string;

  @ApiProperty()
  contenido!: string;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(message: Message): MessageDto {
    return {
      id: message.id,
      autorId: message.authorId,
      contenido: message.content,
      createdAt: message.createdAt,
    };
  }
}

export class MessagePageDto {
  @ApiProperty({ type: [MessageDto] })
  items!: MessageDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 2 })
  total!: number;
}
