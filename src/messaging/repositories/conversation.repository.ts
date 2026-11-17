import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Conversation,
  type Message,
  type ReservationStatus,
} from '@PrismaClient';
import { PrismaService } from '@Prisma/services';

export type ConversationWithListing = Conversation & {
  listing: { name: string };
  /** null en las conversaciones previas a la reserva (H15). */
  reservation: { status: ReservationStatus } | null;
};

/** Lo que hace falta de una reserva para abrir su conversación (H16). */
export type ReservationForConversation = {
  id: string;
  status: ReservationStatus;
  listingId: string;
  tenantId: string;
  listing: { landlordId: string };
};

/** Único punto del módulo que habla con `conversations` y `messages`. */
@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Publicación activa con su dueño, o null si no existe o está desactivada. */
  findActiveListing(
    id: string,
  ): Promise<{ id: string; landlordId: string } | null> {
    return this.prisma.listing.findFirst({
      where: { id, isActive: true },
      select: { id: true, landlordId: true },
    });
  }

  findPreReservation(
    listingId: string,
    tenantId: string,
  ): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: { listingId, tenantId, reservationId: null },
    });
  }

  /**
   * Crea la conversación previa a la reserva. Si otra petición la creó al
   * mismo tiempo, el índice único lo detecta y se devuelve null para que el
   * servicio lea la existente.
   */
  async createPreReservation(data: {
    listingId: string;
    tenantId: string;
    landlordId: string;
  }): Promise<Conversation | null> {
    try {
      return await this.prisma.conversation.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Reserva solo si el usuario es quien reservó o el dueño de la publicación.
   * Para cualquier otro es null, igual que si no existiera (404).
   */
  findReservationForParticipant(
    id: string,
    userId: string,
  ): Promise<ReservationForConversation | null> {
    return this.prisma.reservation.findFirst({
      where: {
        id,
        OR: [{ tenantId: userId }, { listing: { landlordId: userId } }],
      },
      select: {
        id: true,
        status: true,
        listingId: true,
        tenantId: true,
        listing: { select: { landlordId: true } },
      },
    });
  }

  findByReservation(reservationId: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({ where: { reservationId } });
  }

  /**
   * Crea la conversación de la reserva. Si otra petición la creó al mismo
   * tiempo, el índice único de DB-16.1 lo detecta y se devuelve null para que
   * el servicio lea la existente.
   */
  async createForReservation(data: {
    reservationId: string;
    listingId: string;
    tenantId: string;
    landlordId: string;
  }): Promise<Conversation | null> {
    try {
      return await this.prisma.conversation.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  /** Conversación solo si el usuario participa en ella. */
  findForParticipant(
    id: string,
    userId: string,
  ): Promise<ConversationWithListing | null> {
    return this.prisma.conversation.findFirst({
      where: { id, OR: [{ tenantId: userId }, { landlordId: userId }] },
      include: {
        listing: { select: { name: true } },
        reservation: { select: { status: true } },
      },
    });
  }

  createMessage(data: {
    conversationId: string;
    authorId: string;
    content: string;
  }): Promise<Message> {
    return this.prisma.message.create({ data });
  }

  async findMessages(
    conversationId: string,
    page: number,
    limit: number,
  ): Promise<{ items: Message[]; total: number }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.message.count({ where: { conversationId } }),
    ]);
    return { items, total };
  }
}
