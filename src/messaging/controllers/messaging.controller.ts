import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Roles } from '@Auth/decorators';
import {
  ConversationCreatedDto,
  CreateMessageDto,
  ListMessagesQuery,
  MessageCreatedDto,
  MessageDto,
  MessagePageDto,
} from '@Messaging/dto';
import { MessagingService } from '@Messaging/services';
import type { User } from '@PrismaClient';

@ApiTags('mensajeria')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Falta la sesión.' })
@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  /** Abre la conversación con el arrendador antes de reservar (H15). */
  @Roles('ARRENDATARIO')
  @Post('publicaciones/:id/conversaciones')
  @ApiOperation({
    summary: 'Abre (o reutiliza) la conversación con el arrendador',
  })
  @ApiCreatedResponse({
    type: ConversationCreatedDto,
    description: 'Conversación nueva.',
  })
  @ApiOkResponse({
    type: ConversationCreatedDto,
    description: 'Ya existía; se devuelve esa.',
  })
  @ApiForbiddenResponse({
    description: 'Solo un arrendatario abre conversaciones.',
  })
  @ApiNotFoundResponse({
    description: 'La publicación no existe o no está disponible.',
  })
  async open(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) listingId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConversationCreatedDto> {
    const { conversation, created } = await this.messaging.openForListing(
      listingId,
      user.id,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { id: conversation.id };
  }

  /** Abre la conversación de una reserva propia (H16). */
  @Roles('ARRENDATARIO', 'ARRENDADOR')
  @Post('reservas/:id/conversacion')
  @ApiOperation({
    summary: 'Abre (o recupera) la conversación de la reserva',
    description:
      'Solo para quien reservó y el dueño de la publicación. Se crea con la reserva CONFIRMADA o EN_CURSO; si ya existe se devuelve en cualquier estado para leer el historial.',
  })
  @ApiCreatedResponse({
    type: ConversationCreatedDto,
    description: 'Conversación nueva.',
  })
  @ApiOkResponse({
    type: ConversationCreatedDto,
    description: 'Ya existía; se devuelve esa.',
  })
  @ApiNotFoundResponse({
    description: 'La reserva no existe o no participás en ella.',
  })
  @ApiConflictResponse({
    description:
      'codigo CONVERSACION_NO_HABILITADA (reserva PENDIENTE) o CONVERSACION_CERRADA (RECHAZADA, CANCELADA o COMPLETADA, sin conversación previa).',
  })
  async openForReservation(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) reservationId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConversationCreatedDto> {
    const { conversation, created } = await this.messaging.openForReservation(
      reservationId,
      user.id,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { id: conversation.id };
  }

  @Roles('ARRENDATARIO', 'ARRENDADOR')
  @Post('conversaciones/:id/mensajes')
  @ApiOperation({ summary: 'Envía un mensaje en una conversación propia' })
  @ApiCreatedResponse({ type: MessageCreatedDto })
  @ApiBadRequestResponse({
    description: 'Mensaje vacío o de más de 1000 caracteres.',
  })
  @ApiNotFoundResponse({
    description: 'La conversación no existe o no participás en ella.',
  })
  @ApiConflictResponse({
    description:
      'Conversación de reserva: codigo CONVERSACION_CERRADA con la reserva RECHAZADA, CANCELADA o COMPLETADA (el GET sigue funcionando).',
  })
  async send(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageCreatedDto> {
    const message = await this.messaging.sendMessage(
      conversationId,
      user.id,
      dto.contenido,
    );
    return { id: message.id, createdAt: message.createdAt };
  }

  @Roles('ARRENDATARIO', 'ARRENDADOR')
  @Get('conversaciones/:id/mensajes')
  @ApiOperation({
    summary: 'Historial de una conversación propia, en orden cronológico',
  })
  @ApiOkResponse({ type: MessagePageDto })
  @ApiNotFoundResponse({
    description: 'La conversación no existe o no participás en ella.',
  })
  async list(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query() query: ListMessagesQuery,
  ): Promise<MessagePageDto> {
    const { items, total } = await this.messaging.listMessages(
      conversationId,
      user.id,
      query.page,
      query.limit,
    );
    return {
      items: items.map((m) => MessageDto.fromEntity(m)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }
}
