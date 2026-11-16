import { ApiProperty } from '@nestjs/swagger';
import type { Message } from '@PrismaClient';

export class ConversationCreatedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
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
