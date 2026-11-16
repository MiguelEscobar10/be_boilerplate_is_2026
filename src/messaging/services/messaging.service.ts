import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AvisosService } from '@Notifications/services';
import { ModuloOrigen } from '@Notifications/types';
import { ConversationRepository } from '@Messaging/repositories';
import type { Conversation, Message } from '@PrismaClient';

const NO_ENCONTRADA = 'La conversación no existe.';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly avisos: AvisosService,
  ) {}

  /**
   * Abre (o reutiliza) la conversación previa a la reserva entre el
   * arrendatario y el dueño de la publicación. `created` dice si es nueva,
   * para responder 201 o 200.
   */
  async openForListing(
    listingId: string,
    tenantId: string,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const listing = await this.conversations.findActiveListing(listingId);
    // Una publicación propia también es 404: nadie conversa consigo mismo.
    if (!listing || listing.landlordId === tenantId) {
      throw new NotFoundException(
        'La publicación no existe o no está disponible.',
      );
    }

    const existing = await this.conversations.findPreReservation(
      listingId,
      tenantId,
    );
    if (existing) return { conversation: existing, created: false };

    const created = await this.conversations.createPreReservation({
      listingId,
      tenantId,
      landlordId: listing.landlordId,
    });
    if (created) return { conversation: created, created: true };

    // Otra petición la creó al mismo tiempo: se devuelve esa.
    const raced = await this.conversations.findPreReservation(
      listingId,
      tenantId,
    );
    if (!raced) throw new NotFoundException(NO_ENCONTRADA);
    return { conversation: raced, created: false };
  }

  /** Guarda el mensaje y avisa al otro participante (H15). */
  async sendMessage(
    conversationId: string,
    authorId: string,
    content: string,
  ): Promise<Message> {
    const conversation = await this.conversations.findForParticipant(
      conversationId,
      authorId,
    );
    if (!conversation) throw new NotFoundException(NO_ENCONTRADA);

    const message = await this.conversations.createMessage({
      conversationId,
      authorId,
      content,
    });

    const recipientId =
      authorId === conversation.tenantId
        ? conversation.landlordId
        : conversation.tenantId;
    try {
      await this.avisos.notificar({
        destinatarioId: recipientId,
        titulo: 'Mensaje nuevo',
        // Sin el texto del mensaje: solo el nombre del bien (H15).
        mensaje: `Tenés un mensaje nuevo sobre "${conversation.listing.name}".`,
        moduloOrigen: ModuloOrigen.MENSAJERIA,
        referencia: { tipo: 'mensaje', id: message.id },
      });
    } catch (error) {
      // El mensaje ya quedó guardado: si el aviso falla no se pierde, solo se registra.
      this.logger.error(
        `No se pudo avisar del mensaje ${message.id}`,
        error as Error,
      );
    }

    return message;
  }

  async listMessages(
    conversationId: string,
    userId: string,
    page: number,
    limit: number,
  ) {
    const conversation = await this.conversations.findForParticipant(
      conversationId,
      userId,
    );
    if (!conversation) throw new NotFoundException(NO_ENCONTRADA);
    return this.conversations.findMessages(conversationId, page, limit);
  }
}
